import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface ToSModalProps {
  onAgree: () => void;
}

export default function ToSModal({ onAgree }: ToSModalProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const hasAgreed = localStorage.getItem("voiceAiTosAgreed");
    if (!hasAgreed) {
      setOpen(true);
    }
  }, []);

  const handleAgree = () => {
    localStorage.setItem("voiceAiTosAgreed", "true");
    setOpen(false);
    onAgree();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="relative w-full max-w-lg max-h-[95dvh] overflow-hidden bg-white dark:bg-gray-800">
        {/* Close Button */}
        <button
          onClick={handleAgree}
          className="absolute top-4 right-4 z-10 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-semibold text-gray-900 dark:text-white">
            Terms of Service - Voice AI Assistant
          </CardTitle>
        </CardHeader>

        <CardContent className="px-6 pb-6">
          <div className="overflow-y-auto scrollbar-hide max-h-[60vh] space-y-4 text-sm text-gray-700 dark:text-gray-200">
            <p>
              <strong>Voice AI Assistant Demo</strong> - This is a personal portfolio demonstration 
              showcasing real-time voice AI capabilities. It is not a commercial product or service.
            </p>
            
            <p>
              <strong>Audio Processing & Privacy:</strong> Your voice conversations are processed 
              in real-time using third-party services including OpenAI Whisper for speech recognition 
              and OpenAI TTS for speech synthesis. Audio data is processed temporarily and is not 
              permanently stored by this application.
            </p>
            
            <p>
              <strong>Third-Party Services:</strong> This demo integrates with:
              <br />• OpenAI (Whisper, GPT, TTS) - for AI processing
              <br />• LiveKit - for real-time audio streaming
              <br />• Render - for backend hosting
              <br />• Vercel - for frontend hosting
            </p>
            
            <p>
              <strong>Data Usage:</strong> Your conversations may be processed by OpenAI's services 
              according to their terms. We do not store your personal data, but third-party 
              services may have their own data handling policies.
            </p>
            
            <p>
              <strong>Technical Limitations:</strong> This is a demonstration project. Voice 
              recognition accuracy may vary. Do not use for sensitive, confidential, financial, 
              medical, or legal information.
            </p>
            
            <p>
              <strong>Browser Requirements:</strong> Requires a modern browser with microphone 
              access. HTTPS is required for speech recognition. Chrome, Edge, and Safari are 
              recommended.
            </p>
            
            <p>
              <strong>Disclaimer:</strong> This project is provided "as-is" without warranties. 
              The developer is not liable for any damages or reliance on the system's outputs. 
              Service may be discontinued at any time.
            </p>
            
            <p>
              <strong>Acceptance:</strong> By clicking <strong>"I Agree and Continue"</strong>, 
              you confirm that you understand this is a demo project and accept these terms.
            </p>
          </div>

          <div className="mt-6 flex justify-center">
            <Button
              onClick={handleAgree}
              className="rounded-xl px-6 py-2 text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors"
            >
              I Agree and Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}