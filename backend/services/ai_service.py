import asyncio
import logging
from typing import List, Dict, Any
import openai
from openai import AsyncOpenAI
import io
import tempfile
import os
import httpx
import hashlib
import time
from config import config

logger = logging.getLogger(__name__)

class AIService:
    def __init__(self):
        # Create HTTP client with connection pooling for faster API calls
        self.http_client = httpx.AsyncClient(
            limits=httpx.Limits(
                max_connections=10,
                max_keepalive_connections=5,
                keepalive_expiry=30.0
            ),
            timeout=30.0
        )
        
        # Initialize OpenAI client with custom HTTP client
        self.client = AsyncOpenAI(
            api_key=config.OPENAI_API_KEY,
            http_client=self.http_client
        )
        self.system_prompt = config.SYSTEM_PROMPT
        
        # Response caching for common interactions
        self.response_cache: Dict[str, Dict[str, Any]] = {}
        self.cache_ttl = 3600  # 1 hour cache TTL
        self.max_cache_size = 100  # Maximum cached responses
        
        # Context-aware conversation memory
        self.conversation_memory: Dict[str, Dict[str, Any]] = {}
        self.memory_ttl = 24 * 3600  # 24 hours memory retention
        self.max_memory_entries = 50  # Maximum stored conversations
    
    async def close(self):
        """Close HTTP client connections"""
        await self.http_client.aclose()
    
    def _get_cache_key(self, user_input: str, conversation_history: List[Dict[str, Any]]) -> str:
        """Generate cache key for response caching"""
        # Create a hash based on user input and conversation context
        context_str = ""
        if conversation_history:
            # Include the last few messages for context-aware caching
            recent_context = conversation_history[-3:] if len(conversation_history) > 3 else conversation_history
            context_str = str(recent_context)
        
        cache_input = f"{user_input.lower().strip()}{context_str}"
        return hashlib.md5(cache_input.encode()).hexdigest()
    
    def _is_cacheable_input(self, user_input: str) -> bool:
        """Check if the input is suitable for caching"""
        # Common phrases that are good candidates for caching
        cacheable_patterns = [
            'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
            'thank you', 'thanks', 'thank you very much',
            'goodbye', 'bye', 'see you later', 'good night',
            'how are you', 'how are you doing', 'how\'s it going',
            'what can you do', 'what can you help with', 'help me',
            'yes', 'no', 'okay', 'ok', 'sure', 'alright',
            'sorry', 'excuse me', 'pardon me',
            'please', 'could you', 'can you'
        ]
        
        user_lower = user_input.lower().strip()
        return any(pattern in user_lower for pattern in cacheable_patterns) and len(user_input) < 50
    
    def _cleanup_cache(self):
        """Remove expired cache entries and maintain size limit"""
        current_time = time.time()
        
        # Remove expired entries
        expired_keys = [
            key for key, value in self.response_cache.items()
            if current_time - value['timestamp'] > self.cache_ttl
        ]
        for key in expired_keys:
            del self.response_cache[key]
        
        # Maintain size limit (remove oldest entries)
        if len(self.response_cache) > self.max_cache_size:
            sorted_cache = sorted(
                self.response_cache.items(),
                key=lambda x: x[1]['timestamp']
            )
            excess_count = len(self.response_cache) - self.max_cache_size
            for key, _ in sorted_cache[:excess_count]:
                del self.response_cache[key]

    def _get_user_id(self, conversation_history: List[Dict[str, Any]]) -> str:
        """Extract or generate user ID from conversation history"""
        # For now, use a simple hash of the initialization message
        if conversation_history and len(conversation_history) > 0:
            first_message = conversation_history[0]
            if first_message.get("role") == "user":
                user_id = hashlib.md5(first_message["content"].encode()).hexdigest()[:8]
                return f"user_{user_id}"
        return "anonymous"

    def _store_conversation_memory(self, user_id: str, conversation_history: List[Dict[str, Any]]):
        """Store conversation context for future sessions"""
        if not conversation_history:
            return
        
        # Extract key information from conversation
        topics = []
        preferences = []
        context_summary = ""
        
        # Analyze conversation for key themes
        for entry in conversation_history[-10:]:  # Last 10 messages
            content = entry.get("content", "").lower()
            
            # Extract topics (simple keyword matching)
            topic_keywords = {
                "travel": ["travel", "trip", "vacation", "flight", "hotel", "destination"],
                "technology": ["technology", "tech", "software", "programming", "computer"],
                "food": ["food", "restaurant", "recipe", "cooking", "meal"],
                "health": ["health", "fitness", "exercise", "doctor", "medical"],
                "business": ["business", "work", "job", "career", "company"]
            }
            
            for topic, keywords in topic_keywords.items():
                if any(keyword in content for keyword in keywords):
                    if topic not in topics:
                        topics.append(topic)
        
        # Store memory with timestamp
        memory_data = {
            "user_id": user_id,
            "last_interaction": time.time(),
            "topics": topics[:3],  # Top 3 topics
            "conversation_length": len(conversation_history),
            "recent_context": [entry["content"] for entry in conversation_history[-3:] if entry.get("role") == "user"],
            "preferences": preferences,
            "context_summary": f"Previous conversation covered: {', '.join(topics)}" if topics else "General conversation"
        }
        
        self.conversation_memory[user_id] = memory_data
        logger.info(f"🧠 Stored memory for {user_id}: topics={topics}, context_length={len(conversation_history)}")

    def _get_conversation_memory(self, user_id: str) -> Dict[str, Any]:
        """Retrieve stored conversation context"""
        if user_id in self.conversation_memory:
            memory = self.conversation_memory[user_id]
            # Check if memory is still valid
            if time.time() - memory["last_interaction"] < self.memory_ttl:
                logger.info(f"🔍 Retrieved memory for {user_id}: topics={memory.get('topics', [])}")
                return memory
            else:
                # Memory expired, remove it
                del self.conversation_memory[user_id]
                logger.info(f"⏰ Memory expired for {user_id}")
        
        return {}

    def _cleanup_memory(self):
        """Remove expired memory entries"""
        current_time = time.time()
        
        # Remove expired entries
        expired_users = [
            user_id for user_id, memory in self.conversation_memory.items()
            if current_time - memory["last_interaction"] > self.memory_ttl
        ]
        for user_id in expired_users:
            del self.conversation_memory[user_id]
        
        # Maintain size limit
        if len(self.conversation_memory) > self.max_memory_entries:
            sorted_memory = sorted(
                self.conversation_memory.items(),
                key=lambda x: x[1]["last_interaction"]
            )
            excess_count = len(self.conversation_memory) - self.max_memory_entries
            for user_id, _ in sorted_memory[:excess_count]:
                del self.conversation_memory[user_id]

    async def generate_response(self, user_input: str, conversation_history: List[Dict[str, Any]]) -> str:
        """Generate AI response using OpenAI GPT with caching"""
        try:
            # Clean up cache and memory periodically
            self._cleanup_cache()
            self._cleanup_memory()
            
            # Get user ID and retrieve conversation memory
            user_id = self._get_user_id(conversation_history)
            memory = self._get_conversation_memory(user_id)
            
            # Check if response is cacheable and exists in cache
            if self._is_cacheable_input(user_input):
                cache_key = self._get_cache_key(user_input, conversation_history)
                
                if cache_key in self.response_cache:
                    cached_entry = self.response_cache[cache_key]
                    if time.time() - cached_entry['timestamp'] < self.cache_ttl:
                        logger.info(f"🚀 CACHE HIT for input: '{user_input[:30]}...'")
                        # Still store memory even for cached responses
                        self._store_conversation_memory(user_id, conversation_history)
                        return cached_entry['response']
                    else:
                        # Remove expired entry
                        del self.response_cache[cache_key]
            # Use the first user message as the system prompt (initialization)
            # If there's conversation history, the first message should be the initialization
            if conversation_history and len(conversation_history) > 0:
                first_message = conversation_history[0]
                if first_message["role"] == "user":
                    # Use the first user message as system prompt with memory context
                    memory_context = ""
                    if memory:
                        topics = memory.get("topics", [])
                        context_summary = memory.get("context_summary", "")
                        recent_context = memory.get("recent_context", [])
                        
                        if topics or recent_context:
                            memory_context = f"\n\nCONTEXT FROM PREVIOUS CONVERSATIONS: {context_summary}"
                            if recent_context:
                                memory_context += f" Recent topics we discussed: {', '.join(recent_context[-2:])}."
                            memory_context += " Build upon this previous context naturally."
                    
                    system_content = f"You are an AI assistant. {first_message['content']} Stay focused on this role and topic throughout the conversation. Maintain context from previous exchanges and build upon them naturally.{memory_context} IMPORTANT: This is a voice conversation, so keep responses short but complete - aim for 2-3 sentences maximum. Be concise, helpful, and engaging without cutting off mid-thought."
                    messages = [{"role": "system", "content": system_content}]
                    
                    # Add the rest of the conversation history (skip the first initialization message)
                    # Keep only last 12 exchanges to maintain context while reducing token usage
                    recent_history = conversation_history[1:]  # Skip only the initialization message
                    recent_history = recent_history[-12:] if len(recent_history) > 12 else recent_history
                else:
                    # Fallback to default system prompt with brevity guidelines
                    enhanced_prompt = f"{self.system_prompt} IMPORTANT: This is a voice conversation, so keep responses short but complete - aim for 2-3 sentences maximum. Be concise, helpful, and engaging without cutting off mid-thought."
                    messages = [{"role": "system", "content": enhanced_prompt}]
                    recent_history = conversation_history[-15:] if len(conversation_history) > 15 else conversation_history
            else:
                # No conversation history, use default system prompt with brevity guidelines
                enhanced_prompt = f"{self.system_prompt} IMPORTANT: This is a voice conversation, so keep responses short but complete - aim for 2-3 sentences maximum. Be concise, helpful, and engaging without cutting off mid-thought."
                messages = [{"role": "system", "content": enhanced_prompt}]
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
            
            # Debug: Log the messages being sent for context analysis
            logger.debug("Messages being sent to OpenAI:")
            for i, msg in enumerate(messages):
                logger.debug(f"  {i}: {msg['role']}: {msg['content'][:100]}...")
            
            if conversation_history:
                logger.debug(f"Total conversation history length: {len(conversation_history)}")
                logger.debug(f"First message (initialization): {conversation_history[0].get('content', '')[:50]}...")
                if len(conversation_history) > 1:
                    logger.debug(f"Last message: {conversation_history[-1].get('content', '')[:50]}...")
            
            # Generate response with optimized settings for voice chat
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",  # More cost-effective than gpt-3.5-turbo
                messages=messages,
                max_tokens=120,  # Allow for complete but concise responses
                temperature=0.6,  # Slightly lower for more focused responses
                stream=False
            )
            
            ai_response = response.choices[0].message.content.strip()
            
            # Post-process response for brevity and voice optimization
            ai_response = self._optimize_response_for_voice(ai_response)
            
            # Cache the response if it's cacheable
            if self._is_cacheable_input(user_input):
                cache_key = self._get_cache_key(user_input, conversation_history)
                self.response_cache[cache_key] = {
                    'response': ai_response,
                    'timestamp': time.time()
                }
                logger.info(f"💾 CACHED response for input: '{user_input[:30]}...'")
            
            # Store conversation memory for future sessions
            updated_history = conversation_history + [{"role": "assistant", "content": ai_response}]
            self._store_conversation_memory(user_id, updated_history)
            
            logger.info(f"AI response: {ai_response}")
            
            return ai_response
            
        except Exception as e:
            logger.error(f"Error generating AI response: {str(e)}")
            return "I'm sorry, I'm having trouble processing your request right now. Could you please try again?"
    
    def _optimize_response_for_voice(self, response: str) -> str:
        """Optimize AI response for voice conversation while preserving completeness"""
        # Remove excessive punctuation that doesn't work well in speech
        response = response.replace("...", ".")
        response = response.replace("!!", "!")
        response = response.replace("??", "?")
        
        # Split into sentences while preserving question marks and exclamations
        import re
        sentences = [s.strip() for s in re.split(r'[.!?]+', response) if s.strip()]
        
        # Allow up to 3 complete sentences for voice conversation
        if len(sentences) > 3:
            # Reconstruct the response with proper punctuation
            reconstructed = []
            original_parts = re.findall(r'[^.!?]*[.!?]', response)
            for i, sentence in enumerate(sentences[:3]):
                if i < len(original_parts):
                    reconstructed.append(original_parts[i].strip())
                else:
                    reconstructed.append(sentence + '.')
            response = ' '.join(reconstructed)
        
        # Only truncate if response is extremely long (over 400 characters)
        # This allows for complete thoughts while preventing very long monologues
        if len(response) > 400:
            # Find the last complete sentence within 350 characters
            truncated = response[:350]
            last_punct = max(truncated.rfind('.'), truncated.rfind('!'), truncated.rfind('?'))
            if last_punct > 200:  # Make sure we don't cut too short
                response = truncated[:last_punct + 1]
            else:
                # If no good break point, add ellipsis but warn
                response = truncated.rstrip() + "..."
                logger.warning(f"Had to truncate response mid-sentence: {response}")
        
        # Remove any trailing whitespace
        response = response.strip()
        
        # Ensure response ends with proper punctuation
        if response and response[-1] not in '.!?':
            response += '.'
        
        return response
    
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
    
    async def text_to_speech(self, text: str, voice: str = "nova") -> bytes:
        """Convert text to speech using OpenAI TTS (non-streaming)"""
        try:
            logger.info(f"Calling OpenAI TTS with model=tts-1, voice={voice}, text_length={len(text)}")
            response = await self.client.audio.speech.create(
                model="tts-1",  # Faster model for quick wins
                voice=voice,  # Use the provided voice parameter
                input=text,
                response_format="opus"  # Smaller file size, faster transfer
            )
            logger.info("OpenAI TTS response received successfully")
            
            # Get the audio content directly
            audio_data = response.content
            
            logger.info(f"Generated TTS audio for text: {text[:50]}..., audio size: {len(audio_data)} bytes")
            return audio_data
            
        except Exception as e:
            logger.error(f"Error generating TTS: {str(e)}")
            return b""
    
    async def text_to_speech_streaming(self, text: str, voice: str = "nova"):
        """Convert text to speech using OpenAI TTS with improved chunking"""
        try:
            logger.info(f"🌊 Starting IMPROVED STREAMING TTS with model=tts-1, voice={voice}, text_length={len(text)}")
            
            # Natural chunking strategy: split at natural speech pause points
            import re
            
            # Split at natural pause points for more conversational flow
            chunks = []
            
            # Primary split: sentences and major clauses
            sentence_parts = re.split(r'([.!?]+)', text)
            current_chunk = ""
            
            for i, part in enumerate(sentence_parts):
                if re.match(r'[.!?]+', part):
                    # This is punctuation - add to current chunk and finalize
                    current_chunk += part
                    if current_chunk.strip() and len(current_chunk.strip()) > 20:
                        chunks.append(current_chunk.strip())
                        current_chunk = ""
                elif part.strip():
                    current_chunk += part
            
            # Add any remaining text
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
            
            # If we only got one chunk, try secondary split at commas and conjunctions
            if len(chunks) <= 1 and len(text) > 100:
                chunks = []
                # Split at commas and major conjunctions for longer responses
                parts = re.split(r'(,\s+(?:and|but|or|however|therefore|meanwhile|also|because|since|while|although)\s+|,\s+)', text)
                
                current_chunk = ""
                for part in parts:
                    current_chunk += part
                    # Create chunk at natural pause points with reasonable length
                    if (part.endswith(',') or re.match(r',\s+(?:and|but|or|however|therefore|meanwhile|also|because|since|while|although)\s+', part)) and len(current_chunk.strip()) > 40:
                        chunks.append(current_chunk.strip())
                        current_chunk = ""
                
                if current_chunk.strip():
                    chunks.append(current_chunk.strip())
            
            # If we didn't get good chunks, fall back to word-based chunking with size limits
            if len(chunks) <= 1 and len(text.split()) > 6:
                words = text.split()
                chunks = []
                current_chunk = ""
                
                for word in words:
                    # Check if adding this word would exceed our safe limit
                    test_chunk = current_chunk + (" " if current_chunk else "") + word
                    
                    if len(test_chunk) <= 45:  # Safe chunk size limit
                        current_chunk = test_chunk
                    else:
                        # Finalize current chunk and start new one
                        if current_chunk:
                            if len(chunks) < len(words) // 6:  # Not the last chunk
                                current_chunk += ","  # Add pause
                            chunks.append(current_chunk)
                        current_chunk = word
                
                # Add final chunk
                if current_chunk:
                    chunks.append(current_chunk)
            
            # Apply reasonable size limits while preserving natural breaks
            safe_chunks = []
            for chunk in chunks:
                if len(chunk) <= 120:  # Increased limit for more natural chunks
                    safe_chunks.append(chunk)
                else:
                    # Split oversized chunks at natural points first
                    if ',' in chunk:
                        # Split at commas for natural breaks
                        comma_parts = chunk.split(',')
                        current_piece = ""
                        
                        for part in comma_parts:
                            test_piece = current_piece + ("," if current_piece else "") + part
                            if len(test_piece) <= 120:
                                current_piece = test_piece
                            else:
                                if current_piece:
                                    safe_chunks.append(current_piece + ",")
                                current_piece = part.strip()
                        
                        if current_piece:
                            safe_chunks.append(current_piece)
                    else:
                        # Fall back to word-based splitting for very long chunks
                        words = chunk.split()
                        current_piece = ""
                        
                        for word in words:
                            test_piece = current_piece + (" " if current_piece else "") + word
                            if len(test_piece) <= 120:
                                current_piece = test_piece
                            else:
                                if current_piece:
                                    safe_chunks.append(current_piece)
                                current_piece = word
                        
                        if current_piece:
                            safe_chunks.append(current_piece)
            
            chunks = safe_chunks if safe_chunks else [text[:120]]  # Fallback for edge cases
            
            logger.info(f"🌿 Split text into {len(chunks)} NATURAL chunks for streaming")
            
            for i, chunk in enumerate(chunks):
                if not chunk.strip():
                    continue
                    
                chunk_size = len(chunk)
                # Determine chunk type for better logging
                chunk_type = "sentence" if chunk.rstrip().endswith(('.', '!', '?')) else \
                           "clause" if chunk.rstrip().endswith((',', ';')) else \
                           "phrase"
                
                logger.info(f"🎵 Generating NATURAL audio chunk {i+1}/{len(chunks)} ({chunk_type}, {chunk_size} chars): '{chunk[:40]}...'")
                
                # Safety check - warn if chunk is still too large (increased threshold)
                if chunk_size > 150:
                    logger.warning(f"⚠️ Natural chunk {i+1} is very large ({chunk_size} chars) - may cause issues")
                
                # Add delay between chunks to simulate streaming (slightly longer for natural flow)
                if i > 0:
                    await asyncio.sleep(0.4)  # 400ms delay for more natural pacing
                
                response = await self.client.audio.speech.create(
                    model="tts-1",  # Fast model for streaming
                    voice=voice,
                    input=chunk,
                    response_format="opus"
                )
                
                audio_chunk = response.content
                logger.info(f"✅ Generated chunk {i+1}: {len(audio_chunk)} bytes")
                
                yield {
                    'chunk_index': i,
                    'total_chunks': len(chunks),
                    'audio_data': audio_chunk,
                    'text': chunk,
                    'is_final': i == len(chunks) - 1
                }
            
            logger.info("🎉 Improved streaming TTS completed successfully")
            
        except Exception as e:
            logger.error(f"Error in streaming TTS: {str(e)}")
            # Fallback to single chunk
            fallback_audio = await self.text_to_speech(text, voice)
            if fallback_audio:
                yield {
                    'chunk_index': 0,
                    'total_chunks': 1,
                    'audio_data': fallback_audio,
                    'text': text,
                    'is_final': True
                }
