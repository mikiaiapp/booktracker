import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  BookOpen, User, List, Brain, Map, Mic, Star, ExternalLink,
  Play, Pause, Square, ChevronDown, ChevronUp, Loader, CheckCircle,
  ArrowLeft, Edit3, Trash2, AlertCircle, Volume2, VolumeX, PlayCircle, FileText, RefreshCw, X, MessageSquare, Download, Share2, GitBranch, Layout
} from 'lucide-react'
import { booksAPI, analysisAPI, chapterAPI, characterAPI, uploadToShell, reanalyzeCharacters, queueAPI } from '../utils/api'
import MindMap from '../components/MindMap'
import LiteraryDialogue from '../components/LiteraryDialogue'
import CharacterNetwork from '../components/CharacterNetwork'
import InteractiveTimeline from '../components/InteractiveTimeline'
import { coverSrc } from '../components/BookCover'
import CoverPicker from '../components/CoverPicker'
import './BookPage.css'

const TABS = [
  { id: 'info',       label: 'Ficha',          icon: BookOpen,     statusKey: 'phase1_done' },
  { id: 'chapters',   label: 'Capítulos',       icon: List,         statusKey: 'phase2_done' },
  { id: 'characters', label: 'Personajes',      icon: User,         statusKey: 'phase3_done' },
  { id: 'summary',    label: 'Resumen global',  icon: Brain,        statusKey: 'has_global_summary' },
  { id: 'mindmap',    label: 'Mapa mental',     icon: Map,          statusKey: 'has_mindmap' },
  { id: 'podcast',    label: 'Podcast',         icon: Mic,          statusKey: 'podcast_done' },
  { id: 'chat',       label: 'Diálogo',         icon: MessageSquare,statusKey: 'status' },
  { id: 'refs',       label: 'Referencias',     icon: ExternalLink, statusKey: 'status' },
]

const PROCESSING_STATUSES = ['queued', 'starting', 'identifying', 'analyzing', 'analyzing_structure', 'summarizing', 'generating_podcast', 'generating_mindmap', 'generating_global_summary', 'phase1', 'phase2', 'phase3', 'phase4', 'phase5', 'phase6']

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-box" onClick={e => e.stopPropagation()}>
        <p className="confirm-msg">{message}</p>
        <div className="confirm-btns">
          <button className="confirm-btn-cancel" onClick={onCancel}>Cancelar</button>
          <button className="confirm-btn-ok" onClick={onConfirm}>Aceptar</button>
        </div>
      </div>
    </div>
  )
}

function useConfirm() {
  const [state, setState] = useState(null)
  const confirm = (message) => new Promise(resolve => setState({ message, resolve }))
  const handleConfirm = () => { state.resolve(true);  setState(null) }
  const handleCancel  = () => { state.resolve(false); setState(null) }
  const modal = state
    ? <ConfirmModal message={state.message} onConfirm={handleConfirm} onCancel={handleCancel} />
    : null
  return { confirm, modal }
}

