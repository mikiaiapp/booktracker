import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  User, 
  Bot, 
  Volume2, 
  VolumeX, 
  Sparkles, 
  MessageCircle,
  Trash2,
  RefreshCw,
  BookOpen,
  Mic
} from 'lucide-react';
import './LiteraryDialogue.css';

const MODES = [
  { id: 'erudite', label: 'Erudito', icon: Sparkles, color: '#6366f1', description: 'Contexto literario profundo' },
  { id: 'author', label: 'Escritor', icon: BookOpen, color: '#ec4899', description: 'Te habla como el propio autor' },
  { id: 'critic', label: 'Crítico', icon: MessageCircle, color: '#f59e0b', description: 'Análisis mordaz y detractor' },
  { id: 'child', label: 'Para niños', icon: Mic, color: '#10b981', description: 'Explicación sencilla (10 años)' },
];

export default function LiteraryDialogue({ bookId, bookTitle, authorName }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState('erudite');
  const [isSpeaking, setIsSpeaking] = useState(null);
  const chatEndRef = useRef(null);

  // Cargar historial al inicio
  useEffect(() => {
    loadHistory();
  }, [bookId]);

  // Scroll automático al fondo
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadHistory = async () => {
    try {
      // Usar fetch nativo para evitar dependencias de axios
      const response = await fetch(`/api/chat/${bookId}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Error cargando historial:", err);
    }
  };

  const sendMessage = async (e, textOverride = null) => {
    if (e) e.preventDefault();
    const textToSend = textOverride || input;
    if (!textToSend.trim() || isLoading) return;

    const userMsg = { role: 'user', content: textToSend, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch(`/api/chat/${bookId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: textToSend,
          mode: mode
        })
      });

      if (!response.ok) throw new Error("Error en la respuesta de la IA");
      
      const data = await response.json();
      setMessages(prev => [...prev, data.assistant_response]);
    } catch (err) {
      console.error("Error enviando mensaje:", err);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "Lo siento, mi conexión con el servidor de inteligencia artificial ha tenido un problema. Por favor, asegúrate de tener configurada la API KEY de Gemini." 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = async () => {
    if (!window.confirm("¿Vaciar todo el historial de este libro?")) return;
    try {
      await fetch(`/api/chat/${bookId}`, { method: 'DELETE' });
      setMessages([]);
    } catch (err) {
      console.error("Error borrando chat:", err);
    }
  };

  const toggleSpeech = (text, msgId) => {
    if (isSpeaking === msgId) {
      window.speechSynthesis.cancel();
      setIsSpeaking(null);
    } else {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES';
      utterance.onend = () => setIsSpeaking(null);
      window.speechSynthesis.speak(utterance);
      setIsSpeaking(msgId);
    }
  };

  return (
    <div className="literary-dialogue">
      {/* Header */}
      <div className="dialogue-header">
        <div className="header-info">
          <Sparkles className="header-icon" size={20} />
          <div>
            <h3>Diálogo Literario</h3>
            <p>{bookTitle} — {authorName}</p>
          </div>
        </div>
        
        <div className="mode-selector">
          {MODES.map(m => (
            <button
              key={m.id}
              className={`mode-btn ${mode === m.id ? 'active' : ''}`}
              style={{ '--mode-color': m.color }}
              onClick={() => setMode(m.id)}
              title={m.description}
            >
              <m.icon size={14} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <button className="clear-btn" onClick={clearChat} title="Borrar historial">
          <Trash2 size={16} />
        </button>
      </div>

      {/* Chat Area */}
      <div className="chat-container">
        {messages.length === 0 && !isLoading ? (
          <div className="welcome-box">
            <Bot size={48} className="welcome-icon" />
            <h3>¿Hablamos sobre el libro?</h3>
            <p>Pregúntame sobre la trama, el estilo o los misterios de <strong>{bookTitle}</strong>.</p>
            <div className="suggested-prompts">
              <button onClick={() => sendMessage(null, "¿Por qué este libro es importante en su género?")}>
                ¿Por qué es importante este libro?
              </button>
              <button onClick={() => sendMessage(null, "Hazme un análisis psicológico del protagonista")}>
                Análisis del protagonista
              </button>
              <button onClick={() => sendMessage(null, "¿Cuál es el tema central que intenta transmitir?")}>
                ¿Cuál es el tema central?
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`message-bubble ${msg.role}`}>
              {msg.content}
              {msg.role === 'assistant' && (
                <button 
                  className={`voice-btn ${isSpeaking === i ? 'playing' : ''}`}
                  onClick={() => toggleSpeech(msg.content, i)}
                >
                  {isSpeaking === i ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              )}
            </div>
          ))
        )}
        {isLoading && (
          <div className="message-bubble assistant loading">
            <div className="typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <form className="chat-input-area" onSubmit={sendMessage}>
        <input
          type="text"
          placeholder={`Habla con el ${MODES.find(m => m.id === mode).label}...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
        />
        <button type="submit" disabled={!input.trim() || isLoading}>
          {isLoading ? <RefreshCw className="loader-icon" size={18} /> : <Send size={18} />}
        </button>
      </form>
    </div>
  );
}
