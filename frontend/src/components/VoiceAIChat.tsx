import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant, LocalParticipant } from 'livekit-client';
import './VoiceAIChat.css';

// TypeScript declarations for Web APIs
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

interface SessionData {
  session_id: string;
  room_name: string;
  token: string;
  livekit_url: string;
}

const VoiceAIChat: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<SessionData | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  // Status update interval
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isConnected && wsRef.current) {
      interval = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'status_update' }));
        }
      }, 2000); // Update status every 2 seconds
    }
    
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isConnected]);

  const createSession = async (): Promise<SessionData> => {
    const response = await fetch('http://localhost:8000/api/session/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`);
    }

    return response.json();
  };

  const connectToRoom = async (sessionData: SessionData) => {
    const room = new Room();
    roomRef.current = room;

    // Set up room event listeners
    room.on(RoomEvent.Connected, () => {
      console.log('Connected to LiveKit room');
      setIsConnected(true);
    });

    room.on(RoomEvent.Disconnected, () => {
      console.log('Disconnected from LiveKit room');
      setIsConnected(false);
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: any, participant: RemoteParticipant) => {
      console.log('Track subscribed:', track.kind, 'from', participant.identity);
      
      if (track.kind === Track.Kind.Audio && participant.identity.includes('ai-agent')) {
        // This is the AI's voice - play it
        const audioElement = track.attach();
        audioElement.volume = 0.8;
        document.body.appendChild(audioElement);
        audioElement.play().catch(e => console.error('Error playing AI audio:', e));
        
        // Clean up when track ends
        track.on('ended', () => {
          if (audioElement.parentNode) {
            audioElement.parentNode.removeChild(audioElement);
          }
        });
      }
    });

    // Listen for local audio track events to monitor user speech
    room.on(RoomEvent.LocalTrackPublished, (publication, participant) => {
      console.log('Local track published:', publication.kind);
      if (publication.kind === Track.Kind.Audio) {
        // Start monitoring user audio for speech detection
        startAudioMonitoring(publication.track);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      console.log('Track unsubscribed:', track.kind);
    });

    // Connect to room
    await room.connect(sessionData.livekit_url, sessionData.token);

    // Enable microphone for user
    await room.localParticipant.setMicrophoneEnabled(true);
    
    console.log('User microphone enabled, AI agent should be in room');
  };

  const connectWebSocket = (sessionId: string) => {
    const ws = new WebSocket(`ws://localhost:8000/ws/${sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'transcript') {
        // User speech was transcribed by the backend
        const userEntry: ConversationEntry = {
          role: 'user',
          content: data.text,
          timestamp: new Date().toISOString()
        };
        
        setConversation(prev => [...prev, userEntry]);
        setCurrentTranscript('');
        setIsProcessing(true);
        
      } else if (data.type === 'ai_response') {
        // AI response received
        const aiResponse: ConversationEntry = {
          role: 'assistant',
          content: data.text,
          timestamp: new Date().toISOString()
        };
        
        setConversation(prev => [...prev, aiResponse]);
        setIsProcessing(false);
        
        // Play AI response using browser TTS for immediate feedback
        speakText(data.text);
        
      } else if (data.type === 'error') {
        console.error('Backend error:', data.message);
        setError(data.message);
        setIsProcessing(false);
        
      } else if (data.type === 'status') {
        setIsProcessing(data.is_processing);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection error');
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };
  };

  const handleUserSpeech = useCallback(async (transcript: string) => {
    if (!transcript.trim() || !wsRef.current) return;

    const userEntry: ConversationEntry = {
      role: 'user',
      content: transcript,
      timestamp: new Date().toISOString()
    };

    setConversation(prev => [...prev, userEntry]);
    setCurrentTranscript('');
    setIsProcessing(true);

    // Send to backend via WebSocket
    wsRef.current.send(JSON.stringify({
      type: 'audio_transcript',
      text: transcript,
      timestamp: new Date().toISOString()
    }));
  }, []);

  const startAudioMonitoring = useCallback((audioTrack: any) => {
    console.log('Starting audio monitoring for user speech');
    
    // Use browser's speech recognition for better reliability
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      
      // Enhanced configuration for better speech detection
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      
      // Add these properties to improve detection
      if ('webkitSpeechRecognition' in window) {
        recognition.webkitContinuous = true;
        recognition.webkitInterimResults = true;
      }

      recognition.onstart = () => {
        console.log('Speech recognition started successfully');
        setError(null); // Clear any previous errors
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        if (finalTranscript) {
          console.log('User speech detected:', finalTranscript);
          handleUserSpeech(finalTranscript);
          setCurrentTranscript('');
        } else {
          setCurrentTranscript(interimTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        
        if (event.error === 'no-speech') {
          console.log('No speech detected, continuing to listen...');
          // Don't show error for no-speech, just continue listening
          setCurrentTranscript('Listening... (speak clearly into your microphone)');
        } else if (event.error === 'audio-capture') {
          setError('Microphone access denied or not available. Please check your microphone permissions.');
        } else if (event.error === 'not-allowed') {
          setError('Microphone permission denied. Please allow microphone access and refresh the page.');
        } else if (event.error === 'network') {
          setError('Network error. Please check your internet connection.');
        } else {
          setError(`Speech recognition error: ${event.error}`);
        }
      };

      recognition.onend = () => {
        console.log('Speech recognition ended');
        if (isRecording && isConnected) {
          console.log('Restarting speech recognition...');
          // Add a small delay before restarting to prevent rapid restarts
          setTimeout(() => {
            try {
              recognition.start();
            } catch (e) {
              console.error('Error restarting speech recognition:', e);
              setError('Failed to restart speech recognition. Please try stopping and starting the conversation again.');
            }
          }, 500);
        }
      };

      recognitionRef.current = recognition;
      
      try {
        recognition.start();
        console.log('Speech recognition start requested');
      } catch (e) {
        console.error('Error starting speech recognition:', e);
        setError('Failed to start speech recognition. Please ensure microphone permissions are granted.');
      }
    } else {
      setError('Speech recognition not supported in this browser. Please use Chrome, Edge, or Safari.');
    }
  }, [isRecording, isConnected, handleUserSpeech]);

  const speakText = async (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 0.8;
      
      // Use a pleasant voice if available
      const voices = speechSynthesis.getVoices();
      const femaleVoice = voices.find(voice => 
        voice.name.includes('Female') || 
        voice.name.includes('Samantha') ||
        voice.name.includes('Karen') ||
        voice.name.includes('Moira')
      );
      
      if (femaleVoice) {
        utterance.voice = femaleVoice;
      }

      speechSynthesis.speak(utterance);
    }
  };

  const testMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Microphone access granted');
      stream.getTracks().forEach(track => track.stop()); // Stop the test stream
      return true;
    } catch (err) {
      console.error('Microphone test failed:', err);
      setError('Microphone access denied. Please allow microphone access and refresh the page.');
      return false;
    }
  };

  const startConversation = async () => {
    try {
      setError(null);
      
      // Test microphone access first
      const microphoneOk = await testMicrophone();
      if (!microphoneOk) {
        return;
      }
      
      // Create session (this also creates the AI agent in the room)
      const sessionData = await createSession();
      sessionRef.current = sessionData;

      // Connect to LiveKit room
      await connectToRoom(sessionData);

      // Connect WebSocket for status updates
      connectWebSocket(sessionData.session_id);

      // Set recording state (LiveKit handles the actual audio)
      setIsRecording(true);

      console.log('Voice conversation started - speak naturally!');

    } catch (err) {
      console.error('Error starting conversation:', err);
      setError(err instanceof Error ? err.message : 'Failed to start conversation');
    }
  };

  const stopConversation = async () => {
    try {
      // Stop recording state
      setIsRecording(false);

      // Stop speech recognition
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }

      // Disconnect from room
      if (roomRef.current) {
        await roomRef.current.disconnect();
        roomRef.current = null;
      }

      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // End session (this will clean up the voice pipeline)
      if (sessionRef.current) {
        await fetch(`http://localhost:8000/api/session/${sessionRef.current.session_id}`, {
          method: 'DELETE',
        });
        sessionRef.current = null;
      }

      setIsConnected(false);
      setCurrentTranscript('');
      setIsProcessing(false);

      console.log('Voice conversation stopped');

    } catch (err) {
      console.error('Error stopping conversation:', err);
      setError(err instanceof Error ? err.message : 'Failed to stop conversation');
    }
  };

  const clearConversation = () => {
    setConversation([]);
    setError(null);
  };

  return (
    <div className="voice-ai-chat">
      <div className="controls">
        {!isConnected ? (
          <button 
            className="start-button" 
            onClick={startConversation}
            disabled={isProcessing}
          >
            🎤 Start Conversation
          </button>
        ) : (
          <button 
            className="stop-button" 
            onClick={stopConversation}
            disabled={isProcessing}
          >
            🛑 Stop Conversation
          </button>
        )}
        
        <button 
          className="clear-button" 
          onClick={clearConversation}
          disabled={isConnected}
        >
          🗑️ Clear History
        </button>
      </div>

      <div className="status">
        {isConnected && (
          <div className="status-indicator connected">
            <span className="status-dot"></span>
            Connected - Speak naturally!
          </div>
        )}
        
        {isRecording && (
          <div className="recording-indicator">
            <span className="recording-dot"></span>
            Listening...
          </div>
        )}
        
        {isProcessing && (
          <div className="processing-indicator">
            <span className="processing-spinner"></span>
            AI is thinking...
          </div>
        )}
      </div>

      {currentTranscript && (
        <div className="current-transcript">
          <strong>
            {currentTranscript.includes('Listening...') ? '🎤 ' : 'You\'re saying: '}
          </strong> 
          {currentTranscript}
        </div>
      )}

      {isRecording && !currentTranscript && !isProcessing && (
        <div className="listening-prompt">
          <div className="listening-animation">
            <span className="pulse-dot"></span>
            <span className="pulse-dot"></span>
            <span className="pulse-dot"></span>
          </div>
          <p><strong>🎤 Listening for your voice...</strong></p>
          <p className="listening-tips">
            💡 <strong>Tips:</strong> Speak clearly, ensure microphone permissions are granted, 
            and check that your microphone is not muted.
          </p>
        </div>
      )}

      {error && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      <div className="conversation-history">
        <h3>Conversation</h3>
        <div className="messages">
          {conversation.length === 0 ? (
            <div className="empty-state">
              Start a conversation by clicking the microphone button above!
            </div>
          ) : (
            conversation.map((entry, index) => (
              <div key={index} className={`message ${entry.role}`}>
                <div className="message-header">
                  <span className="role">
                    {entry.role === 'user' ? '👤 You' : '🤖 AI Assistant'}
                  </span>
                  {entry.timestamp && (
                    <span className="timestamp">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div className="message-content">
                  {entry.content}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default VoiceAIChat;
