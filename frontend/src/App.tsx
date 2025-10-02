import React from 'react';
import './App.css';
import VoiceAIChat from './components/VoiceAIChat';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Voice AI Conversational Agent</h1>
        <p>Your friendly travel assistant - speak naturally!</p>
      </header>
      <main className="App-main">
        <VoiceAIChat />
      </main>
    </div>
  );
}

export default App;
