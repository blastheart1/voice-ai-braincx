import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant } from 'livekit-client';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Trash2, LogOut, Send, Loader2, Volume2, MessageSquare, Clock } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { Card, CardContent } from './ui/card';

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

// Synthesis Completion Tracking System
class SynthesisTracker {
  private synthesisId: number | null;
  private isAudioPlaying: boolean;
  private completionCallbacks: Array<(synthesisId: number | null) => void>;

  constructor() {
    this.synthesisId = null;
    this.isAudioPlaying = false;
    this.completionCallbacks = [];
  }

  startSynthesis(text: string): number {
    this.synthesisId = Date.now() + Math.random();
    this.isAudioPlaying = true;
    console.log(`[SYNTHESIS-${this.synthesisId}] Started: "${text.substring(0, 30)}..."`);
    return this.synthesisId;
  }

  completeSynthesis(synthesisId: number): void {
    if (this.synthesisId === synthesisId) {
      this.isAudioPlaying = false;
      console.log(`[SYNTHESIS-${synthesisId}] COMPLETED - Safe to restart listening`);
      
      // Trigger all completion callbacks
      this.completionCallbacks.forEach(callback => callback(synthesisId));
      this.completionCallbacks = [];
      this.synthesisId = null;
    }
  }

  onSynthesisComplete(callback: (synthesisId: number | null) => void): void {
    if (!this.isAudioPlaying) {
      callback(null); // Already complete
    } else {
      this.completionCallbacks.push(callback);
    }
  }

  isComplete(): boolean {
    return !this.isAudioPlaying;
  }

  reset(): void {
    this.synthesisId = null;
    this.isAudioPlaying = false;
    this.completionCallbacks = [];
  }
}