export default function BookPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { confirm, modal: confirmModal } = useConfirm()
  const [data, setData] = useState(null)
  const [prevData, setPrevData] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [progressMsg, setProgressMsg] = useState('')

  const [ttsPlaying,       setTtsPlaying]       = useState(false)
  const [ttsChapterPaused, setTtsChapterPaused] = useState(false)
  const [ttsChapter,       setTtsChapter]       = useState(null)
  const [ttsMode,          setTtsMode]          = useState('single')
  const [ttsQueue,         setTtsQueue]         = useState([])
  const [ttsIndex,         setTtsIndex]         = useState(0)
  const ttsQueueRef       = React.useRef([])
  const ttsIndexRef       = React.useRef(0)
  const ttsActiveRef      = React.useRef(false)
  const ttsSentencesRef   = React.useRef([])
  const ttsSentIdxRef     = React.useRef(0)
  const storageKey        = `tts_pos_${id}`

  const [ttsCharPlaying, setTtsCharPlaying] = useState(false)
  const [ttsCharPaused,  setTtsCharPaused]  = useState(false)
  const [ttsCharacter, setTtsCharacter] = useState(null)
  const ttsCharQueueRef    = React.useRef([])
  const ttsCharIndexRef    = React.useRef(0)
  const ttsCharActiveRef   = React.useRef(false)
  const ttsCharSentRef     = React.useRef([])
  const ttsCharSentIdxRef  = React.useRef(0)
  const charStorageKey = `tts_char_pos_${id}`

  const [ttsInfoPlaying, setTtsInfoPlaying] = useState(false)
  const [ttsInfoPaused,  setTtsInfoPaused]  = useState(false)
  const ttsInfoSentencesRef = React.useRef([])
  const ttsInfoIndexRef     = React.useRef(0)
  const ttsInfoActiveRef    = React.useRef(false)
  const infoStorageKey = `tts_info_pos_${id}`

  const pauseTTS = () => {
    ttsActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsPlaying(false)
    setTtsChapterPaused(true)
  }

  const resumeCurrentTTS = () => {
    if (!ttsQueueRef.current.length) return
    ttsActiveRef.current = true
    setTtsPlaying(true); setTtsChapterPaused(false)
    _speakChapterSentence(ttsSentencesRef.current, ttsSentIdxRef.current)
  }

  const stopTTS = async (skipConfirm = false) => {
    if (!skipConfirm && (ttsPlaying || ttsChapter || ttsChapterPaused)) {
      if (!await confirm('¿Seguro que quieres parar la reproducción?')) return
    }
    ttsActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsPlaying(false); setTtsChapter(null); setTtsChapterPaused(false); setTtsMode('single')
    ttsSentencesRef.current = []; ttsSentIdxRef.current = 0
    localStorage.removeItem(storageKey)
  }

  const _speakChapterSentence = (sentences, sIdx) => {
    if (!ttsActiveRef.current) return
    if (sIdx >= sentences.length) {
      const nextIdx = ttsIndexRef.current + 1
      const queue = ttsQueueRef.current
      if (queue._mode === 'single' && nextIdx >= queue.length) {
        ttsActiveRef.current = false
        setTtsPlaying(false); setTtsChapter(null); setTtsChapterPaused(false)
        localStorage.removeItem(storageKey)
      } else {
        speakItem(queue, nextIdx)
      }
      return
    }
    ttsSentIdxRef.current = sIdx
    saveTTSPos(ttsIndexRef.current, ttsQueueRef.current, sIdx)
    const u = new SpeechSynthesisUtterance(sentences[sIdx])
    u.lang = 'es-ES'; u.rate = 0.95
    u.onend = () => { if (ttsActiveRef.current) _speakChapterSentence(sentences, sIdx + 1) }
    u.onerror = (e) => { if (e.error !== 'interrupted' && ttsActiveRef.current) _speakChapterSentence(sentences, sIdx + 1) }
    window.speechSynthesis.speak(u)
  }

  const speakItem = (queue, idx) => {
    if (!ttsActiveRef.current || idx >= queue.length) {
        if (idx >= queue.length) {
            ttsActiveRef.current = false
            setTtsPlaying(false); setTtsChapter(null); setTtsChapterPaused(false)
            localStorage.removeItem(storageKey)
        }
        return
    }
    const item = queue[idx]
    ttsIndexRef.current = idx; ttsQueueRef.current = queue
    saveTTSPos(idx, queue, 0)
    setTtsIndex(idx); setTtsChapter(item.id)
    const raw = item.text.match(/[^.!?]+[.!?]+[\s]*/g) || [item.text]
    const sentences = raw.map(s => s.trim()).filter(Boolean)
    ttsSentencesRef.current = sentences
    ttsSentIdxRef.current = 0
    _speakChapterSentence(sentences, 0)
  }

  const saveTTSPos = (idx, queue, sentIdx = 0) => {
    try { localStorage.setItem(storageKey, JSON.stringify({ idx, chapterId: queue[idx]?.id, sentIdx })) } catch {}
  }

  const loadTTSPos = () => {
    try { const saved = localStorage.getItem(storageKey); return saved ? JSON.parse(saved) : null } catch { return null }
  }

  const chapterToText = (c) => {
    let text = `${c.title}. ${c.summary || ''}`
    if (c.key_events?.length > 0) text += '. Eventos clave: ' + c.key_events.join('. ')
    return text
  }

  const buildQueue = (book, chapters, fromIdx = 0) => {
    const queue = []
    if (fromIdx === 0 && book.synopsis) queue.push({ id: 'synopsis', title: 'Sinopsis', text: book.synopsis })
    chapters.filter(c => c.summary && c.summary_status === 'done')
      .forEach(c => queue.push({ id: c.id, title: c.title, text: chapterToText(c) }))
    return queue
  }

  const playFromBeginning = (book, chapters) => {
    stopTTS(true)
    const queue = buildQueue(book, chapters)
    if (!queue.length) return
    ttsQueueRef.current = queue; ttsIndexRef.current = 0; ttsActiveRef.current = true
    setTtsPlaying(true); speakItem(queue, 0)
  }

  const playFromChapter = (chapter, chapters) => {
    stopTTS(true)
    const doneChapters = chapters.filter(c => c.summary && c.summary_status === 'done')
    const idx = doneChapters.findIndex(c => c.id === chapter.id)
    const queue = Object.assign(doneChapters.slice(idx < 0 ? 0 : idx).map(c => ({ id: c.id, title: c.title, text: chapterToText(c) })), { _mode: 'from' })
    if (!queue.length) return
    ttsQueueRef.current = queue; ttsIndexRef.current = 0; setTtsMode('from'); ttsActiveRef.current = true
    setTtsPlaying(true); speakItem(queue, 0)
  }

  const characterToText = (char) => {
    let text = `Personaje: ${char.name}. ${char.role || ''}. ${char.description || ''}.`
    if (char.personality) text += ` Personalidad: ${char.personality}.`
    if (char.arc) text += ` Evolución: ${char.arc}.`
    return text
  }

  const pauseCharTTS = () => { ttsCharActiveRef.current = false; window.speechSynthesis.cancel(); setTtsCharPlaying(false); setTtsCharPaused(true) }
  const resumeCharTTS = () => { if (!ttsCharQueueRef.current.length) return; ttsCharActiveRef.current = true; setTtsCharPlaying(true); setTtsCharPaused(false); _speakCharSentence(ttsCharSentRef.current, ttsCharSentIdxRef.current) }
  const stopCharTTS = async (skipConfirm = false) => {
    if (!skipConfirm && (ttsCharPlaying || ttsCharPaused || ttsCharacter)) { if (!await confirm('¿Parar reproducción de personajes?')) return }
    ttsCharActiveRef.current = false; window.speechSynthesis.cancel(); setTtsCharPlaying(false); setTtsCharPaused(false); setTtsCharacter(null)
  }

  const _speakCharSentence = (sentences, sIdx) => {
    if (!ttsCharActiveRef.current) return
    if (sIdx >= sentences.length) { speakCharItem(ttsCharQueueRef.current, ttsCharIndexRef.current + 1); return }
    ttsCharSentIdxRef.current = sIdx
    const u = new SpeechSynthesisUtterance(sentences[sIdx])
    u.lang = 'es-ES'; u.rate = 0.95
    u.onend = () => { if (ttsCharActiveRef.current) _speakCharSentence(sentences, sIdx + 1) }
    u.onerror = (e) => { if (e.error !== 'interrupted' && ttsCharActiveRef.current) _speakCharSentence(sentences, sIdx + 1) }
    window.speechSynthesis.speak(u)
  }

  const speakCharItem = (queue, idx) => {
    if (!ttsCharActiveRef.current || idx >= queue.length) {
      if (idx >= queue.length) { ttsCharActiveRef.current = false; setTtsCharPlaying(false); setTtsCharacter(null) }
      return
    }
    const item = queue[idx]
    ttsCharIndexRef.current = idx; ttsCharQueueRef.current = queue
    setTtsCharacter(item.name)
    const raw = item.text.match(/[^.!?]+[.!?]+[\s]*/g) || [item.text]
    const sentences = raw.map(s => s.trim()).filter(Boolean)
    ttsCharSentRef.current = sentences; ttsCharSentIdxRef.current = 0
    _speakCharSentence(sentences, 0)
  }

  const playCharacter = (char) => { stopCharTTS(true); stopTTS(true); stopInfoTTS(true); window.speechSynthesis.cancel(); const queue = [{ name: char.name, text: characterToText(char) }]; ttsCharQueueRef.current = queue; ttsCharIndexRef.current = 0; ttsCharActiveRef.current = true; setTtsCharPlaying(true); speakCharItem(queue, 0) }

  const _speakInfoFromIndex = (sentences, idx) => {
    if (!ttsInfoActiveRef.current || idx >= sentences.length) {
      if (ttsInfoActiveRef.current) { ttsInfoActiveRef.current = false; setTtsInfoPlaying(false); setTtsInfoPaused(false) }
      return
    }
    ttsInfoIndexRef.current = idx
    const u = new SpeechSynthesisUtterance(sentences[idx])
    u.lang = 'es-ES'; u.rate = 0.95
    u.onend = () => { if (ttsInfoActiveRef.current) _speakInfoFromIndex(sentences, idx + 1) }
    u.onerror = (e) => { if (e.error !== 'interrupted' && ttsInfoActiveRef.current) _speakInfoFromIndex(sentences, idx + 1) }
    window.speechSynthesis.speak(u)
  }

  const _startInfoTTS = (text, fromIdx = 0) => {
    const raw = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text]
    const sentences = raw.map(s => s.trim()).filter(Boolean)
    ttsInfoSentencesRef.current = sentences; ttsInfoIndexRef.current = fromIdx; ttsInfoActiveRef.current = true
    _speakInfoFromIndex(sentences, fromIdx)
  }

  const playInfo = (book) => { stopTTS(true); stopCharTTS(true); stopInfoTTS(true); window.speechSynthesis.cancel(); const text = book.synopsis || ''; if (!text) return; setTtsInfoPlaying(true); _startInfoTTS(text, 0) }
  const playSummary = (book) => { stopTTS(true); stopCharTTS(true); stopInfoTTS(true); window.speechSynthesis.cancel(); if (!book.global_summary) return; setTtsInfoPlaying(true); _startInfoTTS(book.global_summary, 0) }
  const pauseInfoTTS = () => { ttsInfoActiveRef.current = false; window.speechSynthesis.cancel(); setTtsInfoPlaying(false); setTtsInfoPaused(true) }
  const resumeInfoTTS = () => { if (!ttsInfoSentencesRef.current.length) return; setTtsInfoPlaying(true); setTtsInfoPaused(false); ttsInfoActiveRef.current = true; _speakInfoFromIndex(ttsInfoSentencesRef.current, ttsInfoIndexRef.current) }
  const stopInfoTTS = async (skipConfirm = false) => {
    if (!skipConfirm && (ttsInfoPlaying || ttsInfoPaused)) { if (!await confirm('¿Parar reproducción?')) return }
    ttsInfoActiveRef.current = false; window.speechSynthesis.cancel(); setTtsInfoPlaying(false); setTtsInfoPaused(false)
  }

  const [tab, setTab] = useState('info')
  const [mindmapView, setMindmapView] = useState('tree')
  const [chaptersView, setChaptersView] = useState('list')
  const [expandedChapter, setExpandedChapter] = useState(null)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [coverKey, setCoverKey] = useState(0)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [audioPaused, setAudioPaused] = useState(false)
  const [audioEl, setAudioEl] = useState(null)
  const [rating, setRating] = useState(0)

  const load = async (isFirst = false) => {
    try {
      if (isFirst) setLoading(true)
      const bookRes = await booksAPI.get(id)
      const statusRes = await analysisAPI.status(id)
      setData(bookRes.data)
      setStatus(statusRes.data)
      setRating(bookRes.data.book?.rating || 0)
      try {
        const { data: qState } = await queueAPI.get()
        const info = qState?.infos?.[id]
        setProgressMsg(info?.msg || '')
      } catch {}
    } catch (err) {
      toast.error(`Error al cargar: ${err.message}`)
    } finally {
      if (isFirst) setLoading(false)
    }
  }

  useEffect(() => { load(true) }, [id])

  useEffect(() => {
    if (!status) return
    if (PROCESSING_STATUSES.includes(status.status)) {
      const t = setTimeout(() => load(false), 4000)
      return () => clearTimeout(t)
    }
  }, [status])

  const triggerPhase = async (phase, force = false) => {
    try {
      if (phase === 1) await analysisAPI.triggerPhase1(id, force)
      else if (phase === 2) await analysisAPI.triggerPhase2(id, force)
      else if (phase === 3) await analysisAPI.triggerPhase3(id, force)
      else if (phase === 4) await analysisAPI.triggerPhase4(id, force)
      else if (phase === 5) await analysisAPI.triggerPhase5(id, force)
      else if (phase === 6) await analysisAPI.triggerPodcast(id, force)
      toast.success(force ? 'Análisis forzado iniciado' : 'Fase iniciada')
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    }
  }

  const handleCancelAnalysis = async () => {
    if (!await confirm('¿Detener el análisis?')) return
    try { await analysisAPI.cancel(id); toast.success('Detenido'); load() } catch (err) { toast.error('Error al detener') }
  }

  const handleRating = async (r) => { setRating(r); await booksAPI.update(id, { rating: r }) }
  const handleReadStatus = async (s) => { await booksAPI.update(id, { read_status: s }); load() }

  const [audioUrl, setAudioUrl] = useState(null)
  const loadAudio = async () => {
    try {
      const token = localStorage.getItem('bt_token')
      const resp = await fetch(analysisAPI.podcastAudioUrl(id), { headers: { Authorization: `Bearer ${token}` } })
      if (!resp.ok) throw new Error('No audio')
      const blob = await resp.blob(); const url = URL.createObjectURL(blob); setAudioUrl(url); return url
    } catch { toast.error('Error al cargar audio'); return null }
  }

  const toggleAudio = async () => {
    if (!audioEl) {
      const url = audioUrl || await loadAudio(); if (!url) return
      const el = new Audio(url); el.onended = () => { setAudioPlaying(false); setAudioPaused(false) }
      setAudioEl(el); el.play(); setAudioPlaying(true); setAudioPaused(false)
    } else {
      if (audioPlaying) { audioEl.pause(); setAudioPlaying(false); setAudioPaused(true) }
      else { audioEl.play(); setAudioPlaying(true); setAudioPaused(false) }
    }
  }

  const handleDownloadAudio = async () => {
    try {
      const token = localStorage.getItem('bt_token')
      const resp = await fetch(analysisAPI.podcastAudioUrl(id), { headers: { Authorization: `Bearer ${token}` } })
      const blob = await resp.blob(); const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${book.title}_podcast.mp3`; a.click()
    } catch { toast.error('Error al descargar') }
  }

  const exportToPDF = async () => {
    toast('Generando ficha completa...', { icon: '📄' })
    try {
      const script = document.createElement('script'); script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; document.head.appendChild(script)
      await new Promise(r => script.onload = r)
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF()
      let y = 30
      const margin = 20
      const pageWidth = doc.internal.pageSize.getWidth()
      const contentWidth = pageWidth - (margin * 2)

      const addPageIfNeeded = (h) => {
        if (y + h > 280) {
          doc.addPage();
          y = 30;
          return true;
        }
        return false;
      }

      const renderParagraph = (text, fontSize, isBold = false, isItalic = false) => {
        const style = isBold ? 'bold' : (isItalic ? 'italic' : 'normal');
        doc.setFont('helvetica', style);
        doc.setFontSize(fontSize);
        const lines = doc.splitTextToSize(text, contentWidth);
        const lineHeight = fontSize * 0.5; // Aproximación en mm
        
        lines.forEach(line => {
          addPageIfNeeded(lineHeight);
          doc.text(line, margin, y);
          y += lineHeight;
        });
        y += 4; // Espacio entre párrafos
      }

      const renderHeader = (text, size = 16) => {
        addPageIfNeeded(size + 10);
        y += 5;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(size);
        doc.text(text, margin, y);
        y += (size * 0.6) + 2;
        doc.line(margin, y - 1, margin + 40, y - 1);
        y += 5;
      }

      // Title & Author
      doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.text(book.title, margin, y); y += 12;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(14); doc.text(book.author || '', margin, y); y += 20;

      // Meta info (ISBN, etc)
      doc.setFontSize(10); doc.setTextColor(100);
      let metaStr = `ISBN: ${book.isbn || 'N/A'}  |  Género: ${book.genre || 'N/A'}  |  Año: ${book.year || 'N/A'}`;
      doc.text(metaStr, margin, y); y += 15;
      doc.setTextColor(0);

      // Synopsis
      if (book.synopsis) {
        renderHeader('SINOPSIS', 14);
        renderParagraph(book.synopsis, 10);
      }

      // Chapters
      if (chapters.length > 0) {
        renderHeader('CAPÍTULOS Y RESÚMENES', 14);
        chapters.forEach((ch, i) => {
          addPageIfNeeded(15);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); 
          doc.text(`${i+1}. ${ch.title}`, margin, y); y += 7;
          if (ch.summary) {
            renderParagraph(ch.summary, 9);
          } else {
            y += 5;
          }
        });
      }

      // Characters
      if (characters.length > 0) {
        renderHeader('PERSONAJES', 14);
        characters.forEach(char => {
          addPageIfNeeded(15);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(11); 
          doc.text(char.name, margin, y); y += 6;
          doc.setFont('helvetica', 'italic'); doc.setFontSize(9); 
          doc.text(char.role || 'Personaje', margin, y); y += 6;
          if (char.description) {
            renderParagraph(char.description, 9);
          } else {
            y += 4;
          }
        });
      }

      // Global Summary
      if (book.global_summary) {
        renderHeader('ANÁLISIS GLOBAL', 14);
        renderParagraph(book.global_summary, 10);
      }

      doc.save(`${book.title}_Análisis_Completo.pdf`);
      toast.success('PDF generado con éxito');
    } catch (err) {
      console.error(err);
      toast.error('Error al generar PDF');
    }
  }

  const handleDelete = async () => { if (await confirm(`¿Eliminar "${data?.book?.title}"?`)) { await booksAPI.delete(id); navigate('/') } }

  if (loading) return <div className="book-loading"><Loader size={28} className="spin" /><p>Cargando...</p></div>

  const activeData = data || prevData
  const book = activeData?.book || {}
  const statusInfo = status || {}
  if (!book.id) return <div className="book-loading"><button onClick={() => navigate("/")}>Volver</button></div>
  
  const chapters = activeData?.chapters || []
  const characters = activeData?.characters || []
  const isProcessing = PROCESSING_STATUSES.includes(statusInfo.status)

  const formatDuration = (s) => { const m = Math.floor(s/60); const sc = Math.floor(s%60); return `${m}:${sc.toString().padStart(2,'0')}` }

  return (
    <div className="book-page">
      <div className="book-hero">
        <button className="back-btn" onClick={() => navigate('/')}><ArrowLeft size={16} /> Biblioteca</button>
        <div className="hero-content">
          <div className="hero-cover" onClick={() => setCoverPickerOpen(true)}><HeroCover book={book} /></div>
          <div className="hero-info">
            <h1>{book.title || 'Sin Título'}</h1>
            <Link to={`/author/${encodeURIComponent(book.author || '')}`} className="hero-author-link">
              {book.author}
            </Link>
            <div className="hero-meta">
              {book.year && <span>{book.year}</span>}
              {book.pages && <span>{book.pages} pp.</span>}
              {book.genre && <span>{book.genre}</span>}
              {book.isbn && <span className="isbn-tag">ISBN: {book.isbn}</span>}
            </div>
            <div className="star-rating">
              {[1,2,3,4,5].map(n => <button key={n} onClick={() => handleRating(n)} className={`star ${rating >= n ? 'filled' : ''}`}><Star size={20} fill={rating >= n ? 'currentColor' : 'none'} /></button>)}
            </div>
            <div className="hero-actions-container">
              {statusInfo?.has_global_summary && (
                <button className="hero-action-btn pdf-btn" onClick={exportToPDF} title="Generar PDF del análisis completo">
                  <FileText size={16} />
                  <span>Genera PDF</span>
                </button>
              )}

              {book.has_file && (
                <button
                  className="hero-action-btn epub-btn"
                  title="Descargar archivo original"
                  onClick={async () => {
                    try {
                      const token = localStorage.getItem('bt_token')
                      const url = `${booksAPI.baseURL}/${id}/download`
                      const resp = await fetch(url, {
                        headers: { Authorization: `Bearer ${token}` }
                      })
                      if (!resp.ok) { toast.error('No se pudo descargar el archivo'); return }
                      const blob = await resp.blob()
                      const objUrl = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = objUrl
                      a.download = `${book.title}.pdf` // Extension is determined by backend but fallback to pdf
                      a.click()
                      setTimeout(() => URL.revokeObjectURL(objUrl), 5000)
                    } catch { toast.error('Error al descargar el archivo') }
                  }}
                >
                  <BookOpen size={16} />
                  <span>Descarga Original</span>
                </button>
              )}

              <label className="hero-action-btn replace-btn" style={{ cursor: 'pointer' }} title="Reemplazar archivo PDF/EPUB del libro">
                <input type="file" accept=".pdf,.epub" style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files[0]; if (!file) return
                    if (!confirm('¿Reemplazar los archivos? El análisis se conservará.')) return
                    try {
                      toast('Subiendo archivo…', { icon: '⏳' })
                      await uploadToShell(id, file)
                      toast.success('Archivo subido. Identificando…')
                      load(false)
                    } catch { toast.error('Error al subir el archivo') }
                  }} />
                <RefreshCw size={14} /> 
                <span>Reemplazar archivos</span>
              </label>
            </div>
          </div>
          <button className="delete-btn" onClick={handleDelete}><Trash2 size={20} /></button>
        </div>
      </div>

      <div className="book-tabs">
        <div className="tabs-bar tabs-bar-desktop">
          {TABS.map(t => {
            const isDone = statusInfo?.[t.statusKey]
            return (
              <button key={t.id} onClick={() => setTab(t.id)} className={`tab-btn ${tab === t.id ? 'active' : ''}`}>
                <t.icon size={18} />
                <span className="tab-btn-text">{t.label}</span>
                {isDone && <div className="tab-status-dot" title="Completado" />}
              </button>
            )
          })}
          <span style={{ fontSize: '0.6rem', opacity: 0.2, alignSelf: 'center', marginLeft: 'auto', paddingRight: '1rem' }}>v2.8.5</span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div 
            key={tab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="tab-content"
            style={{ minHeight: '500px' }}
          >
            {tab === 'info' && (
              <InfoTab 
                book={book} 
                status={statusInfo} 
                isProcessing={isProcessing} 
                onTrigger={triggerPhase} 
                onPlay={playInfo} 
                onStop={stopInfoTTS} 
                isPlaying={ttsInfoPlaying} 
                isPaused={ttsInfoPaused} 
                onResume={resumeInfoTTS} 
                onPause={pauseInfoTTS} 
              />
            )}
            {tab === 'chapters' && (
              <ChaptersTab 
                chapters={chapters} 
                expanded={expandedChapter} 
                setExpanded={setExpandedChapter} 
                bookId={id} 
                onChapterSummarized={() => load(false)} 
                view={chaptersView} 
                setView={setChaptersView} 
                status={statusInfo} 
                isProcessing={isProcessing} 
                onTrigger={triggerPhase} 
                onPlay={playFromChapter}
                onStop={stopTTS}
                currentTtsId={ttsChapter}
                isPlaying={ttsPlaying}
                isPaused={ttsChapterPaused}
                onResume={resumeCurrentTTS}
                onPause={pauseTTS}
              />
            )}
            {tab === 'characters' && (
              <CharactersTab 
                characters={characters} 
                bookId={id}
                status={statusInfo} 
                isProcessing={isProcessing} 
                onTrigger={triggerPhase} 
                onPlay={playCharacter} 
                onStop={stopCharTTS}
                currentTtsId={ttsCharacter}
                isPlaying={ttsCharPlaying}
                isPaused={ttsCharPaused}
                onResume={resumeCharTTS}
                onPause={pauseCharTTS}
                onRefresh={() => load(false)}
              />
            )}
            {tab === 'summary' && (
              <SummaryTab 
                book={book} 
                status={statusInfo} 
                isProcessing={isProcessing} 
                onTrigger={triggerPhase} 
                onPlay={playSummary}
                onStop={stopInfoTTS}
                isPlaying={ttsInfoPlaying}
                isPaused={ttsInfoPaused}
                onResume={resumeInfoTTS}
                onPause={pauseInfoTTS}
              />
            )}
            {tab === 'mindmap' && (
              <div className="prose-content">
                <TabPhaseBar phase={5} label="Mapa Mental" doneProp="has_mindmap" canProp="has_global_summary" status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} />
                {statusInfo.has_mindmap ? (
                  <>
                    <div className="view-toggle-wrap">
                      <button className={`view-toggle-btn ${mindmapView === 'tree' ? 'active' : ''}`} onClick={() => setMindmapView('tree')}><Layout size={14} /> Ideas</button>
                      <button className={`view-toggle-btn ${mindmapView === 'network' ? 'active' : ''}`} onClick={() => setMindmapView('network')}><Share2 size={14} /> Red</button>
                    </div>
                    {mindmapView === 'tree' ? <MindMap data={book.mindmap_data} /> : <CharacterNetwork characters={characters} />}
                  </>
                ) : <p className="empty-tab">Generando el mapa mental...</p>}
              </div>
            )}
            {tab === 'podcast' && (
              <PodcastTab 
                book={book} 
                status={statusInfo} 
                isProcessing={isProcessing} 
                onTrigger={triggerPhase} 
                progressMsg={progressMsg}
                audioUrl={audioUrl}
                audioPlaying={audioPlaying}
                audioPaused={audioPaused}
                onToggleAudio={toggleAudio}
                onDownload={handleDownloadAudio}
              />
            )}
            {tab === 'chat' && (
              <div className="prose-content" style={{height:'80vh'}}>
                <LiteraryDialogue bookId={id} bookTitle={book.title} />
              </div>
            )}
            {tab === 'refs' && (
              <ReferencesTab 
                book={book} 
                status={statusInfo} 
                isProcessing={isProcessing} 
                onTrigger={triggerPhase} 
                progressMsg={progressMsg} 
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      {confirmModal}
      {coverPickerOpen && <CoverPicker book={book} onClose={() => setCoverPickerOpen(false)} onSelect={async (url) => { await booksAPI.update(id, { cover_url: url }); setCoverKey(k => k+1); setCoverPickerOpen(false); load() }} />}
    </div>
  )
}

function HeroCover({ book }) { const src = coverSrc(book); return src ? <img src={src} alt={book.title} /> : <div className="cover-ph-lg"><BookOpen size={48} /></div> }

function TabPhaseBar({ phase, label, doneProp, canProp, status, isProcessing, onTrigger, progressMsg }) {
  const isDone = status[doneProp]
  // Only show processing if NOT done, or if processing is explicitly this phase
  const showProcessing = isProcessing && (!isDone || (progressMsg && progressMsg.toLowerCase().includes(label.toLowerCase())))
  
  return (
    <div className="tab-phase-bar" style={{display:'flex', justifyContent:'space-between', marginBottom:'2rem'}}>
      <div style={{display:'flex', alignItems:'center', gap:'1rem'}}>
        {isDone ? <CheckCircle size={20} color="var(--gold)" /> : <div className="phase-dot">{phase}</div>}
        <div>
          <strong>Fase {phase}: {label}</strong>
          {showProcessing && (
            <div style={{fontSize:'0.8rem', color:'var(--gold)'}}>
              {progressMsg || 'Procesando...'}
            </div>
          )}
        </div>
      </div>
      {status[canProp || 'phase1_done'] && !isProcessing && (
        <button className="reanalyze-btn" onClick={() => onTrigger(phase, isDone)}>
          <RefreshCw size={14} /> {isDone ? 'Rehacer' : 'Iniciar'}
        </button>
      )}
    </div>
  )
}

const PodcastTab = React.memo(({ book, status, isProcessing, onTrigger, progressMsg, audioUrl, audioPlaying, audioPaused, onToggleAudio, onDownload }) => {
  const formatDuration = (s) => {
    if (!s) return '--:--'
    const m = Math.floor(s / 60)
    const sc = Math.floor(s % 60)
    return `${m}:${sc.toString().padStart(2, '0')}`
  }

  // Parse script into cards
  const parseScript = (text) => {
    if (!text) return []
    const lines = text.split('\n').filter(l => l.trim())
    const cards = []
    lines.forEach(line => {
      const match = line.match(/^(ANA|CARLOS|LOCUTOR|HOST|INVITADO):\s*(.*)/i)
      if (match) {
        cards.push({ speaker: match[1].toUpperCase(), text: match[2] })
      } else if (cards.length > 0) {
        cards[cards.length - 1].text += ' ' + line
      } else {
        cards.push({ speaker: 'LOCUTOR', text: line })
      }
    })
    return cards
  }

  const scriptCards = parseScript(book.podcast_script)

  return (
    <div className="prose-content">
      <TabPhaseBar phase={6} label="Podcast" doneProp="podcast_done" canProp="has_mindmap" status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} />
      
      {status.podcast_done ? (
        <div className="podcast-container">
          <div className="podcast-player-card">
            <div className="podcast-visual-wrap">
              <div className={`podcast-visual ${audioPlaying ? 'playing' : ''}`}>
                <Mic size={48} />
              </div>
            </div>
            <div className="podcast-info">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h3>Podcast Literario</h3>
                <span className="podcast-duration-badge">{formatDuration(book.podcast_duration)}</span>
              </div>
              <p>Análisis en formato de audio generado por IA</p>
              <div className="podcast-controls">
                <button className="podcast-play-btn" onClick={onToggleAudio}>
                  {audioPlaying ? <Pause size={20} /> : <Play size={20} />}
                  <span>{audioPlaying ? 'Pausar' : 'Escuchar Podcast'}</span>
                </button>
                <button className="podcast-download-btn-premium" onClick={onDownload}>
                  <Download size={18} />
                  <span>Descargar MP3</span>
                </button>
              </div>
            </div>
          </div>
          
          {scriptCards.length > 0 && (
            <div className="podcast-script-v2">
              <h4><FileText size={16} /> Guión del Podcast</h4>
              <div className="script-cards-container">
                {scriptCards.map((card, i) => (
                  <div key={i} className={`script-card ${card.speaker.toLowerCase()}`}>
                    <div className="card-speaker-tag">{card.speaker}</div>
                    <p className="card-text">{card.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="empty-tab">
          <Mic size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
          <p>El podcast aún no está listo.</p>
          <p style={{ fontSize: '0.9rem', opacity: 0.6 }}>Esta fase requiere que el Mapa Mental esté completado.</p>
        </div>
      )}
    </div>
  )
})

const ReferencesTab = React.memo(({ book, status, isProcessing, onTrigger, progressMsg }) => {
  const query = encodeURIComponent(`${book.title} ${book.author || ''}`)
  const authorQuery = encodeURIComponent(book.author || '')

  const extLinks = [
    { name: 'Google',      icon: Share2,     url: `https://www.google.com/search?q=${query}`, desc: 'Búsqueda general y noticias' },
    { name: 'Wikipedia',   icon: BookOpen,   url: `https://es.wikipedia.org/wiki/Special:Search?search=${query}`, desc: 'Enciclopedia y contexto' },
    { name: 'Goodreads',   icon: Star,       url: `https://www.goodreads.com/search?q=${query}`, desc: 'Reseñas y puntuación global' },
    { name: 'Lecturalia',  icon: ExternalLink,url: `https://www.lecturalia.com/buscar/libros?q=${query}`, desc: 'Comunidad literaria en español' },
    { name: 'Google Books',icon: BookOpen,   url: `https://www.google.com/search?tbm=bks&q=${query}`, desc: 'Vista previa y metadatos' },
    { name: 'Amazon',      icon: Download,   url: `https://www.amazon.es/s?k=${query}&i=stripbooks`, desc: 'Tienda y detalles de edición' },
  ]

  return (
    <div className="prose-content">
      <TabPhaseBar phase={7} label="Referencias" doneProp="phase1_done" status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} />
      
      <div className="refs-section">
        <h3>Investigación y Referencias</h3>
        <p style={{ color: 'var(--mist)', marginBottom: '2rem', fontSize: '0.9rem' }}>
          Enlaces externos para profundizar en el análisis de <strong>{book.title}</strong>:
        </p>
        <div className="external-links-grid">
          {extLinks.map((link, i) => (
            <a key={i} href={link.url} target="_blank" rel="noreferrer" className="ext-link-card">
              <link.icon size={20} />
              <div className="ext-link-info">
                <span className="ext-link-title">{link.name}</span>
                <span className="ext-link-desc">{link.desc}</span>
              </div>
              <ExternalLink size={14} className="ext-icon" />
            </a>
          ))}
        </div>
      </div>

      <div className="refs-section" style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid var(--border)' }}>
        <h3>Búsqueda del Autor</h3>
        <div className="external-links-grid">
          <a href={`https://www.google.com/search?q=${authorQuery}`} target="_blank" rel="noreferrer" className="ext-link-card">
            <User size={20} />
            <div className="ext-link-info">
              <span className="ext-link-title">Investigar a {book.author}</span>
              <span className="ext-link-desc">Biografía, entrevistas y artículos</span>
            </div>
            <ExternalLink size={14} className="ext-icon" />
          </a>
        </div>
      </div>
    </div>
  )
})

