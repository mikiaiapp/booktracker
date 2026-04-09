import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, User as UserIcon, Brain, Mic, Megaphone, Trash2, X, Play, Pause, MessageSquare, ShieldAlert, Baby } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import './LiteraryDialogue.css';

const MODES = [
  { id: 'default', label: 'Erudito', icon: Brain, color: '#6366f1', desc: 'Análisis académico y experto.' },
  { id: 'author', label: 'Autor', icon: UserIcon, color: '#ec4899', desc: 'Habla directamente con el creador.' },
  { id: 'critic', label: 'Crítico', icon: ShieldAlert, color: '#f59e0b', desc: 'Visión mordaz y analítica.' },
  { id: 'child', label: 'Explicación 10 años', icon: Baby, color: '#10b981', desc: 'Simple, mágico y claro.' }
];

export default function LiteraryDialogue({ bookId, bookTitle, authorName }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('default');
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(null); // ID del mensaje que se está leyendo
  const scrollRef = useRef(null);

  useEffect(() => {
    fetchHistory();
  }, [bookId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const fetchHistory = async () => {
    try {
      const token = localStorage.getItem('bt_token');
      const resp = await axios.get(`http://${window.location.hostname}:8000/api/chat/${bookId}/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessages(resp.data);
    } catch (err) {
      console.error('Error fetching chat history', err);
    }
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input;
    setInput('');
    setLoading(true);

    // Optimistic update
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);

    try {
      const token = localStorage.getItem('bt_token');
      const resp = await axios.post(`http://${window.location.hostname}:8000/api/chat/${bookId}/send`, 
        { message: userMsg, mode },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setMessages(prev => [...prev, { role: 'assistant', content: resp.data.response }]);
    } catch (err) {
      toast.error('Error al conectar con la IA');
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (!window.confirm('¿Borrar toda la conversación sobre este libro?')) return;
    try {
      const token = localStorage.getItem('bt_token');
      await axios.delete(`http://${window.location.hostname}:8000/api/chat/${bookId}/clear`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessages([]);
      toast.success('Conversación borrada');
    } catch (err) {
      toast.error('Error al borrar historial');
    }
  };

  const speak = (text, msgId) => {
    if (speaking === msgId) {
      window.speechSynthesis.cancel();
      setSpeaking(null);
      return;
    }
    
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.rate = 1.0;
    
    utterance.onend = () => setSpeaking(null);
    utterance.onerror = () => setSpeaking(null);
    
    setSpeaking(msgId);
    window.speechSynthesis.speak(utterance);
  };

  const currentModeInfo = MODES.find(m => m.id === mode);

  return (
    <div className="literary-dialogue">
      <div className="dialogue-header">
        <div className="header-info">
          <MessageSquare className="header-icon" />
          <div>
            <h3>Diálogo Literario</h3>
            <p>Conversa con «{bookTitle}»</p>
          </div>
        </div>
        <div className="mode-selector">
          {MODES.map(m => (
            <button 
              key={m.id}
              className={`mode-btn ${mode === m.id ? 'active' : ''}`}
              style={{ '--mode-color': m.color }}
              onClick={() => setMode(m.id)}
              title={m.desc}
            >
              <m.icon size={18} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>
        <button className="clear-btn" onClick={clearHistory} title="Borrar historial">
          <Trash2 size={18} />
        </button>
      </div>

      <div className="chat-container" ref={scrollRef}>
        <AnimatePresence>
          {messages.length === 0 && !loading && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="welcome-box"
            >
              <Brain size={48} className="welcome-icon" />
              <h4>¿Sobre qué quieres dialogar hoy?</h4>
              <p>Pregúntame sobre la trama, los personajes o las motivaciones ocultas en este libro.</p>
              <div className="suggested-prompts">
                <button onClick={() => { setInput('¿Cuál es el tema principal de este libro?'); }}>¿Cuál es el tema principal?</button>
                <button onClick={() => { setInput('Resúmeme el conflicto del capítulo 3'); }}>Conflicto del Cap. 3</button>
                <button onClick={() => { setInput('¿Cómo describirías la evolución del protagonista?'); }}>Evolución del protagonista</button>
              </div>
            </motion.div>
          )}

          {messages.map((m, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: m.role === 'user' ? 20 : -20 }}
              animate={{ opacity: 1, x: 0 }}
              className={`message-bubble ${m.role}`}
            >
              <div className="bubble-content">
                {m.content}
              </div>
              {m.role === 'assistant' && (
                <button 
                  className={`voice-btn ${speaking === idx ? 'playing' : ''}`}
                  onClick={() => speak(m.content, idx)}
                >
                  {speaking === idx ? <Pause size={14} /> : <Play size={14} />}
                </button>
              )}
            </motion.div>
          ))}

          {loading && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="message-bubble assistant loading"
            >
              <div className="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <form className="chat-input-area" onSubmit={handleSend}>
        <input 
          type="text" 
          placeholder={`Habla con el ${currentModeInfo.label.toLowerCase()}...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button type="submit" disabled={!input.trim() || loading}>
          {loading ? <Loader size={20} className="spin" /> : <Send size={20} />}
        </button>
      </form>
    </div>
  );
}

function Loader({ size, className }) {
  return <div style={{ width: size, height: size }} className={`loader-icon ${className}`}></div>;
}
