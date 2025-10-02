import asyncio
import logging
from typing import List, Dict, Any
import openai
from openai import AsyncOpenAI
import io
import tempfile
import os
from config import config

logger = logging.getLogger(__name__)

class AIService:
    def __init__(self):
        self.client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)
        self.system_prompt = config.SYSTEM_PROMPT
    
    async def generate_response(self, user_input: str, conversation_history: List[Dict[str, Any]]) -> str:
        """Generate AI response using OpenAI GPT"""
        try:
            # Use the first user message as the system prompt (initialization)
            # If there's conversation history, the first message should be the initialization
            if conversation_history and len(conversation_history) > 0:
                first_message = conversation_history[0]
                if first_message["role"] == "user":
                    # Use the first user message as system prompt
                    system_content = f"You are an AI assistant. {first_message['content']} Respond naturally and conversationally based on this role."
                    messages = [{"role": "system", "content": system_content}]
                    
                    # Add the rest of the conversation history (skip the first initialization message)
                    recent_history = conversation_history[1:-1] if len(conversation_history) > 21 else conversation_history[1:]
                else:
                    # Fallback to default system prompt
                    messages = [{"role": "system", "content": self.system_prompt}]
                    recent_history = conversation_history[-20:] if len(conversation_history) > 20 else conversation_history
            else:
                # No conversation history, use default system prompt
                messages = [{"role": "system", "content": self.system_prompt}]
                recent_history = []
            
            # Add conversation history
            for entry in recent_history:
                if entry["role"] in ["user", "assistant"]:
                    messages.append({
                        "role": entry["role"],
                        "content": entry["content"]
                    })
            
            # Add current user input if not already in history
            if not recent_history or recent_history[-1]["content"] != user_input:
                messages.append({"role": "user", "content": user_input})
            
            logger.info(f"Sending {len(messages)} messages to OpenAI")
            
            # Generate response
            response = await self.client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=messages,
                max_tokens=150,  # Keep responses concise for voice
                temperature=0.7,
                stream=False
            )
            
            ai_response = response.choices[0].message.content.strip()
            logger.info(f"AI response: {ai_response}")
            
            return ai_response
            
        except Exception as e:
            logger.error(f"Error generating AI response: {str(e)}")
            return "I'm sorry, I'm having trouble processing your request right now. Could you please try again?"
    
    async def transcribe_audio(self, audio_data: bytes) -> str:
        """Transcribe audio using OpenAI Whisper"""
        try:
            # Create a temporary file for the audio data
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                temp_file.write(audio_data)
                temp_file_path = temp_file.name
            
            try:
                with open(temp_file_path, "rb") as audio_file:
                    transcript = await self.client.audio.transcriptions.create(
                        model="whisper-1",
                        file=audio_file,
                        response_format="text"
                    )
                
                logger.info(f"Transcribed audio: {transcript}")
                return transcript.strip()
            finally:
                # Clean up temporary file
                if os.path.exists(temp_file_path):
                    os.unlink(temp_file_path)
            
        except Exception as e:
            logger.error(f"Error transcribing audio: {str(e)}")
            return ""
    
    async def text_to_speech(self, text: str) -> bytes:
        """Convert text to speech using OpenAI TTS"""
        try:
            response = await self.client.audio.speech.create(
                model="tts-1",
                voice="alloy",  # You can change this to: alloy, echo, fable, onyx, nova, shimmer
                input=text,
                response_format="mp3"
            )
            
            audio_data = b""
            async for chunk in response.iter_bytes():
                audio_data += chunk
            
            logger.info(f"Generated TTS audio for text: {text[:50]}...")
            return audio_data
            
        except Exception as e:
            logger.error(f"Error generating TTS: {str(e)}")
            return b""
