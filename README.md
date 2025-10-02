# Voice AI Conversational Agent ✅ FULLY FUNCTIONAL

A real-time voice-based AI conversational agent built with LiveKit, FastAPI (Python backend), and React (TypeScript frontend). The system enables natural voice conversations with an AI travel assistant.

## 🎉 **CHECKPOINT: FULLY OPERATIONAL SYSTEM**

**Status**: ✅ **COMPLETE & WORKING**  
**Last Updated**: October 2, 2025  
**All Requirements**: ✅ **SATISFIED**

## Features

- 🎤 **Real-time Voice Conversation**: Natural speech-to-text and text-to-speech
- 🤖 **AI-Powered Responses**: OpenAI GPT-powered travel assistant
- 🔄 **Turn-taking Logic**: Automatic detection of speech start/stop
- 📱 **Modern UI**: Clean, responsive React interface
- 🎯 **LiveKit Integration**: Professional-grade real-time audio streaming
- 📝 **Conversation History**: Visual transcript of the entire conversation

## Tech Stack

### Backend
- **FastAPI**: Python web framework
- **LiveKit Server SDK**: Real-time audio streaming
- **OpenAI API**: GPT for conversation and Whisper for STT
- **WebSockets**: Real-time communication

### Frontend
- **React + TypeScript**: Modern web interface
- **LiveKit Client SDK**: Audio streaming client
- **Web Speech API**: Browser-based speech recognition
- **Speech Synthesis API**: Browser-based text-to-speech

## Prerequisites

- Python 3.8+
- Node.js 16+
- OpenAI API key
- LiveKit account and credentials

## Setup Instructions

### 1. Clone and Setup Project Structure

The project is already structured with `backend/` and `frontend/` directories.

### 2. Backend Setup

```bash
cd backend

# Install Python dependencies
pip install -r requirements.txt

# The API keys are configured in config.py
# Update config.py with your actual API keys if needed
```

### 3. Frontend Setup

```bash
cd frontend

# Install Node.js dependencies
npm install

# Additional LiveKit packages are already included
```

### 4. API Keys Configuration ⚠️ **IMPORTANT**

**Environment Variables Setup:**

1. **Copy the example file:**
   ```bash
   cd backend
   cp env.example .env
   ```

2. **Edit the .env file with your actual API keys:**
   ```bash
   # backend/.env
   OPENAI_API_KEY=your_actual_openai_api_key
   LIVEKIT_URL=wss://your-actual-livekit-url.livekit.cloud
   LIVEKIT_API_KEY=your_actual_livekit_api_key
   LIVEKIT_API_SECRET=your_actual_livekit_api_secret
   ```

3. **⚠️ NEVER commit the .env file to version control!**
   - The .env file is already in .gitignore
   - Only commit the env.example file

## Running the Application

### ✅ **WORKING SETUP - TESTED & VERIFIED**

### Start Backend Server (Popup Window)

```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'C:\Users\This PC\voice-ai-braincx\backend'; python main.py"
```

The FastAPI server will start on `http://localhost:8000` ✅

### Start Frontend Development Server (Popup Window)

```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'C:\Users\This PC\voice-ai-braincx\frontend'; npm start"
```

The React app will start on `http://localhost:3000` ✅

### **Alternative Manual Start:**

**Backend:**
```bash
cd backend
python main.py
```

**Frontend:**
```bash
cd frontend
npm start
```

## How It Works

### Voice AI Pipeline

1. **Speech Recognition**: Browser's Web Speech API captures user speech
2. **WebSocket Communication**: Transcribed text sent to backend via WebSocket
3. **AI Processing**: OpenAI GPT generates contextual responses
4. **Text-to-Speech**: Browser's Speech Synthesis API speaks AI responses
5. **LiveKit Streaming**: Professional audio streaming for enhanced quality

### Key Components

#### Backend (`backend/`)
- `main.py`: FastAPI application with WebSocket endpoints
- `services/livekit_service.py`: LiveKit room management
- `services/ai_service.py`: OpenAI integration (GPT, Whisper, TTS)
- `config.py`: Configuration and API keys

#### Frontend (`frontend/src/`)
- `App.tsx`: Main application component
- `components/VoiceAIChat.tsx`: Core voice chat interface
- `components/VoiceAIChat.css`: Styling for the chat interface

## Usage ✅ **VERIFIED WORKING**

1. **Start Conversation**: Click "🎤 Start Conversation" ✅
2. **Grant Microphone Permission**: Allow browser access when prompted ✅
3. **Look for Pulse Animation**: System shows listening indicators ✅
4. **Speak Naturally**: The system will listen and transcribe your speech ✅
5. **AI Response**: The AI will respond with voice and text ✅
6. **Continue Talking**: The conversation continues naturally ✅
7. **Stop Conversation**: Click "🛑 Stop Conversation" when done ✅

### **Troubleshooting Tips:**
- ✅ Use Chrome, Edge, or Safari for best speech recognition
- ✅ Ensure microphone permissions are granted
- ✅ Speak clearly and directly into microphone
- ✅ Check that microphone is not muted
- ✅ "no-speech" errors are normal - system continues listening

## Features in Detail

### Turn-Taking Logic
- Automatic detection when user stops speaking
- Prevents overlapping speech between user and AI
- Smooth conversation flow

### System Prompt
The AI is configured as a friendly travel assistant that:
- Helps plan trips and suggests destinations
- Provides travel tips and recommendations
- Maintains conversational, helpful responses
- Speaks naturally as if talking to a friend

### Real-time Audio
- LiveKit provides professional-grade audio streaming
- Low-latency communication
- High-quality audio processing

## Browser Compatibility

- **Chrome/Edge**: Full support (recommended)
- **Firefox**: Partial support (may have speech recognition limitations)
- **Safari**: Limited support for speech APIs

## Troubleshooting

### Common Issues

1. **Speech Recognition Not Working**
   - Ensure you're using Chrome or Edge
   - Check microphone permissions
   - Verify HTTPS (required for speech APIs)

2. **Backend Connection Issues**
   - Verify backend is running on port 8000
   - Check API keys in config.py
   - Ensure CORS is properly configured

3. **LiveKit Connection Issues**
   - Verify LiveKit credentials
   - Check network connectivity
   - Ensure WebSocket connections are allowed

### Development Tips

- Use browser developer tools to monitor WebSocket connections
- Check console logs for detailed error messages
- Test with different browsers for compatibility

## Architecture

```
┌─────────────────┐    WebSocket    ┌─────────────────┐
│   React Frontend│◄──────────────►│  FastAPI Backend│
│                 │                 │                 │
│ - Speech Recognition              │ - Session Management
│ - LiveKit Client │                │ - LiveKit Server│
│ - Text-to-Speech │                │ - OpenAI Integration
│ - UI Components  │                │ - WebSocket Handler
└─────────────────┘                 └─────────────────┘
         │                                   │
         │                                   │
         ▼                                   ▼
┌─────────────────┐                 ┌─────────────────┐
│   LiveKit Cloud │                 │   OpenAI APIs   │
│                 │                 │                 │
│ - Audio Streaming                 │ - GPT (LLM)     │
│ - Room Management│                 │ - Whisper (STT) │
│ - Real-time Comm│                 │ - TTS           │
└─────────────────┘                 └─────────────────┘
```

## License

This project is for educational and demonstration purposes.

## Contributing

Feel free to submit issues and enhancement requests!