const VoiceAIChat: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRoomReady, setIsRoomReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initializationPrompt, setInitializationPrompt] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcriptLog, setTranscriptLog] = useState<string[]>([]);

  const roomRef = useRef<Room | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<SessionData | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const synthesisTrackerRef = useRef<SynthesisTracker>(new SynthesisTracker());

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (conversationEndRef.current) {
      conversationEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation]);

  // Status update interval
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isConnected && wsRef.current) {
      interval = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'status_update' }));
        }
      }, 2000);
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

    room.on(RoomEvent.Connected, () => {
      console.log('Connected to LiveKit room');
      setIsConnected(true);
      
      // Wait 3 seconds after room connection before allowing initialization
      setTimeout(() => {
        console.log('Room is ready for initialization after 3-second delay');
        setIsRoomReady(true);
      }, 3000);
    });

    room.on(RoomEvent.Disconnected, () => {
      console.log('Disconnected from LiveKit room');
      setIsConnected(false);
      setIsRoomReady(false);
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: any, participant: RemoteParticipant) => {
      console.log('Track subscribed:', track.kind, 'from', participant.identity);
      
      if (track.kind === Track.Kind.Audio && participant.identity.includes('ai-agent')) {
        const audioElement = track.attach();
        audioElement.volume = 0.8;
        document.body.appendChild(audioElement);
        audioElement.play().catch(e => console.error('Error playing AI audio:', e));
        
        track.on('ended', () => {
          if (audioElement.parentNode) {
            audioElement.parentNode.removeChild(audioElement);
          }
        });
      }
    });

    room.on(RoomEvent.LocalTrackPublished, (publication, participant) => {
      console.log('Local track published:', publication.kind);
      if (publication.kind === Track.Kind.Audio) {
        startAudioMonitoring(publication.track);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      console.log('Track unsubscribed:', track.kind);
    });

    await room.connect(sessionData.livekit_url, sessionData.token);
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
        console.log('Backend confirmed transcript:', data.text);
        const userEntry: ConversationEntry = {
          role: 'user',
          content: data.text,
          timestamp: new Date().toISOString()
        };
        
        setConversation(prev => [...prev, userEntry]);
        setCurrentTranscript('');
        setIsProcessing(true);
        
      } else if (data.type === 'ai_response') {
        const aiResponse: ConversationEntry = {
          role: 'assistant',
          content: data.text,
          timestamp: new Date().toISOString()
        };
        
        setConversation(prev => [...prev, aiResponse]);
        setIsProcessing(false);
        
        // Immediately pause microphone input when AI response is received
        setIsAISpeaking(true);
        
        setTimeout(() => {
          speakTextWithPause(data.text);
        }, 300);
        
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

  const handleInitialization = async () => {
    if (!initializationPrompt.trim()) {
      setError('Please enter an initialization message');
      return;
    }

    try {
      console.log('Initializing conversation with:', initializationPrompt);
      setError(null);
      setIsProcessing(true);

      const sessionData = await createSession();
      sessionRef.current = sessionData;

      connectWebSocket(sessionData.session_id);

      const initPrompt = initializationPrompt;

      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'audio_transcript',
            text: initPrompt,
            timestamp: new Date().toISOString()
          }));
          setIsInitialized(true);
          setTimeout(() => startConversation(), 1000);
        } else {
          console.log('WebSocket not ready, retrying...');
          setTimeout(() => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'audio_transcript',
                text: initPrompt,
                timestamp: new Date().toISOString()
              }));
              setIsInitialized(true);
              setTimeout(() => startConversation(), 1000);
            } else {
              setError('Failed to connect to server. Please try again.');
              setIsProcessing(false);
            }
          }, 1000);
        }
      }, 500);

    } catch (error) {
      console.error('Error during initialization:', error);
      setError('Failed to initialize. Please try again.');
      setIsProcessing(false);
    }
  };

  const handleUserSpeech = useCallback(async (transcript: string) => {
    if (!transcript.trim() || !wsRef.current) return;

    console.log('User speech detected:', transcript);

    setCurrentTranscript('');
    setIsProcessing(true);

    wsRef.current.send(JSON.stringify({
      type: 'audio_transcript',
      text: transcript,
      timestamp: new Date().toISOString()
    }));
  }, []);

  const startAudioMonitoring = useCallback((audioTrack: any) => {
    console.log('Starting audio monitoring for user speech');
    
    // Check if room is ready before starting speech recognition
    if (!isRoomReady) {
      console.log('Room not ready yet, waiting for 3-second delay to complete');
      return;
    }
    
    // Check if speech recognition is already running
    if (recognitionRef.current) {
      console.log('Speech recognition already exists, skipping start');
      return;
    }
    
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      
      if ('webkitSpeechRecognition' in window) {
        recognition.webkitContinuous = true;
        recognition.webkitInterimResults = true;
      }

      recognition.onstart = () => {
        console.log('Speech recognition started successfully');
        setError(null);
      };

      recognition.onresult = (event: any) => {
        if (isMuted) {
          console.log('User is muted, ignoring speech');
          return;
        }

        if (isAISpeaking) {
          console.log('AI is speaking, ignoring user speech input');
          return;
        }

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
          
          // Check if this might be AI speech being picked up by microphone
          const aiPhrases = [
            'of course', 'i\'d be happy to help', 'what specifically', 'need assistance',
            'how can i help', 'what can i do', 'i\'m here to help', 'let me know'
          ];
          
          const lowerTranscript = finalTranscript.toLowerCase();
          const isLikelyAISpeech = aiPhrases.some(phrase => lowerTranscript.includes(phrase));
          
          if (isLikelyAISpeech) {
            console.log('Detected potential AI speech feedback, ignoring:', finalTranscript);
            return;
          }
          
          setTranscriptLog(prev => [...prev.slice(-4), finalTranscript]);
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
        console.log('[RECOGNITION-END] Speech recognition ended');
        // Clear the reference when recognition ends
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }
        
        // No automatic restart - synthesis completion handler will manage restarts
        if (isRecording && isConnected && isRoomReady && !isAISpeaking) {
          console.log('[RECOGNITION-END] Recognition ended, waiting for synthesis completion to restart');
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
  }, [isRecording, isConnected, isRoomReady, isAISpeaking, handleUserSpeech, isMuted]);

  // Start audio monitoring when room becomes ready (only for initial setup)
  useEffect(() => {
    if (isRoomReady && isRecording && isConnected && !isAISpeaking && !recognitionRef.current) {
      console.log('Room is ready, starting initial audio monitoring');
      startAudioMonitoring(null);
    }
  }, [isRoomReady, isRecording, isConnected, isAISpeaking, startAudioMonitoring]);

  // Centralized synthesis completion handler - ONLY place that restarts speech recognition
  useEffect(() => {
    const handleSynthesisComplete = (synthesisId: number | null) => {
      console.log(`[RESTART-TRIGGER] Synthesis ${synthesisId} confirmed complete`);
      
      // Enhanced safety checks with echo cancellation consideration
      if (sessionRef.current && isRoomReady && !recognitionRef.current && !isAISpeaking) {
        setTimeout(() => {
          // Double-check conditions after safety delay
          if (sessionRef.current && isRoomReady && !recognitionRef.current && !isAISpeaking) {
            console.log('[RESTART-AUTHORIZED] Starting speech recognition after synthesis completion');
            startAudioMonitoring(null);
          } else {
            console.log('[RESTART-BLOCKED] Conditions changed during safety delay');
          }
        }, 500); // Extra safety buffer for echo cancellation
      } else {
        console.log('[RESTART-BLOCKED] Session/room not ready or recognition already active');
      }
    };

    // Register the completion handler
    synthesisTrackerRef.current.onSynthesisComplete(handleSynthesisComplete);
  }, [isRoomReady, isAISpeaking, startAudioMonitoring]);

  const speakTextWithPause = async (text: string) => {
    console.log('AI starting to speak - speech recognition already paused');
    
    // Start synthesis tracking
    const synthesisId = synthesisTrackerRef.current.startSynthesis(text);
    
    // Clear any current transcript when AI starts speaking
    setCurrentTranscript('');
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.log('Speech recognition already stopped');
      }
    }

    try {
      // Call OpenAI TTS endpoint
      const response = await fetch('http://localhost:8000/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          voice: 'nova' // nova sounds more natural and feminine
        })
      });

      if (!response.ok) {
        throw new Error(`TTS request failed: ${response.statusText}`);
      }

      // Get audio data as blob
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Create HTML5 Audio element (replaces speechSynthesis)
      const audio = new Audio(audioUrl);
      audio.volume = 0.8;

      // Set up synthesis completion tracking
      audio.onended = () => {
        console.log('[AUDIO-END] OpenAI TTS audio ended');
        
        // Clean up the blob URL
        URL.revokeObjectURL(audioUrl);
        
        // Signal synthesis completion (no automatic restart)
        setIsAISpeaking(false);
        
        setTimeout(() => {
          console.log('[SYNTHESIS-COMPLETE] Marking synthesis as complete');
          synthesisTrackerRef.current.completeSynthesis(synthesisId);
        }, 700); // Same 700ms delay for safety
      };

      audio.onerror = (event) => {
        console.error('[AUDIO-ERROR] OpenAI TTS audio error:', event);
        setIsAISpeaking(false);
        
        // Clean up the blob URL
        URL.revokeObjectURL(audioUrl);
        
        // Signal synthesis completion even on error
        setTimeout(() => {
          console.log('[SYNTHESIS-ERROR-COMPLETE] Marking synthesis as complete after error');
          synthesisTrackerRef.current.completeSynthesis(synthesisId);
        }, 1000);
      };

      // Start playing the audio
      await audio.play();
      console.log('OpenAI TTS audio started playing');

    } catch (error) {
      console.error('Error with OpenAI TTS:', error);
      
      // Fallback to browser TTS if OpenAI fails
      console.log('Falling back to browser TTS...');
      if ('speechSynthesis' in window) {
        // Keep isAISpeaking true during browser TTS fallback
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 0.8;
        
        utterance.onend = () => {
          console.log('[BROWSER-TTS-END] Browser TTS fallback ended');
          setIsAISpeaking(false);
          setTimeout(() => {
            console.log('[BROWSER-TTS-COMPLETE] Marking browser TTS synthesis as complete');
            synthesisTrackerRef.current.completeSynthesis(synthesisId);
          }, 700);
        };
        
        utterance.onerror = (event) => {
          console.error('[BROWSER-TTS-ERROR] Browser TTS fallback error:', event);
          setIsAISpeaking(false);
          setTimeout(() => {
            console.log('[BROWSER-TTS-ERROR-COMPLETE] Marking browser TTS synthesis as complete after error');
            synthesisTrackerRef.current.completeSynthesis(synthesisId);
          }, 1000);
        };
        
        speechSynthesis.speak(utterance);
      } else {
        // No TTS available, just reset the state
        console.error('No TTS available (neither OpenAI nor browser TTS)');
        setIsAISpeaking(false);
      }
    }
  };

  const testMicrophone = async () => {
    try {
      // Enhanced audio constraints with echo cancellation
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
          channelCount: 1
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Microphone access granted with echo cancellation enabled');
      
      // Log the actual constraints that were applied
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings();
      console.log('Audio settings applied:', {
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
        sampleRate: settings.sampleRate
      });
      
      stream.getTracks().forEach(track => track.stop());
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
      
      const microphoneOk = await testMicrophone();
      if (!microphoneOk) {
        return;
      }
      
      const sessionData = await createSession();
      sessionRef.current = sessionData;

      await connectToRoom(sessionData);
      connectWebSocket(sessionData.session_id);

      setIsRecording(true);

      console.log('Voice conversation started - speak naturally!');

    } catch (err) {
      console.error('Error starting conversation:', err);
      setError(err instanceof Error ? err.message : 'Failed to start conversation');
    }
  };

  const stopConversation = async () => {
    try {
      setIsRecording(false);

      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }

      if (roomRef.current) {
        await roomRef.current.disconnect();
        roomRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

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
    setTranscriptLog([]);
    setError(null);
  };

  const toggleMute = () => {
    setIsMuted(prev => !prev);
  };

  const endConversation = async () => {
    await stopConversation();
    setIsInitialized(false);
    setInitializationPrompt('');
    clearConversation();
  };

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-950 dark:to-black">
        <AnimatePresence mode="wait">
          {!isInitialized ? (
            <motion.div
              key="initialization"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              className="flex items-center justify-center min-h-screen p-6"
            >
              <div className="w-full max-w-2xl">
                <motion.div
                  initial={{ y: -20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1, duration: 0.6 }}
                  className="text-center mb-12"
                >
                  <h1 className="text-5xl font-thin text-gray-900 dark:text-white mb-3 tracking-tight">
                    Voice AI
                  </h1>
                  <p className="text-lg text-gray-600 dark:text-gray-400 font-light">
                    Define your assistant's personality
                  </p>
                </motion.div>

                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.6 }}
                  className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl border border-gray-200/50 dark:border-gray-700/50 shadow-2xl shadow-gray-900/5 p-8"
                >
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 text-gray-700 dark:text-gray-300 mb-6">
                      <MessageSquare className="w-5 h-5" />
                      <span className="font-medium">Assistant Instructions</span>
                    </div>
                    
                    <textarea
                      value={initializationPrompt}
                      onChange={(e) => setInitializationPrompt(e.target.value)}
                      placeholder="e.g., You are a friendly travel assistant. Help users plan their trips, suggest destinations, provide travel tips, and answer questions about travel. Keep your responses conversational and helpful."
                      rows={6}
                      className="w-full px-5 py-4 bg-gray-50/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all duration-200 resize-none font-light leading-relaxed"
                    />

                    <motion.button
                      whileHover={{ scale: 1.02, y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleInitialization}
                      disabled={!initializationPrompt.trim() || isProcessing}
                      className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium rounded-2xl shadow-lg shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-3 transition-all duration-200"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Initializing...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-5 h-5" />
                          <span>Initialize Assistant</span>
                        </>
                      )}
                    </motion.button>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="conversation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col h-screen"
            >
              {/* Header */}
              <motion.header
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-700/50 px-6 py-4"
              >
                <div className="flex items-center justify-between max-w-6xl mx-auto">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-500 shadow-lg shadow-green-500/50 animate-pulse" />
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Active Session</h2>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <motion.button
                      whileHover={{ scale: 1.05, y: -1 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={toggleMute}
                      className={`px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-all duration-200 shadow-lg ${
                        isMuted
                          ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/25'
                          : 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/25'
                      }`}
                    >
                      {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      <span>{isMuted ? 'Unmute' : 'Mute'}</span>
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.05, y: -1 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={clearConversation}
                      disabled={!isConnected}
                      className="px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-gray-900/5"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Clear</span>
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.05, y: -1 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={endConversation}
                      disabled={isProcessing}
                      className="px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-red-500/25"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>End</span>
                    </motion.button>
                  </div>
                </div>
              </motion.header>

              {/* Status & Content */}
              <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full px-6 py-6 gap-6">
                {/* Status Banner */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={isAISpeaking ? 'speaking' : isProcessing ? 'processing' : !isRoomReady && isConnected ? 'waiting' : isMuted ? 'muted' : 'listening'}
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                    className={`px-6 py-4 rounded-2xl border backdrop-blur-xl shadow-lg ${
                      isAISpeaking
                        ? 'bg-purple-50/80 dark:bg-purple-950/30 border-purple-200/50 dark:border-purple-800/50 shadow-purple-500/10'
                        : isProcessing
                        ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200/50 dark:border-amber-800/50 shadow-amber-500/10'
                        : !isRoomReady && isConnected
                        ? 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-200/50 dark:border-blue-800/50 shadow-blue-500/10'
                        : isMuted
                        ? 'bg-red-50/80 dark:bg-red-950/30 border-red-200/50 dark:border-red-800/50 shadow-red-500/10'
                        : 'bg-green-50/80 dark:bg-green-950/30 border-green-200/50 dark:border-green-800/50 shadow-green-500/10'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {isAISpeaking ? (
                        <>
                          <Volume2 className="w-6 h-6 text-purple-600 dark:text-purple-400 animate-pulse" />
                          <span className="text-purple-900 dark:text-purple-100 font-medium text-lg">AI is speaking... (microphone paused)</span>
                        </>
                      ) : isProcessing ? (
                        <>
                          <Loader2 className="w-6 h-6 text-amber-600 dark:text-amber-400 animate-spin" />
                          <span className="text-amber-900 dark:text-amber-100 font-medium text-lg">AI is thinking...</span>
                        </>
                      ) : !isRoomReady && isConnected ? (
                        <>
                          <Clock className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-pulse" />
                          <span className="text-blue-900 dark:text-blue-100 font-medium text-lg">Room connecting... please wait 3 seconds before speaking</span>
                        </>
                      ) : currentTranscript ? (
                        <>
                          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse shadow-lg shadow-red-500/50" />
                          <span className="text-gray-900 dark:text-gray-100 font-medium text-lg">You're saying: "{currentTranscript}"</span>
                        </>
                      ) : isMuted ? (
                        <>
                          <MicOff className="w-6 h-6 text-red-600 dark:text-red-400" />
                          <span className="text-red-900 dark:text-red-100 font-medium text-lg">Microphone muted</span>
                        </>
                      ) : (
                        <>
                          <Mic className="w-6 h-6 text-green-600 dark:text-green-400" />
                          <span className="text-green-900 dark:text-green-100 font-medium text-lg">Listening... speak naturally</span>
                        </>
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>

                {/* Tips */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="px-5 py-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/50 rounded-xl"
                >
                  <p className="text-sm text-blue-900 dark:text-blue-100 font-light">
                    <span className="font-medium">💡 Tips:</span> Speak clearly, ensure microphone permissions are granted, and check that your microphone is not muted.
                  </p>
                </motion.div>

                {/* Error Message */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.3 }}
                      className="px-5 py-4 bg-red-50/80 dark:bg-red-950/30 border border-red-200/50 dark:border-red-800/50 rounded-xl shadow-lg shadow-red-500/10"
                    >
                      <p className="text-red-900 dark:text-red-100 font-medium">⚠️ {error}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Conversation */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="flex-1 bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl border border-gray-200/50 dark:border-gray-700/50 shadow-2xl shadow-gray-900/5 overflow-hidden"
                >
                  <div className="p-6 border-b border-gray-200/50 dark:border-gray-700/50">
                    <div className="flex items-center gap-3">
                      <MessageSquare className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Conversation</h3>
                    </div>
                  </div>
                  
                  <div className="h-[calc(100vh-400px)] overflow-y-auto p-6 space-y-6">
                    <AnimatePresence initial={false}>
                      {conversation.length === 0 ? (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="flex flex-col items-center justify-center h-full text-center space-y-4"
                        >
                          <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                            <MessageSquare className="w-10 h-10 text-gray-400 dark:text-gray-600" />
                          </div>
                          <p className="text-gray-500 dark:text-gray-400 font-light text-lg">
                            Your conversation will appear here.<br />Speak naturally to get started!
                          </p>
                        </motion.div>
                      ) : (
                        conversation.map((entry, index) => (
                          <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ 
                              duration: 0.4, 
                              delay: index * 0.05,
                              ease: [0.23, 1, 0.32, 1]
                            }}
                            className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[75%] rounded-3xl px-6 py-4 shadow-lg ${
                                entry.role === 'user'
                                  ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-blue-500/25'
                                  : 'bg-white/80 dark:bg-gray-800/80 text-gray-900 dark:text-gray-100 border border-gray-200/50 dark:border-gray-700/50 shadow-gray-900/5'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`text-xs font-semibold ${
                                  entry.role === 'user' ? 'text-blue-100' : 'text-gray-600 dark:text-gray-400'
                                }`}>
                                  {entry.role === 'user' ? '👤 You' : '🤖 AI Assistant'}
                                </span>
                                {entry.timestamp && (
                                  <span className={`text-xs ${
                                    entry.role === 'user' ? 'text-blue-200' : 'text-gray-500 dark:text-gray-500'
                                  }`}>
                                    {new Date(entry.timestamp).toLocaleTimeString([], { 
                                      hour: '2-digit', 
                                      minute: '2-digit' 
                                    })}
                                  </span>
                                )}
                              </div>
                              <p className="leading-relaxed whitespace-pre-wrap font-light">
                                {entry.content}
                              </p>
                            </div>
                          </motion.div>
                        ))
                      )}
                    </AnimatePresence>
                    <div ref={conversationEndRef} />
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
};

export default VoiceAIChat;