const InfoTab = React.memo(({ book, status, isProcessing, onTrigger, onPlay, onStop, isPlaying, isPaused, onResume, onPause }) => {
  return (
    <div className="info-tab">
      <TabPhaseBar phase={1} label="Ficha y Autor" doneProp="phase1_done" status={status} isProcessing={isProcessing} onTrigger={onTrigger} />
      <div className="tab-section-header">
        <h3>Sinopsis</h3>
        <div className="tab-header-actions">
          {book.synopsis && (
            <button className={`tts-btn ${isPlaying ? 'playing' : ''}`} onClick={isPlaying ? (isPaused ? onResume : onPause) : () => onPlay(book)}>
              {isPlaying ? (isPaused ? <Play size={14} /> : <Pause size={14} />) : <Volume2 size={14} />}
              <span>{isPlaying ? (isPaused ? 'Reanudar' : 'Pausar') : 'Escuchar'}</span>
            </button>
          )}
          {isPlaying && <button className="tts-btn stop" onClick={onStop}><Square size={14} /></button>}
        </div>
      </div>
      <p>{book.synopsis || 'Analizando...'}</p>
    </div>
  )
})

const SummaryTab = React.memo(({ book, status, isProcessing, onTrigger, onPlay, onStop, isPlaying, isPaused, onResume, onPause }) => {
  return (
    <div className="prose-content">
      <TabPhaseBar phase={4} label="Resumen Global" doneProp="has_global_summary" status={status} isProcessing={isProcessing} onTrigger={onTrigger} />
      <div className="tab-section-header">
        <h2>Resumen</h2>
        <div className="tab-header-actions">
          {book.global_summary && (
            <button className={`tts-btn ${isPlaying ? 'playing' : ''}`} onClick={isPlaying ? (isPaused ? onResume : onPause) : () => onPlay(book)}>
              {isPlaying ? (isPaused ? <Play size={14} /> : <Pause size={14} />) : <Volume2 size={14} />}
              <span>{isPlaying ? (isPaused ? 'Reanudar' : 'Pausar') : 'Escuchar'}</span>
            </button>
          )}
          {isPlaying && <button className="tts-btn stop" onClick={onStop}><Square size={14} /></button>}
        </div>
      </div>
      <p>{book.global_summary || 'No disponible'}</p>
    </div>
  )
})

