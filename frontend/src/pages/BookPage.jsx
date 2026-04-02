import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  BookOpen, User, List, Brain, Map, Mic, Star, ExternalLink,
  Play, Pause, Square, ChevronDown, ChevronUp, Loader, CheckCircle,
  ArrowLeft, Edit3, Trash2, AlertCircle, Volume2, VolumeX, PlayCircle, FileText,
  Upload
} from 'lucide-react'
import { booksAPI, analysisAPI, chapterAPI, uploadToShell, reanalyzeCharacters } from '../utils/api'
import MindMap from '../components/MindMap'
import './BookPage.css'

const TABS = [
  { id: 'info',       label: 'Ficha',          icon: BookOpen },
  { id: 'chapters',   label: 'Capítulos',      icon: List     },
  { id: 'characters', label: 'Personajes',     icon: User     },
  { id: 'summary',    label: 'Resumen global', icon: Brain    },
  { id: 'mindmap',    label: 'Mapa mental',    icon: Map      },
  { id: 'podcast',    label: 'Podcast',        icon: Mic      },
  { id: 'refs',       label: 'Referencias',    icon: ExternalLink },
]

const PROCESSING_STATUSES = ['identifying', 'analyzing_structure', 'summarizing', 'generating_podcast']

export default function BookPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData]       = useState(null)
  const [status, setStatus]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState('info')
  const [expandedChapter, setExpandedChapter] = useState(null)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [audioEl, setAudioEl] = useState(null)
  const [rating, setRating]   = useState(0)
  const [audioUrl, setAudioUrl] = useState(null)

  // ── TTS: capítulos ──────────────────────────────────────────────────────────
  // ttsState: 'idle' | 'playing' | 'paused'
  const [ttsState,   setTtsState]   = useState('idle')
  const [ttsChapter, setTtsChapter] = useState(null)   // id del capítulo activo
  const ttsQueueRef   = useRef([])
  const ttsIndexRef   = useRef(0)
  const ttsActiveRef  = useRef(false)
  const storageKey    = `tts_pos_${id}`

  // ── TTS: personajes ─────────────────────────────────────────────────────────
  const [ttsCharState,   setTtsCharState]   = useState('idle')
  const [ttsCharacter,   setTtsCharacter]   = useState(null)
  const ttsCharQueueRef  = useRef([])
  const ttsCharIndexRef  = useRef(0)
  const ttsCharActiveRef = useRef(false)
  const charStorageKey   = `tts_char_pos_${id}`

  // ── TTS: ficha (info) ───────────────────────────────────────────────────────
  const [ttsInfoState,   setTtsInfoState]   = useState('idle')
  const ttsInfoActiveRef = useRef(false)

  // ── TTS: resumen global ─────────────────────────────────────────────────────
  const [ttsSummaryState,   setTtsSummaryState]   = useState('idle')
  const ttsSummaryActiveRef = useRef(false)

  // Detiene TODOS los motores TTS sin confirmación
  const _cancelAll = () => {
    ttsActiveRef.current      = false
    ttsCharActiveRef.current  = false
    ttsInfoActiveRef.current  = false
    ttsSummaryActiveRef.current = false
    window.speechSynthesis.cancel()
  }

  // Limpieza al desmontar
  useEffect(() => { return () => _cancelAll() }, [])

  // ── Helpers TTS capítulos ───────────────────────────────────────────────────
  const chapterToText = (c) => {
    let t = `${c.title}. ${c.summary || ''}`
    if (c.key_events?.length > 0) t += '. Eventos clave: ' + c.key_events.join('. ')
    return t
  }

  const _saveTTSPos = (idx, queue) => {
    try { localStorage.setItem(storageKey, JSON.stringify({ idx, chapterId: queue[idx]?.id })) } catch {}
  }

  const _speakChapter = (queue, idx) => {
    if (!ttsActiveRef.current || idx >= queue.length) {
      if (ttsActiveRef.current) {
        setTtsState('idle'); setTtsChapter(null)
        localStorage.removeItem(storageKey)
        ttsActiveRef.current = false
      }
      return
    }
    const item = queue[idx]
    ttsQueueRef.current  = queue
    ttsIndexRef.current  = idx
    _saveTTSPos(idx, queue)
    setTtsChapter(item.id)

    const u = new SpeechSynthesisUtterance(item.text)
    u.lang = 'es-ES'; u.rate = 0.95
    u.onend = () => { if (ttsActiveRef.current) _speakChapter(ttsQueueRef.current, ttsIndexRef.current + 1) }
    u.onerror = (e) => { if (e.error !== 'interrupted' && ttsActiveRef.current) _speakChapter(ttsQueueRef.current, ttsIndexRef.current + 1) }
    window.speechSynthesis.speak(u)
  }

  const startChaptersTTS = (queue, idx) => {
    _cancelAll()
    if (!queue.length) return
    ttsQueueRef.current = queue; ttsIndexRef.current = idx
    ttsActiveRef.current = true
    setTtsState('playing'); setTtsChapter(queue[idx]?.id)
    _speakChapter(queue, idx)
  }

  const pauseChaptersTTS = () => {
    ttsActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsState('paused')
  }

  const resumeChaptersTTS = () => {
    ttsActiveRef.current = true
    setTtsState('playing')
    _speakChapter(ttsQueueRef.current, ttsIndexRef.current)
  }

  const stopChaptersTTS = (force = false) => {
    if (!force && ttsState !== 'idle') {
      if (!window.confirm('¿Parar la reproducción? Se perderá el punto de avance.')) return
    }
    ttsActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsState('idle'); setTtsChapter(null)
    localStorage.removeItem(storageKey)
  }

  const playFromChapter = (chapter, chapters) => {
    const done = chapters.filter(c => c.summary && c.summary_status === 'done')
    const idx  = done.findIndex(c => c.id === chapter.id)
    const queue = done.slice(idx < 0 ? 0 : idx).map(c => ({ id: c.id, title: c.title, text: chapterToText(c) }))
    if (queue.length) startChaptersTTS(queue, 0)
  }

  // ── Helpers TTS personajes ──────────────────────────────────────────────────
  const characterToText = (char) => {
    let t = `Personaje: ${char.name}.`
    if (char.role)        t += ` Rol: ${char.role}.`
    if (char.description) t += ` ${char.description}.`
    if (char.personality) t += ` Personalidad: ${char.personality}.`
    if (char.arc)         t += ` Evolución: ${char.arc}.`
    if (char.relationships && Object.keys(char.relationships).length > 0)
      t += ` Relaciones: ${Object.entries(char.relationships).map(([n,r]) => `${n}, ${r}`).join('. ')}.`
    if (char.key_moments?.length > 0) t += ` Momentos clave: ${char.key_moments.join('. ')}.`
    return t
  }

  const _saveCharPos = (idx, queue) => {
    try { localStorage.setItem(charStorageKey, JSON.stringify({ idx, charName: queue[idx]?.name })) } catch {}
  }

  const _speakChar = (queue, idx) => {
    if (!ttsCharActiveRef.current || idx >= queue.length) {
      if (ttsCharActiveRef.current) {
        setTtsCharState('idle'); setTtsCharacter(null)
        localStorage.removeItem(charStorageKey)
        ttsCharActiveRef.current = false
      }
      return
    }
    const item = queue[idx]
    ttsCharQueueRef.current = queue; ttsCharIndexRef.current = idx
    _saveCharPos(idx, queue); setTtsCharacter(item.name)

    const u = new SpeechSynthesisUtterance(item.text)
    u.lang = 'es-ES'; u.rate = 0.95
    u.onend  = () => { if (ttsCharActiveRef.current) _speakChar(ttsCharQueueRef.current, ttsCharIndexRef.current + 1) }
    u.onerror = (e) => { if (e.error !== 'interrupted' && ttsCharActiveRef.current) _speakChar(ttsCharQueueRef.current, ttsCharIndexRef.current + 1) }
    window.speechSynthesis.speak(u)
  }

  const startCharsTTS = (queue, idx) => {
    _cancelAll()
    if (!queue.length) return
    ttsCharQueueRef.current = queue; ttsCharIndexRef.current = idx
    ttsCharActiveRef.current = true
    setTtsCharState('playing'); setTtsCharacter(queue[idx]?.name)
    _speakChar(queue, idx)
  }

  const pauseCharsTTS = () => {
    ttsCharActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsCharState('paused')
  }

  const resumeCharsTTS = () => {
    ttsCharActiveRef.current = true
    setTtsCharState('playing')
    _speakChar(ttsCharQueueRef.current, ttsCharIndexRef.current)
  }

  const stopCharsTTS = (force = false) => {
    if (!force && ttsCharState !== 'idle') {
      if (!window.confirm('¿Parar la reproducción?')) return
    }
    ttsCharActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsCharState('idle'); setTtsCharacter(null)
    localStorage.removeItem(charStorageKey)
  }

  const playCharacter      = (char)              => startCharsTTS([{ name: char.name, text: characterToText(char) }], 0)
  const playFromCharacter  = (char, characters)  => {
    const idx   = characters.findIndex(c => c.name === char.name)
    const queue = characters.slice(idx < 0 ? 0 : idx).map(c => ({ name: c.name, text: characterToText(c) }))
    if (queue.length) startCharsTTS(queue, 0)
  }

  // ── Helpers TTS ficha ───────────────────────────────────────────────────────
  const _speakSimple = (text, activeRef, setStateFn) => {
    _cancelAll()
    if (!text) { toast('No hay contenido para reproducir', { icon: 'ℹ️' }); return }
    activeRef.current = true
    setStateFn('playing')
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'es-ES'; u.rate = 0.95
    u.onend  = () => { setStateFn('idle'); activeRef.current = false }
    u.onerror = () => { setStateFn('idle'); activeRef.current = false }
    window.speechSynthesis.speak(u)
  }

  const playInfo   = (book) => _speakSimple(
    [book.synopsis, book.author_bio ? `Sobre el autor. ${book.author_bio}` : ''].filter(Boolean).join(' '),
    ttsInfoActiveRef, setTtsInfoState
  )
  const pauseInfoTTS  = () => { ttsInfoActiveRef.current = false; window.speechSynthesis.cancel(); setTtsInfoState('paused') }
  const resumeInfoTTS = (book) => playInfo(book)
  const stopInfoTTS   = (force = false) => {
    if (!force && ttsInfoState !== 'idle' && !window.confirm('¿Parar?')) return
    ttsInfoActiveRef.current = false; window.speechSynthesis.cancel(); setTtsInfoState('idle')
  }

  const playSummary    = (book) => _speakSimple(book.global_summary, ttsSummaryActiveRef, setTtsSummaryState)
  const pauseSummaryTTS  = () => { ttsSummaryActiveRef.current = false; window.speechSynthesis.cancel(); setTtsSummaryState('paused') }
  const resumeSummaryTTS = (book) => playSummary(book)
  const stopSummaryTTS   = (force = false) => {
    if (!force && ttsSummaryState !== 'idle' && !window.confirm('¿Parar?')) return
    ttsSummaryActiveRef.current = false; window.speechSynthesis.cancel(); setTtsSummaryState('idle')
  }

  // ── Control global TTS (cabecera) ───────────────────────────────────────────
  const anyTTSPlaying = ttsState === 'playing' || ttsCharState === 'playing' || ttsInfoState === 'playing' || ttsSummaryState === 'playing'
  const anyTTSPaused  = !anyTTSPlaying && (ttsState === 'paused' || ttsCharState === 'paused' || ttsInfoState === 'paused' || ttsSummaryState === 'paused')
  const anyTTSActive  = anyTTSPlaying || anyTTSPaused

  const globalPause = () => {
    if (ttsState      === 'playing') pauseChaptersTTS()
    else if (ttsCharState  === 'playing') pauseCharsTTS()
    else if (ttsInfoState  === 'playing') pauseInfoTTS()
    else if (ttsSummaryState === 'playing') pauseSummaryTTS()
  }

  const globalResume = (book) => {
    if (ttsState      === 'paused') resumeChaptersTTS()
    else if (ttsCharState  === 'paused') resumeCharsTTS()
    else if (ttsInfoState  === 'paused') resumeInfoTTS(book)
    else if (ttsSummaryState === 'paused') resumeSummaryTTS(book)
  }

  const globalStop = () => {
    if (!anyTTSActive) return
    if (!window.confirm('¿Seguro que quieres parar? Se perderá el punto de avance.')) return
    _cancelAll()
    setTtsState('idle'); setTtsCharState('idle'); setTtsInfoState('idle'); setTtsSummaryState('idle')
    setTtsChapter(null); setTtsCharacter(null)
    localStorage.removeItem(storageKey); localStorage.removeItem(charStorageKey)
  }

  // ── Datos y carga ───────────────────────────────────────────────────────────
  const load = async () => {
    try {
      const [bookRes, statusRes] = await Promise.all([
        booksAPI.get(id),
        analysisAPI.status(id),
      ])
      setData(bookRes.data)
      setStatus(statusRes.data)
      setRating(bookRes.data.book?.rating || 0)
    } catch {
      toast.error('No se encontró el libro')
      navigate('/')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  // Poll mientras procesa
  useEffect(() => {
    if (!status) return
    if (PROCESSING_STATUSES.includes(status.status)) {
      const t = setTimeout(load, 3500)
      return () => clearTimeout(t)
    }
  }, [status])

  const cancelProcess = async () => {
    if (!confirm('¿Cancelar el proceso en curso?')) return
    try {
      await analysisAPI.cancel(id)
      toast('Proceso cancelado')
      load()
    } catch { toast.error('Error al cancelar') }
  }

  // triggerPhase: NO navega, recarga en background
  const triggerPhase = async (phase) => {
    try {
      if (phase === 1)          await analysisAPI.triggerPhase1(id)
      else if (phase === 2)     await analysisAPI.triggerPhase2(id)
      else if (phase === 3)     await analysisAPI.triggerPhase3(id)
      else if (phase === 'podcast') await analysisAPI.triggerPodcast(id)
      toast.success('Proceso iniciado')
      setTimeout(load, 600)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al iniciar proceso')
    }
  }

  const handleRating = async (r) => {
    setRating(r)
    await booksAPI.update(id, { rating: r })
  }

  const handleReadStatus = async (s) => {
    await booksAPI.update(id, { read_status: s })
    load()
  }

  const loadAudio = async () => {
    try {
      const token = localStorage.getItem('bt_token')
      const resp = await fetch(analysisAPI.podcastAudioUrl(id), {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!resp.ok) throw new Error('Audio not found')
      const blob = await resp.blob()
      const url  = URL.createObjectURL(blob)
      setAudioUrl(url)
      return url
    } catch { toast.error('Error al cargar el audio'); return null }
  }

  const toggleAudio = async () => {
    if (!audioEl) {
      const url = audioUrl || await loadAudio()
      if (!url) return
      const el = new Audio(url)
      el.onended = () => setAudioPlaying(false)
      setAudioEl(el); el.play(); setAudioPlaying(true)
    } else {
      if (audioPlaying) { audioEl.pause(); setAudioPlaying(false) }
      else              { audioEl.play();  setAudioPlaying(true)  }
    }
  }

  // ── Export PDF ──────────────────────────────────────────────────────────────
  const exportToPDF = async () => {
    if (!book) return
    toast('Generando PDF...', { icon: '📄', duration: 3000 })
    try {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
      document.head.appendChild(script)
      await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject })

      const { jsPDF } = window.jspdf
      const doc = new jsPDF()
      let y = 20
      const margin = 20, maxWidth = 170
      const checkPage = (n = 20) => { if (y + n > doc.internal.pageSize.height - 20) { doc.addPage(); y = 20 } }
      const addText  = (text, size = 10, weight = 'normal') => {
        doc.setFontSize(size); doc.setFont('helvetica', weight)
        doc.splitTextToSize(text || '', maxWidth).forEach(l => { checkPage(); doc.text(l, margin, y); y += size * 0.4 })
        y += 3
      }

      doc.setFillColor(13,13,13); doc.rect(0,0,210,297,'F')
      doc.setTextColor(201,169,110); doc.setFontSize(28); doc.setFont('helvetica','bold')
      doc.splitTextToSize(book.title, 170).forEach((l,i) => doc.text(l, 105, 100+(i*12), {align:'center'}))
      if (book.author) { doc.setFontSize(16); doc.setFont('helvetica','normal'); doc.text(book.author, 105, 130, {align:'center'}) }
      doc.setFontSize(10)
      doc.text('Análisis generado por BookTracker', 105, 280, {align:'center'})
      doc.text(new Date().toLocaleDateString('es-ES'), 105, 286, {align:'center'})

      doc.addPage(); doc.setTextColor(0,0,0); y = 20
      doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(201,169,110)
      doc.text('Información General', margin, y); y += 12; doc.setTextColor(0,0,0)
      if (book.isbn)  addText(`ISBN: ${book.isbn}`, 11, 'bold')
      if (book.year)  addText(`Año: ${book.year}`, 11, 'bold')
      if (book.genre) addText(`Género: ${book.genre}`, 11, 'bold')
      if (book.pages) addText(`Páginas: ${book.pages}`, 11, 'bold')
      y += 5

      if (book.synopsis)   { checkPage(30); doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.setTextColor(201,169,110); doc.text('Sinopsis', margin, y); y+=10; doc.setTextColor(0,0,0); addText(book.synopsis,10) }
      if (book.author_bio) { checkPage(30); doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.setTextColor(201,169,110); doc.text('Sobre el autor', margin, y); y+=10; doc.setTextColor(0,0,0); addText(book.author_bio,10) }
      if (book.global_summary) { checkPage(30); doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.setTextColor(201,169,110); doc.text('Resumen Global', margin, y); y+=10; doc.setTextColor(0,0,0); addText(book.global_summary,10) }

      if (chapters.length > 0) {
        doc.addPage(); y = 20
        doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(201,169,110)
        doc.text('Capítulos', margin, y); y += 12; doc.setTextColor(0,0,0)
        chapters.forEach((ch,i) => {
          checkPage(25); doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(201,169,110)
          doc.text(`${i+1}. ${ch.title}`, margin, y); y+=7; doc.setTextColor(0,0,0)
          if (ch.summary) addText(ch.summary, 9)
          if (ch.key_events?.length > 0) { doc.setFont('helvetica','italic'); addText('Eventos: '+ch.key_events.join(', '),8) }
          y += 3
        })
      }

      if (characters.length > 0) {
        doc.addPage(); y = 20
        doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(201,169,110)
        doc.text('Personajes', margin, y); y += 12; doc.setTextColor(0,0,0)
        characters.forEach(char => {
          checkPage(30); doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(201,169,110)
          doc.text(char.name, margin, y); y+=7; doc.setTextColor(0,0,0)
          if (char.description) addText(char.description,9)
          if (char.personality) { addText('Personalidad:',9,'bold'); addText(char.personality,9) }
          if (char.arc)         { addText('Evolución:',9,'bold');    addText(char.arc,9) }
          y += 5
        })
      }

      doc.save(`${book.title.replace(/[^a-z0-9]/gi,'_')}_analisis.pdf`)
      toast.success('PDF generado correctamente')
    } catch (e) { console.error(e); toast.error('Error al generar el PDF') }
  }

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar "${data?.book?.title}"?`)) return
    await booksAPI.delete(id)
    navigate('/')
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="book-loading">
      <Loader size={28} className="spin" strokeWidth={1.5} />
    </div>
  )

  if (!data) return (
    <div className="book-loading" style={{flexDirection:'column',gap:'1rem'}}>
      <p style={{color:'var(--slate)'}}>No se pudo cargar el libro</p>
      <button onClick={() => navigate('/')} style={{background:'var(--ink)',color:'var(--paper)',border:'none',padding:'0.5rem 1rem',borderRadius:'4px',cursor:'pointer'}}>
        Volver a la biblioteca
      </button>
    </div>
  )

  const book       = data?.book       || {}
  const chapters   = data?.chapters   || []
  const characters = data?.characters || []
  const otherBooks = data?.other_books || []
  const allBiblio  = book.author_bibliography || []

  const isProcessing = PROCESSING_STATUSES.includes(status?.status)
  const isShell      = book.status === 'shell' || book.status === 'shell_error'
  const hasFile      = !!book.file_path

  const coverSrc = book.cover_local
    ? (book.cover_local.includes('/covers/')
        ? `/data/covers/${book.cover_local.split('/covers/')[1]}`
        : book.cover_local)
    : null

  return (
    <div className="book-page">
      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <div className="book-hero">
        <button className="back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Biblioteca
        </button>

        <div className="hero-content">
          <div className="hero-cover">
            {coverSrc
              ? <img src={coverSrc} alt={book.title} />
              : <div className="cover-ph-lg"><BookOpen size={48} strokeWidth={1} /></div>
            }
          </div>

          <div className="hero-info">
            <h1>{book.title}</h1>
            {book.author && (
              <p className="hero-author">
                <Link to="/authors" state={{author: book.author}}>{book.author}</Link>
              </p>
            )}

            {/* TTS global: solo aparece cuando hay reproducción activa o pausada */}
            {anyTTSActive && (
              <div className="hero-tts-global">
                {anyTTSPlaying ? (
                  <>
                    <button className="hero-tts-btn" onClick={globalPause}>
                      <Pause size={14} /> Pausar reproducción
                    </button>
                    <button className="hero-tts-btn hero-tts-stop" onClick={globalStop}>
                      <Square size={14} /> Stop
                    </button>
                  </>
                ) : (
                  <>
                    <button className="hero-tts-btn hero-tts-resume" onClick={() => globalResume(book)}>
                      <Play size={14} /> Continuar reproducción
                    </button>
                    <button className="hero-tts-btn hero-tts-stop" onClick={globalStop}>
                      <Square size={14} /> Stop
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="hero-meta">
              {book.year     && <span>{book.year}</span>}
              {book.pages    && <span>{book.pages} páginas</span>}
              {book.isbn     && <span>ISBN: {book.isbn}</span>}
              {book.genre    && <span>{book.genre}</span>}
            </div>

            {/* Valoración */}
            <div className="star-rating">
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => handleRating(n)} className={`star ${rating >= n ? 'filled' : ''}`}>
                  <Star size={20} fill={rating >= n ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>

            {/* Estado de lectura */}
            <div className="read-status-btns">
              {[{v:'to_read',l:'Por leer'},{v:'reading',l:'Leyendo'},{v:'read',l:'Leído ✓'}].map(s => (
                <button key={s.v} className={`rs-btn ${book.read_status === s.v ? 'active' : ''}`} onClick={() => handleReadStatus(s.v)}>
                  {s.l}
                </button>
              ))}
            </div>

            {/* Exportar PDF */}
            {status?.phase3_done && (
              <button className="export-pdf-btn" onClick={exportToPDF}>
                <FileText size={16} /> Exportar a PDF
              </button>
            )}

            {/* Subir archivo: fichas sin archivo */}
            {(!hasFile || isShell) && (
              <div className="shell-upload-area">
                <span className="shell-label">
                  {isShell ? 'Solo ficha — sube el PDF/EPUB para analizar' : 'Sin archivo adjunto'}
                </span>
                <label className="shell-upload-btn">
                  <input type="file" accept=".pdf,.epub" style={{display:'none'}}
                    onChange={async (e) => {
                      const f = e.target.files[0]; if (!f) return
                      try { toast('Subiendo…',{icon:'⏳'}); await uploadToShell(id,f); toast.success('Archivo subido. Identificando…'); load() }
                      catch { toast.error('Error al subir el archivo') }
                    }} />
                  <Upload size={13} /> Subir PDF/EPUB
                </label>
              </div>
            )}

            {/* Reemplazar archivo: libros ya analizados */}
            {hasFile && !isShell && (
              <div className="attach-file-area">
                <label className="attach-file-btn">
                  <input type="file" accept=".pdf,.epub" style={{display:'none'}}
                    onChange={async (e) => {
                      const f = e.target.files[0]; if (!f) return
                      if (!confirm('¿Reemplazar el archivo? Se mantendrá el análisis existente.')) return
                      try { toast('Subiendo…',{icon:'⏳'}); await uploadToShell(id,f); toast.success('Archivo actualizado'); load() }
                      catch { toast.error('Error al subir el archivo') }
                    }} />
                  <Upload size={13} /> Reemplazar archivo
                </label>
              </div>
            )}

            {/* Pipeline de análisis */}
            {!isShell && (
              <ProcessingPipeline
                status={status}
                isProcessing={isProcessing}
                onTrigger={triggerPhase}
                onCancel={cancelProcess}
              />
            )}
          </div>

          <button className="delete-btn" onClick={handleDelete} title="Eliminar libro">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="book-tabs">
        {/* Sidebar desktop */}
        <div className="tabs-bar tabs-bar-desktop">
          {TABS.map(t => (
            <button key={t.id}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              disabled={
                (isShell && t.id !== 'info') ||
                (t.id === 'chapters'   && !status?.phase2_done) ||
                (t.id === 'characters' && !status?.phase3_done) ||
                (t.id === 'summary'    && !status?.phase3_done) ||
                (t.id === 'mindmap'    && !status?.phase3_done) ||
                (t.id === 'podcast'    && !book.podcast_script)
              }
            >
              <t.icon size={15} strokeWidth={1.5} />{t.label}
            </button>
          ))}
        </div>

        {/* Select móvil */}
        <div className="tabs-select-wrapper tabs-select-mobile">
          <select className="tabs-select" value={tab} onChange={e => setTab(e.target.value)}>
            {TABS.map(t => {
              const disabled =
                (isShell && t.id !== 'info') ||
                (t.id === 'chapters'   && !status?.phase2_done) ||
                (t.id === 'characters' && !status?.phase3_done) ||
                (t.id === 'summary'    && !status?.phase3_done) ||
                (t.id === 'mindmap'    && !status?.phase3_done) ||
                (t.id === 'podcast'    && !book.podcast_script)
              const icon = {info:'📖',chapters:'📑',characters:'👤',summary:'🧠',mindmap:'🗺️',podcast:'🎙️',refs:'🔗'}[t.id]||'•'
              return <option key={t.id} value={t.id} disabled={disabled}>{icon} {t.label}</option>
            })}
          </select>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab} className="tab-content"
            initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:0.2}}>

            {tab === 'info' && (
              <InfoTab
                book={book}
                otherBooks={otherBooks}
                allBiblio={allBiblio}
                ttsState={ttsInfoState}
                onPlay={() => playInfo(book)}
                onPause={pauseInfoTTS}
                onResume={() => resumeInfoTTS(book)}
                onStop={() => stopInfoTTS()}
              />
            )}

            {tab === 'chapters' && (
              <ChaptersTab
                chapters={chapters}
                expanded={expandedChapter}
                setExpanded={setExpandedChapter}
                bookId={id}
                onChapterSummarized={load}
                ttsState={ttsState}
                ttsChapter={ttsChapter}
                onPlayChapter={(ch) => startChaptersTTS([{id:ch.id,title:ch.title,text:chapterToText(ch)}], 0)}
                onPlayFromChapter={(ch) => playFromChapter(ch, chapters)}
                onPause={pauseChaptersTTS}
                onResume={resumeChaptersTTS}
                onStop={() => stopChaptersTTS()}
              />
            )}

            {tab === 'characters' && (
              <CharactersTab
                characters={characters}
                bookId={id}
                onReanalyzed={load}
                status={status}
                ttsState={ttsCharState}
                ttsCharacter={ttsCharacter}
                onPlayCharacter={playCharacter}
                onPlayFromCharacter={playFromCharacter}
                onPause={pauseCharsTTS}
                onResume={resumeCharsTTS}
                onStop={() => stopCharsTTS()}
              />
            )}

            {tab === 'summary' && (
              <SummaryTab
                book={book}
                ttsState={ttsSummaryState}
                onPlay={() => playSummary(book)}
                onPause={pauseSummaryTTS}
                onResume={() => resumeSummaryTTS(book)}
                onStop={() => stopSummaryTTS()}
              />
            )}

            {tab === 'mindmap' && (
              book.mindmap_data
                ? <MindMap data={book.mindmap_data} />
                : <p className="empty-tab">Mapa mental no disponible</p>
            )}

            {tab === 'refs'    && <RefsTab    book={book} />}
            {tab === 'podcast' && <PodcastTab book={book} playing={audioPlaying} onToggle={toggleAudio} />}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── ProcessingPipeline ─────────────────────────────────────────────────────────
const STUCK_STATUSES = ['identifying','analyzing_structure','summarizing','generating_podcast']

function ProcessingPipeline({ status, isProcessing, onTrigger, onCancel }) {
  if (!status) return null

  const isStuck = STUCK_STATUSES.includes(status.status)

  const steps = [
    { label:'Fase 1: Identificación',  sub:'Ficha, sinopsis, autor',                done:status.phase1_done,                                  canTrigger:true,                   trigger:()=>onTrigger(1) },
    { label:'Fase 2: Estructura',       sub:'Capítulos',                              done:status.phase2_done,                                  canTrigger:status.phase1_done,     trigger:()=>onTrigger(2) },
    { label:'Fase 3a: Resúmenes',       sub:'Resumen de cada capítulo',               done:status.chapters_summarized||status.phase3_done,      canTrigger:status.phase2_done,     trigger:()=>onTrigger(3), resumable:status.phase2_done&&!status.phase3_done&&status.chapters_done>0 },
    { label:'Fase 3b: Análisis IA',     sub:'Personajes, resumen global, mapa mental',done:status.phase3_done,                                  canTrigger:status.chapters_summarized||status.phase3_done, trigger:()=>onTrigger(3) },
    { label:'Podcast',                  sub:'Guión y audio',                          done:status.podcast_done,                                 canTrigger:status.phase3_done,     trigger:()=>onTrigger('podcast') },
  ]

  const firstPending = steps.findIndex(s => !s.done)

  return (
    <div className="pipeline">
      {isStuck && (
        <div className="pipeline-stuck-banner">
          <AlertCircle size={13} />
          <span>Proceso bloqueado o en curso</span>
          <button className="unlock-btn" onClick={onCancel}>🔓 Desbloquear</button>
        </div>
      )}
      {steps.map((s, i) => (
        <div key={i} className={`pipeline-step ${s.done ? 'done' : ''}`}>
          {s.done
            ? <CheckCircle size={14} />
            : (isProcessing && i === firstPending)
              ? <Loader size={14} className="spin" />
              : <div className="step-dot" />
          }
          <span>{s.label}<span className="step-sublabel"> ({s.sub})</span></span>
          {s.canTrigger && !isProcessing && !isStuck && (
            <button className="trigger-btn" onClick={s.trigger}>
              {s.done ? 'Repetir' : s.resumable ? 'Reanudar' : 'Iniciar'}
            </button>
          )}
          {isProcessing && i === firstPending && (
            <button className="cancel-btn" onClick={onCancel}>Cancelar</button>
          )}
        </div>
      ))}
      {status.error_msg && (
        <div className={`pipeline-error ${status.error_msg.includes('Cuota')||status.status==='quota_exceeded' ? 'quota-error' : ''}`}>
          <AlertCircle size={14} />
          <span>{status.error_msg.includes('Cuota')||status.status==='quota_exceeded' ? status.error_msg : 'Error en el proceso'}</span>
        </div>
      )}
    </div>
  )
}

// ── InfoTab ────────────────────────────────────────────────────────────────────
function InfoTab({ book, otherBooks, allBiblio, ttsState, onPlay, onPause, onResume, onStop }) {
  // Une libros en la app + libros solo en bibliografía
  const allWorks = React.useMemo(() => {
    const inApp  = new Map()
    otherBooks.forEach(b => {
      inApp.set((b.title||'').toLowerCase().trim(), true)
      if (b.isbn) inApp.set(b.isbn, true)
    })
    const missing = []
    ;(allBiblio || []).forEach(item => {
      const title = typeof item === 'string' ? item : item?.title
      const isbn  = typeof item === 'object' ? item?.isbn : null
      if (!title) return
      const key = title.toLowerCase().trim()
      if (inApp.has(key) || (isbn && inApp.has(isbn))) return
      missing.push({ _missing:true, title, isbn, year:item?.year||null, cover_url:item?.cover_url||null })
    })
    return [...otherBooks, ...missing].sort((a,b) => (b.year||0)-(a.year||0))
  }, [otherBooks, allBiblio])

  return (
    <div className="info-tab">
      {(book.synopsis || book.author_bio) && (
        <div className="info-tts-controls">
          {ttsState === 'idle' && (
            <button className="info-tts-play-btn" onClick={onPlay}><Play size={16} /> Reproducir ficha</button>
          )}
          {ttsState === 'playing' && (
            <div className="info-tts-active">
              <button className="tts-control-btn" onClick={onPause}><Pause size={16} /></button>
              <button className="tts-control-btn stop" onClick={onStop}><Square size={16} /></button>
              <span className="tts-indicator"><Volume2 size={14} className="pulse" /> Reproduciendo</span>
            </div>
          )}
          {ttsState === 'paused' && (
            <div className="info-tts-active">
              <button className="info-tts-play-btn" onClick={onResume}><Play size={16} /> Continuar reproducción</button>
              <button className="tts-control-btn stop" onClick={onStop}><Square size={16} /></button>
            </div>
          )}
        </div>
      )}

      {book.synopsis   && <section><h3>Sinopsis</h3><p>{book.synopsis}</p></section>}
      {book.author_bio && <section><h3>Sobre el autor</h3><p>{book.author_bio}</p></section>}

      {allWorks.length > 0 && (
        <section>
          <h3>Otras obras del autor</h3>
          <div className="refs-grid">
            {allWorks.map((ob, idx) => {
              if (ob._missing) {
                return (
                  <div key={`m-${idx}`} className="ref-item" style={{opacity:0.72,borderStyle:'dashed'}}>
                    <div className="ref-cover">
                      {ob.cover_url
                        ? <img src={ob.cover_url} alt={ob.title} />
                        : <div style={{width:60,height:85,background:'#f0f0f0',borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center'}}><BookOpen size={22} strokeWidth={1} color="#999"/></div>
                      }
                    </div>
                    <div className="ref-info">
                      <h4 className="ref-title">{ob.title}</h4>
                      {ob.year && <span className="ref-year">{ob.year}</span>}
                      <span className="ref-badge muted">No añadido</span>
                    </div>
                  </div>
                )
              }
              const coverPath = ob.cover_local?.includes('/covers/')
                ? `/data/covers/${ob.cover_local.split('/covers/')[1]}`
                : ob.cover_local || null
              const isAnalyzed = ob.status === 'complete' || ob.phase3_done
              const obIsShell  = ob.status === 'shell' || ob.status === 'shell_error'
              return (
                <Link key={ob.id} to={`/book/${ob.id}`} className="ref-item" style={{textDecoration:'none'}}>
                  <div className="ref-cover">
                    {coverPath
                      ? <img src={coverPath} alt={ob.title} />
                      : <div style={{width:60,height:85,background:'#f0f0f0',borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center'}}><BookOpen size={22} strokeWidth={1} color="#999"/></div>
                    }
                  </div>
                  <div className="ref-info">
                    <h4 className="ref-title">{ob.title}</h4>
                    {ob.year && <span className="ref-year">{ob.year}</span>}
                    {isAnalyzed && <span className="ref-badge" style={{color:'var(--gold)',fontWeight:500}}>✦ Analizado</span>}
                    {obIsShell  && <span className="ref-badge muted">Solo ficha</span>}
                    {!obIsShell && !isAnalyzed && <span className="ref-badge" style={{color:'#3498db'}}>Sin analizar</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {!book.synopsis && !book.author_bio && <p className="empty-tab">La información del libro aún se está cargando…</p>}
    </div>
  )
}

// ── SummaryTab ─────────────────────────────────────────────────────────────────
function SummaryTab({ book, ttsState, onPlay, onPause, onResume, onStop }) {
  return (
    <div className="prose-content">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1.25rem',flexWrap:'wrap',gap:'0.75rem'}}>
        <h2 style={{margin:0}}>Resumen global</h2>
        {book.global_summary && (
          <div style={{display:'flex',gap:'0.5rem',alignItems:'center'}}>
            {ttsState === 'idle' && (
              <button className="info-tts-play-btn" onClick={onPlay}><Play size={15}/> Escuchar</button>
            )}
            {ttsState === 'playing' && (
              <>
                <button className="tts-control-btn" onClick={onPause}><Pause size={15}/></button>
                <button className="tts-control-btn stop" onClick={onStop}><Square size={15}/></button>
                <span className="tts-indicator"><Volume2 size={13} className="pulse"/> Reproduciendo</span>
              </>
            )}
            {ttsState === 'paused' && (
              <>
                <button className="info-tts-play-btn" onClick={onResume}><Play size={15}/> Continuar</button>
                <button className="tts-control-btn stop" onClick={onStop}><Square size={15}/></button>
              </>
            )}
          </div>
        )}
      </div>
      <p>{book.global_summary || 'No disponible'}</p>
    </div>
  )
}

// ── ChaptersTab ────────────────────────────────────────────────────────────────
function ChaptersTab({ chapters, expanded, setExpanded, bookId, onChapterSummarized, ttsState, ttsChapter, onPlayChapter, onPlayFromChapter, onPause, onResume, onStop }) {
  const [summarizing, setSummarizing] = React.useState({})

  const handleSummarize = async (e, ch) => {
    e.stopPropagation()
    setSummarizing(s => ({...s,[ch.id]:true}))
    try {
      await chapterAPI.summarize(bookId, ch.id)
      toast('Resumiendo capítulo...', {icon:'⏳'})
      const poll = setInterval(async () => {
        const {data} = await import('../utils/api').then(m => m.booksAPI.get(bookId))
        const c = data.chapters?.find(c => c.id === ch.id)
        if (c?.summary_status === 'done') { clearInterval(poll); setSummarizing(s=>({...s,[ch.id]:false})); onChapterSummarized?.(); toast.success('Capítulo resumido') }
      }, 3000)
      setTimeout(() => clearInterval(poll), 120000)
    } catch {
      setSummarizing(s => ({...s,[ch.id]:false})); toast.error('Error al resumir')
    }
  }

  if (!chapters.length) return <p className="empty-tab">No se encontraron capítulos</p>

  return (
    <div className="chapters-list">
      {chapters.map((ch, i) => (
        <div key={ch.id} className={`chapter-item ${expanded === ch.id ? 'open' : ''}`}>
          <button className="chapter-header" onClick={() => setExpanded(expanded === ch.id ? null : ch.id)}>
            <span className="ch-num">{String(i+1).padStart(2,'0')}</span>
            <span className="ch-title">{ch.title}</span>
            <div className="ch-meta">
              {ch.summary_status === 'done'
                ? <span className="badge badge-green">Resumido</span>
                : ch.summary_status === 'quota_exceeded'
                  ? <span className="badge badge-rust" title={ch.summary}>⏰ Cuota agotada</span>
                  : ch.summary_status === 'skipped'
                    ? <span className="badge badge-slate">⚠ Omitido</span>
                    : ch.summary_status === 'processing'
                      ? <span className="badge badge-gold">Procesando…</span>
                      : <button className="summarize-ch-btn" onClick={e=>handleSummarize(e,ch)} disabled={summarizing[ch.id]}>
                          {summarizing[ch.id] ? '…' : '+ Resumir'}
                        </button>
              }
              {ch.summary_status === 'done' && (
                <div className="ch-tts-btns" onClick={e=>e.stopPropagation()}>
                  {/* Play / Pausa del capítulo individual */}
                  <button
                    className={`ch-tts-btn ${ttsState==='playing'&&ttsChapter===ch.id ? 'pause' : 'play'}`}
                    onClick={() => {
                      if      (ttsState==='playing' && ttsChapter===ch.id) onPause()
                      else if (ttsState==='paused'  && ttsChapter===ch.id) onResume()
                      else onPlayChapter(ch)
                    }}
                    title={ttsState==='playing'&&ttsChapter===ch.id ? 'Pausar' : 'Reproducir'}
                  >
                    {ttsState==='playing'&&ttsChapter===ch.id ? <Pause size={12}/> : <Play size={12}/>}
                  </button>
                  {/* Reproducir desde aquí */}
                  <button className="ch-tts-btn play-from" onClick={()=>onPlayFromChapter(ch)} title="Leer desde aquí">
                    <Volume2 size={12}/>
                  </button>
                </div>
              )}
              {ch.page_start && <span className="ch-pages">p.{ch.page_start}–{ch.page_end}</span>}
              {expanded===ch.id ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
            </div>
          </button>
          <AnimatePresence>
            {expanded===ch.id && (
              <motion.div className="chapter-body" initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}}>
                <div className="chapter-body-inner">
                  {ch.summary
                    ? <p>{ch.summary}</p>
                    : <p className="muted">Resumen no disponible</p>
                  }
                  {ch.key_events?.length > 0 && (
                    <div className="key-events">
                      <strong>Eventos clave:</strong>
                      <ul>{ch.key_events.map((e,i) => <li key={i}>{e}</li>)}</ul>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  )
}

// ── CharactersTab ──────────────────────────────────────────────────────────────
function CharactersTab({ characters, bookId, onReanalyzed, status, ttsState, ttsCharacter, onPlayCharacter, onPlayFromCharacter, onPause, onResume, onStop }) {
  const [reanalyzing, setReanalyzing] = React.useState(false)

  const handleReanalyze = async () => {
    setReanalyzing(true)
    try {
      await reanalyzeCharacters(bookId)
      toast('Reanalizando personajes…',{icon:'⏳'})
      setTimeout(async () => { await onReanalyzed(); setReanalyzing(false) }, 60000)
    } catch { toast.error('Error al reanalizar'); setReanalyzing(false) }
  }

  return (
    <div className="characters-tab">
      <div className="characters-header">
        <div className="characters-info">
          <span className="characters-count">{characters.length} personaje{characters.length!==1?'s':''}</span>
          {ttsState==='playing' && ttsCharacter && (
            <span className="tts-indicator"><Volume2 size={14} className="pulse"/> Reproduciendo personajes</span>
          )}
          {ttsState==='paused' && (
            <span className="tts-indicator" style={{color:'var(--slate)'}}>⏸ Pausado</span>
          )}
        </div>
        <div className="characters-actions">
          {ttsState==='playing' && (
            <><button className="tts-control-btn" onClick={onPause}><Pause size={16}/></button>
              <button className="tts-control-btn stop" onClick={onStop}><Square size={16}/></button></>
          )}
          {ttsState==='paused' && (
            <><button className="tts-control-btn resume" onClick={onResume}><Play size={16}/></button>
              <button className="tts-control-btn stop" onClick={onStop}><Square size={16}/></button></>
          )}
          {status?.phase3_done && (
            <button className="reanalyze-chars-btn" onClick={handleReanalyze} disabled={reanalyzing}>
              {reanalyzing ? '⏳ Reanalizando…' : '↻ Reanalizar'}
            </button>
          )}
        </div>
      </div>

      {!characters.length
        ? <p className="empty-tab">No se encontraron personajes.</p>
        : (
          <div className="characters-grid">
            {characters.map((char, i) => {
              const isPlaying = ttsState==='playing' && ttsCharacter===char.name
              return (
                <div key={i} className={`char-card ${isPlaying ? 'char-playing' : ''}`}>
                  <div className="char-avatar">{char.name?.[0]?.toUpperCase()||'?'}</div>
                  <div className="char-info">
                    <div className="char-header">
                      <h3 className="char-name">{char.name}</h3>
                      <div className="char-tts-btns">
                        <button className="char-tts-btn" disabled={ttsState==='playing'} onClick={()=>onPlayCharacter(char)} title="Reproducir">
                          {isPlaying ? <Volume2 size={14} className="pulse"/> : <Play size={14}/>}
                        </button>
                        <button className="char-tts-btn from-here" disabled={ttsState==='playing'} onClick={()=>onPlayFromCharacter(char,characters)} title="Desde aquí">
                          <PlayCircle size={14}/>
                        </button>
                      </div>
                    </div>
                    {char.role        && <span className={`char-role role-${char.role}`}>{char.role}</span>}
                    {char.description && <p className="char-desc">{char.description}</p>}
                    {char.personality && <div className="char-section"><strong>Personalidad</strong><p>{char.personality}</p></div>}
                    {char.arc         && <div className="char-section"><strong>Evolución</strong><p>{char.arc}</p></div>}
                    {char.importance  && <div className="char-section"><strong>Importancia</strong><p>{char.importance}</p></div>}
                    {char.relationships && typeof char.relationships === 'object' && !Array.isArray(char.relationships) && Object.keys(char.relationships).length > 0 && (
                      <div className="char-section">
                        <strong>Relaciones</strong>
                        <ul className="char-relations">
                          {Object.entries(char.relationships).map(([n,r],j) => <li key={j}><em>{n}</em>: {r}</li>)}
                        </ul>
                      </div>
                    )}
                    {char.key_moments?.length > 0 && (
                      <div className="char-section">
                        <strong>Momentos clave</strong>
                        {char.key_moments.map((q,j) => <blockquote key={j} className="char-quote">{q}</blockquote>)}
                      </div>
                    )}
                    {char.quotes?.length > 0 && (
                      <div className="char-section">
                        <strong>Citas memorables</strong>
                        {char.quotes.map((q,j) => <blockquote key={j} className="char-quote">{q}</blockquote>)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      }
    </div>
  )
}

// ── RefsTab ────────────────────────────────────────────────────────────────────
function RefsTab({ book }) {
  const t = encodeURIComponent(book.title||'')
  const a = encodeURIComponent(book.author||'')
  const isbn = book.isbn||''
  return (
    <div className="refs-tab">
      <h3>Referencias externas</h3>
      <p className="refs-subtitle">Enlaces para ampliar información sobre el libro y su autor</p>
      <div className="refs-sections">
        <div className="refs-section">
          <h4><BookOpen size={18}/>Sobre el libro</h4>
          <div className="refs-links">
            {[
              ['Wikipedia',      `https://es.wikipedia.org/wiki/${t}`],
              ['Goodreads',      `https://www.goodreads.com/search?q=${t}`],
              ['YouTube',        `https://www.youtube.com/results?search_query=${t}+${a}`],
              ['Amazon',         `https://www.amazon.es/s?k=${t}+${a}`],
              ['Google Books',   isbn?`https://books.google.es/books?isbn=${isbn}`:`https://books.google.es/books?q=${t}+${a}`],
              ['WorldCat',       `https://www.worldcat.org/search?q=${t}`],
            ].map(([label,href]) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="ref-link">
                <ExternalLink size={15}/><span>{label}</span>
              </a>
            ))}
          </div>
        </div>
        {book.author && (
          <div className="refs-section">
            <h4><User size={18}/>Sobre el autor</h4>
            <div className="refs-links">
              {[
                ['Wikipedia (autor)',     `https://es.wikipedia.org/wiki/${a}`],
                ['Goodreads (autor)',     `https://www.goodreads.com/search?q=${a}&search_type=author`],
                ['Entrevistas YouTube',   `https://www.youtube.com/results?search_query=${a}+entrevista`],
                ['X / Twitter',          `https://twitter.com/search?q=${a}`],
                ['Instagram',            `https://www.instagram.com/explore/search/keyword/?q=${a}`],
              ].map(([label,href]) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="ref-link">
                  <ExternalLink size={15}/><span>{label}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="refs-note">💡 Estos enlaces se generan automáticamente. Algunos pueden no estar disponibles.</p>
    </div>
  )
}

// ── PodcastTab ─────────────────────────────────────────────────────────────────
function PodcastTab({ book, playing, onToggle }) {
  const hasScript = !!book?.podcast_script
  const hasAudio  = !!book?.podcast_audio_path

  if (!hasScript && !hasAudio) return (
    <div className="empty-tab">
      <Mic size={48} strokeWidth={1}/>
      <p>El podcast aún no ha sido generado</p>
    </div>
  )

  const processScript = (script) => {
    const sections = []; let cur = null
    script.split('\n').filter(l=>l.trim()).forEach(line => {
      const t = line.trim()
      if ((t===t.toUpperCase()&&t.length>3) || /^(INTRODUCCIÓN|CAPÍTULO|PARTE|PERSONAJES|CONCLUSIÓN|ANÁLISIS)/i.test(t) || /^[#*_=]/.test(t)) {
        if (cur) sections.push(cur)
        cur = { title: t.replace(/^[#*_=]+\s*/,'').replace(/[#*_=]+$/,''), content:[] }
      } else if (/^[-•]\s/.test(t)) {
        if (!cur) cur={title:'',content:[]}
        cur.content.push({type:'dialogue',text:t.substring(2)})
      } else if (t.endsWith('?')) {
        if (!cur) cur={title:'',content:[]}
        cur.content.push({type:'question',text:t})
      } else if (t) {
        if (!cur) cur={title:'',content:[]}
        cur.content.push({type:'paragraph',text:t})
      }
    })
    if (cur) sections.push(cur)
    return sections
  }

  const sections = hasScript ? processScript(book.podcast_script) : []

  return (
    <div className="podcast-tab">
      {hasAudio && (
        <div className="podcast-player">
          <button className="podcast-play-btn" onClick={onToggle}>
            {playing ? <Pause size={24}/> : <Play size={24}/>}
            <span>{playing ? 'Pausar podcast' : 'Reproducir podcast'}</span>
          </button>
        </div>
      )}
      {hasScript && (
        <div className="podcast-script">
          <h3><Volume2 size={18}/>Guión del podcast</h3>
          <div className="script-content-enhanced">
            {sections.map((sec,i) => (
              <div key={i} className={`script-section ${sec.title ? 'section' : 'default'}`}>
                {sec.title && <h4 className="section-title"><span className="section-marker">▸</span>{sec.title}</h4>}
                {sec.content.map((item,j) => {
                  if (item.type==='dialogue') return <p key={j} className="script-dialogue"><span className="dialogue-marker">•</span>{item.text}</p>
                  if (item.type==='question') return <p key={j} className="script-question"><span className="question-marker">?</span>{item.text}</p>
                  return <p key={j} className="script-paragraph">{item.text}</p>
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
