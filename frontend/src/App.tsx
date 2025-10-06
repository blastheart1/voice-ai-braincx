import React, { useState } from 'react';
import VoiceAIChat from './components/VoiceAIChat';
import ToSModal from './components/ToSModal';

function App() {
  const [tosAgreed, setTosAgreed] = useState(false);

  const handleTosAgree = () => {
    setTosAgreed(true);
  };

  return (
    <>
      <ToSModal onAgree={handleTosAgree} />
      {tosAgreed && <VoiceAIChat />}
    </>
  );
}

export default App;