const ChaptersTab = React.memo(({ chapters, expanded, setExpanded, bookId, onChapterSummarized, view, setView, status, isProcessing, onTrigger, onPlay, onStop, currentTtsId, isPlaying, isPaused, onResume, onPause }) => {
  // Logic to check if all chapters are done
  const allDone = chapters.length > 0 && chapters.every(c => c.summary_status === 'done')
  
  return (
    <div className="chapters-list">
      <TabPhaseBar 
        phase={2} 
        label="Capítulos" 
        doneProp="phase2_done" 
        status={{...status, phase2_done: allDone}} 
        isProcessing={isProcessing} 
        onTrigger={onTrigger} 
      />
      
      <div className="chapters-controls">
        <div className="view-toggle-wrap">
          <button className={`view-toggle-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}><List size={14} /> Lista</button>
          <button className={`view-toggle-btn ${view === 'timeline' ? 'active' : ''}`} onClick={() => setView('timeline')}><GitBranch size={14} /> Línea</button>
        </div>
      </div>

      {view === 'list' ? (
        <div className="chapters-grid-view">
          {chapters.map((ch, i) => {
            const isChPlaying = currentTtsId === ch.id
            const hasSummary = ch.summary_status === 'done'
            
            return (
              <div key={ch.id} className={`chapter-item ${expanded === ch.id ? 'expanded' : ''}`}>
                <div className="chapter-header-main">
                  <button className="chapter-header-btn" onClick={() => setExpanded(expanded === ch.id ? null : ch.id)}>
                    <span className="ch-num">{i+1}</span>
                    <span className="ch-title">{ch.title}</span>
                    {hasSummary ? (
                      <span className="status-badge-done">Resumido</span>
                    ) : (
                      <span className="status-badge-pending">Pendiente</span>
                    )}
                    {expanded === ch.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  
                  <div className="chapter-actions">
                    {hasSummary && (
                      <button className={`ch-action-btn tts ${isChPlaying ? 'active' : ''}`} 
                        onClick={() => isChPlaying ? (isPaused ? onResume() : onPause()) : onPlay(ch, chapters)}>
                        {isChPlaying ? (isPaused ? <Play size={12} /> : <Pause size={12} />) : <Volume2 size={12} />}
                      </button>
                    )}
                    <button className="ch-action-btn reanalyze" title="Rehacer resumen de este capítulo"
                      onClick={async () => {
                        try {
                          await chapterAPI.summarize(bookId, ch.id)
                          toast.success('Resumiendo capítulo...')
                          onChapterSummarized()
                        } catch { toast.error('Error') }
                      }}>
                      <RefreshCw size={12} />
                    </button>
                  </div>
                </div>
                
                <AnimatePresence>
                  {expanded === ch.id && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="chapter-body"
                    >
                      <div className="chapter-body-inner">
                        {ch.summary || 'Sin resumen disponible.'}
                        {ch.key_events?.length > 0 && (
                          <div className="key-events">
                            <strong>Eventos Clave</strong>
                            <ul>{ch.key_events.map((e, ei) => <li key={ei}>{e}</li>)}</ul>
                          </div>
                        )}
                        {!hasSummary && (
                           <button className="summarize-now-btn" onClick={() => chapterAPI.summarize(bookId, ch.id).then(() => onChapterSummarized())}>
                             Generar resumen ahora
                           </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      ) : <InteractiveTimeline chapters={chapters} />}
    </div>
  )
})

const CharactersTab = React.memo(({ characters, bookId, status, isProcessing, onTrigger, onPlay, onStop, currentTtsId, isPlaying, isPaused, onResume, onPause, onRefresh }) => {
  return (
    <div className="characters-tab">
      <TabPhaseBar phase={3} label="Personajes" doneProp="phase3_done" status={status} isProcessing={isProcessing} onTrigger={onTrigger} />
      
      <div className="characters-grid">
        {characters.map(char => {
          const isCharPlaying = currentTtsId === char.name
          return (
            <div key={char.id} className="char-card">
              <div className="char-avatar">{char.name.charAt(0)}</div>
              <div className="char-content">
                <div className="char-card-header">
                  <h3>{char.name}</h3>
                  {char.description && <span className="status-badge-done sm">Analizado</span>}
                  <div className="char-card-actions">
                    <button className={`char-action-btn tts ${isCharPlaying ? 'active' : ''}`}
                      onClick={() => isCharPlaying ? (isPaused ? onResume() : onPause()) : onPlay(char)}>
                      {isCharPlaying ? (isPaused ? <Play size={12} /> : <Pause size={12} />) : <Volume2 size={12} />}
                    </button>
                    <button className="char-action-btn reanalyze" title="Rehacer este personaje"
                      onClick={async () => {
                        try {
                          await characterAPI.reanalyze(bookId, char.id)
                          toast.success('Analizando personaje...')
                          onRefresh()
                        } catch { toast.error('Error') }
                      }}>
                      <RefreshCw size={12} />
                    </button>
                  </div>
                </div>
                <span className="char-role">{char.role || 'Personaje'}</span>
                <p className="char-desc">{char.description}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
