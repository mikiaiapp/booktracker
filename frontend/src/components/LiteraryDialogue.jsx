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
import { chatAPI } from '../utils/api';
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
  const [isRecording, setIsRecording] = useState(false);
  const [activeModel, setActiveModel] = useState(null);
  const recognitionRef = useRef(null);
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
      const { data } = await chatAPI.getHistory(bookId);
      const history = Array.isArray(data) ? data : (data.messages || []);
      setMessages(history);
      
      // Si hay mensajes, mostrar el último modelo usado
      const lastAiMsg = [...history].reverse().find(m => m.role === 'assistant' && m.model);
      if (lastAiMsg) setActiveModel(lastAiMsg.model);
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
      const { data } = await chatAPI.sendMessage(bookId, textToSend, mode);
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        model: data.model
      }]);
      setActiveModel(data.model);
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
      await chatAPI.clearHistory(bookId);
      setMessages([]);
      setActiveModel(null);
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

  // Dictado por Voz (Speech to Text)
  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Tu navegador no soporta reconocimiento de voz");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev ? `${prev} ${transcript}` : transcript);
      setIsRecording(false);
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);

    recognition.start();
    recognition.current = recognition;
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

        {activeModel && (
          <div className="active-model-indicator">
            <div className="model-pulse"></div>
            <span>IA: {activeModel}</span>
          </div>
        )}
        
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
              <div className="message-content">
                {msg.content}
                {msg.role === 'assistant' && msg.model && (
                  <span className="model-tag">{msg.model}</span>
                )}
              </div>
              {msg.role === 'assistant' && (
                <button 
                  className={`voice-btn ${isSpeaking === i ? 'playing' : ''}`}
                  onClick={() => toggleSpeech(msg.content, i)}
                  title="Escuchar respuesta"
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

      <form className="chat-input-area" onSubmit={sendMessage}>
        <button 
          type="button" 
          className={`mic-btn ${isRecording ? 'recording' : ''}`}
          onClick={toggleRecording}
          title={isRecording ? "Detener grabación" : "Dictar por voz"}
        >
          <Mic size={18} />
          {isRecording && <span className="mic-pulse"></span>}
        </button>
        <input
          type="text"
          placeholder={isRecording ? "Escuchando..." : `Habla con el ${MODES.find(m => m.id === mode).label}...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
        />
        <button type="submit" className="send-btn" disabled={!input.trim() || isLoading}>
          {isLoading ? <RefreshCw className="loader-icon" size={18} /> : <Send size={18} />}
        </button>
      </form>
    </div>
  );
}
