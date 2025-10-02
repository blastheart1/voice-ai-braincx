from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
import asyncio
import json
import logging
from typing import Dict, List
import uuid
from pydantic import BaseModel

# Configure logging first
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from services.livekit_service import LiveKitService
from services.ai_service import AIService
from services.voice_pipeline import voice_pipeline
from config import config

# Validate configuration on startup
try:
    config.validate_config()
    logger.info("Configuration validated successfully")
except ValueError as e:
    logger.error(f"Configuration error: {e}")
    logger.error("Please check your .env file and ensure all required API keys are set")
    exit(1)

app = FastAPI(title="Voice AI Backend", version="1.0.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Services
livekit_service = LiveKitService()
ai_service = AIService()

# Request models
class TTSRequest(BaseModel):
    text: str
    voice: str = "nova"

# Active sessions
active_sessions: Dict[str, dict] = {}

@app.get("/")
async def root():
    return {"message": "Voice AI Backend is running"}

@app.post("/api/session/create")
async def create_session():
    """Create a new conversation session with voice pipeline"""
    try:
        session_id = str(uuid.uuid4())
        
        # Create LiveKit room and token for user
        room_name = f"voice-ai-{session_id}"
        user_token = await livekit_service.create_room_token(room_name, f"user-{session_id}")
        
        # Create voice session (this will also create the AI agent in the room)
        voice_session = await voice_pipeline.create_session(session_id, room_name)
        
        # Initialize session tracking
        active_sessions[session_id] = {
            "room_name": room_name,
            "user_token": user_token,
            "voice_session": voice_session,
            "conversation_history": [],
            "is_active": True
        }
        
        logger.info(f"Created voice session {session_id} with room {room_name}")
        
        return {
            "session_id": session_id,
            "room_name": room_name,
            "token": user_token,
            "livekit_url": config.LIVEKIT_URL
        }
    except Exception as e:
        logger.error(f"Error creating session: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Get session information"""
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = active_sessions[session_id]
    return {
        "session_id": session_id,
        "room_name": session["room_name"],
        "is_active": session["is_active"],
        "conversation_history": session["conversation_history"]
    }

@app.delete("/api/session/{session_id}")
async def end_session(session_id: str):
    """End a conversation session"""
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    try:
        session = active_sessions[session_id]
        session["is_active"] = False
        
        # Clean up voice pipeline session
        await voice_pipeline.end_session(session_id)
        
        # Clean up LiveKit room
        await livekit_service.end_room(session["room_name"])
        
        # Remove from active sessions
        del active_sessions[session_id]
        
        logger.info(f"Ended session {session_id}")
        return {"message": "Session ended successfully"}
    except Exception as e:
        logger.error(f"Error ending session: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time communication with voice pipeline"""
    await websocket.accept()
    
    if session_id not in active_sessions:
        await websocket.send_text(json.dumps({"error": "Session not found"}))
        await websocket.close()
        return
    
    session = active_sessions[session_id]
    voice_session = session["voice_session"]
    logger.info(f"WebSocket connected for session {session_id}")
    
    # Set up callbacks for voice pipeline events
    async def on_transcript(transcript: str):
        """Handle transcript from voice pipeline"""
        session["conversation_history"].append({
            "role": "user",
            "content": transcript,
            "timestamp": asyncio.get_event_loop().time()
        })
        
        await websocket.send_text(json.dumps({
            "type": "transcript",
            "text": transcript,
            "session_id": session_id
        }))
    
    async def on_ai_response(response: str):
        """Handle AI response from voice pipeline"""
        session["conversation_history"].append({
            "role": "assistant",
            "content": response,
            "timestamp": asyncio.get_event_loop().time()
        })
        
        await websocket.send_text(json.dumps({
            "type": "ai_response",
            "text": response,
            "session_id": session_id
        }))
    
    # Register callbacks
    voice_session.on_transcript = on_transcript
    voice_session.on_ai_response = on_ai_response
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message["type"] == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            
            elif message["type"] == "audio_transcript":
                # Handle user speech transcript
                user_text = message["text"]
                logger.info(f"Received user transcript: {user_text}")
                
                # Add to conversation history
                session["conversation_history"].append({
                    "role": "user",
                    "content": user_text,
                    "timestamp": message.get("timestamp")
                })
                
                # Send transcript confirmation
                await websocket.send_text(json.dumps({
                    "type": "transcript",
                    "text": user_text,
                    "session_id": session_id
                }))
                
                # Generate AI response
                try:
                    ai_response = await ai_service.generate_response(
                        user_text, 
                        session["conversation_history"]
                    )
                    
                    # Add AI response to history
                    session["conversation_history"].append({
                        "role": "assistant",
                        "content": ai_response,
                        "timestamp": asyncio.get_event_loop().time()
                    })
                    
                    # Send AI response
                    await websocket.send_text(json.dumps({
                        "type": "ai_response",
                        "text": ai_response,
                        "session_id": session_id
                    }))
                    
                    logger.info(f"AI response sent: {ai_response}")
                    
                except Exception as e:
                    logger.error(f"Error generating AI response: {str(e)}")
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Failed to generate AI response",
                        "session_id": session_id
                    }))
            
            elif message["type"] == "status_update":
                # Send current session status
                await websocket.send_text(json.dumps({
                    "type": "status",
                    "is_processing": voice_session.is_processing,
                    "conversation_length": len(session["conversation_history"]),
                    "session_id": session_id
                }))
                
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for session {session_id}")
        # Clean up callbacks
        voice_session.on_transcript = None
        voice_session.on_ai_response = None
    except Exception as e:
        logger.error(f"WebSocket error for session {session_id}: {str(e)}")
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except:
            pass

@app.post("/api/tts")
async def text_to_speech_endpoint(request: TTSRequest):
    """Generate speech from text using OpenAI TTS"""
    try:
        logger.info(f"TTS request: text='{request.text[:50]}...', voice='{request.voice}'")
        
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Text is required")
        
        # Generate TTS using existing AI service
        audio_data = await ai_service.text_to_speech(request.text, request.voice)
        
        if not audio_data:
            raise HTTPException(status_code=500, detail="Failed to generate speech")
        
        logger.info(f"TTS generated successfully, audio size: {len(audio_data)} bytes")
        
        # Return audio as response
        return Response(
            content=audio_data,
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": "inline; filename=speech.mp3",
                "Cache-Control": "no-cache"
            }
        )
        
    except Exception as e:
        logger.error(f"Error in TTS endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
