import asyncio
import logging
from typing import Dict, Optional, Callable
import json
from livekit import rtc, api
from livekit.rtc import AudioFrame, AudioSource
import numpy as np
from services.ai_service import AIService
from services.livekit_service import LiveKitService
from config import config

logger = logging.getLogger(__name__)

class VoicePipeline:
    """Handles the complete STT → LLM → TTS pipeline using LiveKit"""
    
    def __init__(self):
        self.ai_service = AIService()
        self.livekit_service = LiveKitService()
        self.active_sessions: Dict[str, 'VoiceSession'] = {}
    
    async def create_session(self, session_id: str, room_name: str) -> 'VoiceSession':
        """Create a new voice session"""
        session = VoiceSession(
            session_id=session_id,
            room_name=room_name,
            ai_service=self.ai_service,
            livekit_service=self.livekit_service
        )
        
        self.active_sessions[session_id] = session
        await session.initialize()
        
        logger.info(f"Created voice session {session_id}")
        return session
    
    async def end_session(self, session_id: str):
        """End a voice session"""
        if session_id in self.active_sessions:
            session = self.active_sessions[session_id]
            await session.cleanup()
            del self.active_sessions[session_id]
            logger.info(f"Ended voice session {session_id}")

class VoiceSession:
    """Manages a single voice conversation session"""
    
    def __init__(self, session_id: str, room_name: str, ai_service: AIService, livekit_service: LiveKitService):
        self.session_id = session_id
        self.room_name = room_name
        self.ai_service = ai_service
        self.livekit_service = livekit_service
        
        self.room: Optional[rtc.Room] = None
        self.audio_source: Optional[AudioSource] = None
        self.conversation_history = []
        self.is_processing = False
        self.audio_buffer = bytearray()
        self.silence_threshold = 0.01
        self.silence_duration = 0
        self.max_silence_duration = 2.0  # 2 seconds of silence triggers processing
        
        # Session tracking
        self.start_time = asyncio.get_event_loop().time()
        
        # Callbacks
        self.on_transcript: Optional[Callable] = None
        self.on_ai_response: Optional[Callable] = None
    
    async def initialize(self):
        """Initialize the LiveKit room and audio processing"""
        try:
            # Create LiveKit room
            token = await self.livekit_service.create_room_token(self.room_name, f"ai-agent-{self.session_id}")
            
            # Connect to room as AI agent
            self.room = rtc.Room()
            
            # Set up event handlers
            @self.room.on("participant_connected")
            def on_participant_connected(participant: rtc.RemoteParticipant):
                asyncio.create_task(self._on_participant_connected(participant))
            
            @self.room.on("track_subscribed")
            def on_track_subscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
                asyncio.create_task(self._on_track_subscribed(track, publication, participant))
            
            @self.room.on("track_unsubscribed")
            def on_track_unsubscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
                asyncio.create_task(self._on_track_unsubscribed(track, publication, participant))
            
            # Connect to room
            await self.room.connect(config.LIVEKIT_URL, token)
            
            # Create audio source for TTS output
            self.audio_source = rtc.AudioSource(sample_rate=24000, num_channels=1)
            track = rtc.LocalAudioTrack.create_audio_track("ai-voice", self.audio_source)
            
            # Publish the audio track
            await self.room.local_participant.publish_track(track, rtc.TrackPublishOptions())
            
            logger.info(f"Voice session {self.session_id} initialized successfully")
            
        except Exception as e:
            logger.error(f"Error initializing voice session {self.session_id}: {str(e)}")
            raise
    
    async def _on_participant_connected(self, participant: rtc.RemoteParticipant):
        """Handle participant connection"""
        logger.info(f"Participant connected: {participant.identity}")
    
    async def _on_track_subscribed(self, track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
        """Handle incoming audio track from user"""
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            logger.info(f"Subscribed to audio track from {participant.identity}")
            
            # Create audio stream
            audio_stream = rtc.AudioStream(track)
            
            # Start processing audio frames
            asyncio.create_task(self._process_audio_stream(audio_stream))
    
    async def _on_track_unsubscribed(self, track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
        """Handle track unsubscription"""
        logger.info(f"Unsubscribed from track from {participant.identity}")
    
    async def _process_audio_stream(self, audio_stream: rtc.AudioStream):
        """Process incoming audio frames for STT"""
        try:
            async for frame in audio_stream:
                if self.is_processing:
                    continue
                
                # Convert audio frame to bytes
                audio_data = self._frame_to_bytes(frame)
                
                # Add to buffer
                self.audio_buffer.extend(audio_data)
                
                # Check for silence (simple voice activity detection)
                if self._is_silence(audio_data):
                    self.silence_duration += frame.samples_per_channel / frame.sample_rate
                else:
                    self.silence_duration = 0
                
                # If we have enough silence, process the buffered audio
                if self.silence_duration >= self.max_silence_duration and len(self.audio_buffer) > 0:
                    await self._process_speech()
        
        except Exception as e:
            logger.error(f"Error processing audio stream: {str(e)}")
    
    def _frame_to_bytes(self, frame: AudioFrame) -> bytes:
        """Convert AudioFrame to bytes"""
        # Convert frame data to numpy array
        audio_array = np.frombuffer(frame.data, dtype=np.int16)
        return audio_array.tobytes()
    
    def _is_silence(self, audio_data: bytes) -> bool:
        """Simple silence detection"""
        if len(audio_data) == 0:
            return True
        
        # Convert to numpy array and calculate RMS
        audio_array = np.frombuffer(audio_data, dtype=np.int16)
        rms = np.sqrt(np.mean(audio_array.astype(np.float32) ** 2))
        
        # Normalize and check threshold
        normalized_rms = rms / 32768.0  # 16-bit audio max value
        return normalized_rms < self.silence_threshold
    
    async def _process_speech(self):
        """Process buffered speech through STT → LLM → TTS pipeline"""
        if self.is_processing or len(self.audio_buffer) == 0:
            return
        
        self.is_processing = True
        
        try:
            # Step 1: Speech-to-Text
            logger.info("Processing speech through STT...")
            audio_bytes = bytes(self.audio_buffer)
            transcript = await self.ai_service.transcribe_audio(audio_bytes)
            
            if not transcript.strip():
                logger.info("No speech detected in audio")
                return
            
            logger.info(f"User said: {transcript}")
            
            # Add to conversation history
            user_entry = {
                "role": "user",
                "content": transcript,
                "timestamp": asyncio.get_event_loop().time()
            }
            self.conversation_history.append(user_entry)
            
            # Notify frontend of transcript
            if self.on_transcript:
                await self.on_transcript(transcript)
            
            # Step 2: Generate AI response using LLM
            logger.info("Generating AI response...")
            ai_response = await self.ai_service.generate_response(transcript, self.conversation_history)
            
            # Add AI response to history
            ai_entry = {
                "role": "assistant",
                "content": ai_response,
                "timestamp": asyncio.get_event_loop().time()
            }
            self.conversation_history.append(ai_entry)
            
            logger.info(f"AI response: {ai_response}")
            
            # Notify frontend of AI response
            if self.on_ai_response:
                await self.on_ai_response(ai_response)
            
            # Step 3: Text-to-Speech
            logger.info("Converting response to speech...")
            audio_data = await self.ai_service.text_to_speech(ai_response)
            
            if audio_data:
                await self._play_audio(audio_data)
            
        except Exception as e:
            logger.error(f"Error in speech processing pipeline: {str(e)}")
        
        finally:
            # Clear buffer and reset state
            self.audio_buffer.clear()
            self.silence_duration = 0
            self.is_processing = False
    
    async def _play_audio(self, audio_data: bytes):
        """Play TTS audio through LiveKit"""
        try:
            if not self.audio_source:
                logger.error("Audio source not available")
                return
            
            # Convert MP3 audio data to PCM format for LiveKit
            # Note: In a production environment, you'd want to use a proper audio conversion library
            # For now, we'll use a simplified approach
            
            # Create audio frames from the TTS data
            # This is a simplified implementation - in production you'd want proper audio format conversion
            sample_rate = 24000
            samples_per_frame = 480  # 20ms at 24kHz
            
            # For this demo, we'll create silence frames as placeholder
            # In production, you'd convert the MP3 data to PCM format
            num_frames = len(audio_data) // (samples_per_frame * 2)  # Rough estimation
            
            for i in range(max(1, num_frames // 10)):  # Simplified for demo
                # Create a frame of silence (in production, use actual audio data)
                frame_data = np.zeros(samples_per_frame, dtype=np.int16)
                frame = AudioFrame(
                    data=frame_data.tobytes(),
                    sample_rate=sample_rate,
                    num_channels=1,
                    samples_per_channel=samples_per_frame
                )
                
                await self.audio_source.capture_frame(frame)
                await asyncio.sleep(0.02)  # 20ms delay between frames
            
            logger.info("Finished playing TTS audio")
            
        except Exception as e:
            logger.error(f"Error playing audio: {str(e)}")
    
    async def cleanup(self):
        """Clean up the session"""
        try:
            if self.room:
                await self.room.disconnect()
            
            # Calculate session duration
            session_duration = asyncio.get_event_loop().time() - self.start_time
            logger.info(f"🏠 Voice session {self.session_id} ended after {session_duration:.2f} seconds")
            
            # Clean up audio resources
            self.audio_source = None
            self.audio_buffer.clear()
            
            logger.info(f"Voice session {self.session_id} cleaned up")
            
        except Exception as e:
            logger.error(f"Error cleaning up voice session {self.session_id}: {str(e)}")

# Global pipeline instance
voice_pipeline = VoicePipeline()
