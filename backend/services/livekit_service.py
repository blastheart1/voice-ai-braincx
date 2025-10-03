import asyncio
import logging
from typing import Optional
from livekit import api, rtc
from livekit.api import AccessToken, VideoGrants
from config import config

logger = logging.getLogger(__name__)

class LiveKitService:
    def __init__(self):
        self.api_key = config.LIVEKIT_API_KEY
        self.api_secret = config.LIVEKIT_API_SECRET
        self.url = config.LIVEKIT_URL
        self.livekit_api = None
    
    async def _get_api_client(self):
        """Get or create LiveKit API client"""
        if self.livekit_api is None:
            self.livekit_api = api.LiveKitAPI(
                url=self.url,
                api_key=self.api_key,
                api_secret=self.api_secret
            )
        return self.livekit_api
    
    async def create_room_token(self, room_name: str, participant_identity: str) -> str:
        """Create a room and generate access token for participant"""
        try:
            # Create room if it doesn't exist
            await self.create_room(room_name)
            
            # Generate access token
            token = AccessToken(self.api_key, self.api_secret)
            token.identity = participant_identity
            token.with_grants(VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True
            ))
            
            jwt_token = token.to_jwt()
            logger.info(f"Generated token for participant {participant_identity} in room {room_name}")
            return jwt_token
            
        except Exception as e:
            logger.error(f"Error creating room token: {str(e)}")
            raise
    
    async def create_room(self, room_name: str) -> None:
        """Create a LiveKit room"""
        try:
            livekit_api = await self._get_api_client()
            room_info = await livekit_api.room.create_room(
                api.CreateRoomRequest(name=room_name)
            )
            logger.info(f"🏠 Created room: {room_info.name} at {asyncio.get_event_loop().time()}")
        except Exception as e:
            # Room might already exist, which is fine
            if "already exists" not in str(e).lower():
                logger.error(f"Error creating room {room_name}: {str(e)}")
                raise
    
    async def end_room(self, room_name: str) -> None:
        """End a LiveKit room"""
        try:
            livekit_api = await self._get_api_client()
            await livekit_api.room.delete_room(
                api.DeleteRoomRequest(room=room_name)
            )
            logger.info(f"🏠 Ended room: {room_name} at {asyncio.get_event_loop().time()}")
        except Exception as e:
            logger.error(f"Error ending room {room_name}: {str(e)}")
            # Don't raise - room cleanup is not critical
    
    async def list_participants(self, room_name: str) -> list:
        """List participants in a room"""
        try:
            livekit_api = await self._get_api_client()
            participants = await livekit_api.room.list_participants(
                api.ListParticipantsRequest(room=room_name)
            )
            return participants.participants
        except Exception as e:
            logger.error(f"Error listing participants in room {room_name}: {str(e)}")
            return []
