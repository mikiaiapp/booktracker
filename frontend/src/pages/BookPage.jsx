import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  BookOpen, User, List, Brain, Map, Mic, Star, ExternalLink,
  Play, Pause, Square, ChevronDown, ChevronUp, Loader, CheckCircle,
  ArrowLeft, Edit3, Trash2, AlertCircle, Volume2, VolumeX, PlayCircle, FileText
} from 'lucide-react'
import { booksAPI, analysisAPI, chapterAPI, uploadToShell, reanalyzeCharacters } from '../utils/api'
import MindMap from '../components/MindMap'
import './BookPage.css'

const TABS = [
  { id: 'info', label: 'Ficha', icon: BookOpen },
  { id: 'chapters', label: 'Capítulos', icon: List },
  { id: 'characters', label: 'Personajes', icon: User },
  { id: 'summary', label: 'Resumen global', icon: Brain },
  { id: 'mindmap', label: 'Mapa mental', icon: Map },
  { id: 'podcast', label: 'Podcast', icon: Mic },
  { id: 'refs', label: 'Referencias', icon: ExternalLink },
]

const PROCESSING_STATUSES = ['identifying', 'analyzing_structure', 'summarizing', 'generating_podcast']

export default function BookPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [prevData, setPrevData] = useState(null)  // mantiene datos previos durante reload
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  // TTS state
  const [ttsPlaying, setTtsPlaying] = useState(false)
  const [ttsChapter, setTtsChapter] = useState(null)
  const [ttsQueue, setTtsQueue] = useState([]) // [{id, title, text}]
  const [ttsIndex, setTtsIndex] = useState(0)
  const ttsQueueRef = React.useRef([])
  const ttsIndexRef = React.useRef(0)
  const storageKey = `tts_pos_${id}`

  // TTS state for characters
  const [ttsCharPlaying, setTtsCharPlaying] = useState(false)
  const [ttsCharacter, setTtsCharacter] = useState(null)
  const [ttsCharQueue, setTtsCharQueue] = useState([])
  const [ttsCharIndex, setTtsCharIndex] = useState(0)
  const ttsCharQueueRef = React.useRef([])
  const ttsCharIndexRef = React.useRef(0)
  const charStorageKey = `tts_char_pos_${id}`

  // TTS state for InfoTab (Ficha)
  const [ttsInfoPlaying, setTtsInfoPlaying] = useState(false)
  const infoStorageKey = `tts_info_pos_${id}`

  // Guardar posición en localStorage
  const saveTTSPos = (idx, queue) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ idx, chapterId: queue[idx]?.id }))
    } catch {}
  }

  const loadTTSPos = () => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  }

  const pauseTTS = () => {
    // Cancel current speech but keep position saved in localStorage
    window.speechSynthesis.cancel()
    setTtsPlaying(false)
    // ttsChapter stays set so UI shows "Continuar"
  }

  const resumeCurrentTTS = () => {
    // Resume from saved position in queue
    if (ttsQueueRef.current.length && ttsIndexRef.current >= 0) {
      setTtsPlaying(true)
      speakItem(ttsQueueRef.current, ttsIndexRef.current)
    }
  }

  const stopTTS = (skipConfirm = false) => {
    if (!skipConfirm && (ttsPlaying || ttsChapter)) {
      if (!window.confirm('¿Seguro que quieres parar la reproducción? Se perderá el punto de avance guardado.')) return
    }
    window.speechSynthesis.cancel()
    setTtsPlaying(false)
    setTtsChapter(null)
    localStorage.removeItem(storageKey)
  }

  const speakItem = (queue, idx) => {
    if (idx >= queue.length) {
      setTtsPlaying(false)
      setTtsChapter(null)
      localStorage.removeItem(storageKey)
      return
    }
    const item = queue[idx]
    ttsIndexRef.current = idx
    ttsQueueRef.current = queue
    saveTTSPos(idx, queue)
    setTtsIndex(idx)
    setTtsChapter(item.id)

    const utterance = new SpeechSynthesisUtterance(item.text)
    utterance.lang = 'es-ES'
    utterance.rate = 0.95
    utterance.onend = () => speakItem(ttsQueueRef.current, ttsIndexRef.current + 1)
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') speakItem(ttsQueueRef.current, ttsIndexRef.current + 1)
    }
    window.speechSynthesis.speak(utterance)
  }

  const chapterToText = (c) => {
    let text = `${c.title}. ${c.summary || ''}`
    if (c.key_events?.length > 0) {
      text += '. Eventos clave: ' + c.key_events.join('. ')
    }
    return text
  }

  const buildQueue = (book, chapters, fromIdx = 0) => {
    const queue = []
    if (fromIdx === 0 && book.synopsis) {
      queue.push({ id: 'synopsis', title: 'Sinopsis', text: book.synopsis })
    }
    chapters
      .filter(c => c.summary && c.summary_status === 'done')
      .slice(fromIdx === 0 ? 0 : undefined)
      .forEach(c => queue.push({ id: c.id, title: c.title, text: chapterToText(c) }))
    return queue
  }

  const playFromBeginning = (book, chapters) => {
    stopTTS()
    const queue = buildQueue(book, chapters)
    if (!queue.length) return
    ttsQueueRef.current = queue
    ttsIndexRef.current = 0
    setTtsQueue(queue)
    setTtsIndex(0)
    setTtsPlaying(true)
    speakItem(queue, 0)
  }

  const playFromChapter = (chapter, chapters) => {
    stopTTS()
    const doneChapters = chapters.filter(c => c.summary && c.summary_status === 'done')
    const idx = doneChapters.findIndex(c => c.id === chapter.id)
    const queue = doneChapters
      .slice(idx < 0 ? 0 : idx)
      .map(c => ({ id: c.id, title: c.title, text: chapterToText(c) }))
    if (!queue.length) return
    ttsQueueRef.current = queue
    ttsIndexRef.current = 0
    setTtsQueue(queue)
    setTtsIndex(0)
    setTtsPlaying(true)
    speakItem(queue, 0)
  }

  const resumeTTS = (book, chapters) => {
    const saved = loadTTSPos()
    if (!saved) { playFromBeginning(book, chapters); return }
    stopTTS()
    const queue = buildQueue(book, chapters)
    const idx = saved.chapterId
      ? Math.max(0, queue.findIndex(q => q.id === saved.chapterId))
      : saved.idx || 0
    ttsQueueRef.current = queue
    ttsIndexRef.current = idx
    setTtsQueue(queue)
    setTtsIndex(idx)
    setTtsPlaying(true)
    speakItem(queue, idx)
  }

  const hasSavedPos = () => {
    try { return !!localStorage.getItem(storageKey) } catch { return false }
  }

  // ── TTS for Characters ──────────────────────────────────────────────────────────
  const characterToText = (char) => {
    let text = `Personaje: ${char.name}.`
    if (char.role) text += ` Rol: ${char.role}.`
    if (char.description) text += ` ${char.description}.`
    if (char.personality) text += ` Personalidad: ${char.personality}.`
    if (char.arc) text += ` Evolución: ${char.arc}.`
    if (char.relationships && Object.keys(char.relationships).length > 0) {
      text += ` Relaciones: ${Object.entries(char.relationships).map(([n, r]) => `${n}, ${r}`).join('. ')}.`
    }
    if (char.key_moments?.length > 0) {
      text += ` Momentos clave: ${char.key_moments.join('. ')}.`
    }
    return text
  }

  const saveCharTTSPos = (idx, queue) => {
    try {
      localStorage.setItem(charStorageKey, JSON.stringify({ idx, charName: queue[idx]?.name }))
    } catch {}
  }

  const loadCharTTSPos = () => {
    try {
      const saved = localStorage.getItem(charStorageKey)
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  }

  const pauseCharTTS = () => {
    window.speechSynthesis.cancel()
    setTtsCharPlaying(false)
  }

  const stopCharTTS = (skipConfirm = false) => {
    if (!skipConfirm && (ttsCharPlaying || ttsCharacter)) {
      if (!window.confirm('¿Seguro que quieres parar la reproducción? Se perderá el punto de avance guardado.')) return
    }
    window.speechSynthesis.cancel()
    setTtsCharPlaying(false)
    setTtsCharacter(null)
    localStorage.removeItem(charStorageKey)
  }

  const speakCharItem = (queue, idx) => {
    if (idx >= queue.length) {
      setTtsCharPlaying(false)
      setTtsCharacter(null)
      localStorage.removeItem(charStorageKey)
      return
    }
    const item = queue[idx]
    ttsCharIndexRef.current = idx
    ttsCharQueueRef.current = queue
    saveCharTTSPos(idx, queue)
    setTtsCharIndex(idx)
    setTtsCharacter(item.name)

    const utterance = new SpeechSynthesisUtterance(item.text)
    utterance.lang = 'es-ES'
    utterance.rate = 0.95
    utterance.onend = () => speakCharItem(ttsCharQueueRef.current, ttsCharIndexRef.current + 1)
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') speakCharItem(ttsCharQueueRef.current, ttsCharIndexRef.current + 1)
    }
    window.speechSynthesis.speak(utterance)
  }

  const playCharacter = (char) => {
    stopCharTTS()
    stopTTS()
    const queue = [{ name: char.name, text: characterToText(char) }]
    ttsCharQueueRef.current = queue
    ttsCharIndexRef.current = 0
    setTtsCharQueue(queue)
    setTtsCharIndex(0)
    setTtsCharPlaying(true)
    speakCharItem(queue, 0)
  }

  const playFromCharacter = (char, characters) => {
    stopCharTTS()
    stopTTS()
    const idx = characters.findIndex(c => c.name === char.name)
    const queue = characters
      .slice(idx < 0 ? 0 : idx)
      .map(c => ({ name: c.name, text: characterToText(c) }))
    if (!queue.length) return
    ttsCharQueueRef.current = queue
    ttsCharIndexRef.current = 0
    setTtsCharQueue(queue)
    setTtsCharIndex(0)
    setTtsCharPlaying(true)
    speakCharItem(queue, 0)
  }

  // ── TTS for InfoTab (Ficha) ───────────────────────────────────────────────────
  const playInfo = (book) => {
    // Detener otros TTS
    stopTTS(true)
    stopCharTTS(true)
    window.speechSynthesis.cancel()

    let text = ''
    if (book.synopsis) {
      text += `Sinopsis. ${book.synopsis}. `
    }
    if (book.author_bio) {
      text += `Sobre el autor. ${book.author_bio}.`
    }

    if (!text) {
      toast('No hay contenido para reproducir', { icon: 'ℹ️' })
      return
    }

    setTtsInfoPlaying(true)
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'es-ES'
    utterance.rate = 0.95
    utterance.onend = () => {
      setTtsInfoPlaying(false)
      localStorage.removeItem(infoStorageKey)
    }
    utterance.onerror = () => {
      setTtsInfoPlaying(false)
    }
    window.speechSynthesis.speak(utterance)
    localStorage.setItem(infoStorageKey, 'playing')
  }

  const pauseInfoTTS = () => {
    window.speechSynthesis.cancel()
    setTtsInfoPlaying(false)
  }

  const stopInfoTTS = (skipConfirm = false) => {
    if (!skipConfirm && ttsInfoPlaying) {
      if (!window.confirm('¿Seguro que quieres parar la reproducción?')) return
    }
    window.speechSynthesis.cancel()
    setTtsInfoPlaying(false)
    localStorage.removeItem(infoStorageKey)
  }

  // Limpiar TTS al desmontar
  React.useEffect(() => { return () => window.speechSynthesis.cancel() }, [])
  const [tab, setTab] = useState('info')
  const [expandedChapter, setExpandedChapter] = useState(null)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [audioEl, setAudioEl] = useState(null)
  const [rating, setRating] = useState(0)

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

  // Poll while processing
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
    } catch {
      toast.error('Error al cancelar')
    }
  }

  const triggerPhase = async (phase) => {
    try {
      if (phase === 1) await analysisAPI.triggerPhase1(id)
      if (phase === 2) await analysisAPI.triggerPhase2(id)
      if (phase === 3) await analysisAPI.triggerPhase3(id)
      if (phase === 'podcast') await analysisAPI.triggerPodcast(id)
      toast.success('Proceso iniciado')
      load()
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

  const [audioUrl, setAudioUrl] = useState(null)

  const loadAudio = async () => {
    try {
      const token = localStorage.getItem('bt_token')
      const resp = await fetch(analysisAPI.podcastAudioUrl(id), {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!resp.ok) throw new Error('Audio not found')
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      setAudioUrl(url)
      return url
    } catch (err) {
      toast.error('Error al cargar el audio')
      return null
    }
  }

  const toggleAudio = async () => {
    if (!audioEl) {
      const url = audioUrl || await loadAudio()
      if (!url) return
      const el = new Audio(url)
      el.onended = () => setAudioPlaying(false)
      setAudioEl(el)
      el.play()
      setAudioPlaying(true)
    } else {
      if (audioPlaying) { audioEl.pause(); setAudioPlaying(false) }
      else { audioEl.play(); setAudioPlaying(true) }
    }
  }

  // ── Export to PDF ──────────────────────────────────────────────────────────────
  const exportToPDF = async () => {
    if (!book) return
    
    toast('Generando PDF...', { icon: '📄', duration: 3000 })
    
    try {
      // Cargar jsPDF dinámicamente desde CDN
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
      document.head.appendChild(script)
      
      await new Promise((resolve, reject) => {
        script.onload = resolve
        script.onerror = reject
      })
      
      const { jsPDF } = window.jspdf
      const doc = new jsPDF()
      let y = 20
      const pageHeight = doc.internal.pageSize.height
      const margin = 20
      const maxWidth = 170
      
      // Helper para añadir nueva página si es necesario
      const checkPage = (needed = 20) => {
        if (y + needed > pageHeight - 20) {
          doc.addPage()
          y = 20
        }
      }
      
      // Helper para texto con wrap
      const addText = (text, size = 10, weight = 'normal') => {
        doc.setFontSize(size)
        doc.setFont('helvetica', weight)
        const lines = doc.splitTextToSize(text || '', maxWidth)
        lines.forEach(line => {
          checkPage()
          doc.text(line, margin, y)
          y += size * 0.4
        })
        y += 3
      }
      
      // Portada
      doc.setFillColor(13, 13, 13)
      doc.rect(0, 0, 210, 297, 'F')
      doc.setTextColor(201, 169, 110)
      doc.setFontSize(28)
      doc.setFont('helvetica', 'bold')
      const titleLines = doc.splitTextToSize(book.title, 170)
      titleLines.forEach((line, i) => {
        doc.text(line, 105, 100 + (i * 12), { align: 'center' })
      })
      
      if (book.author) {
        doc.setFontSize(16)
        doc.setFont('helvetica', 'normal')
        doc.text(book.author, 105, 130, { align: 'center' })
      }
      
      doc.setFontSize(10)
      doc.text('Análisis generado por BookTracker', 105, 280, { align: 'center' })
      doc.text(new Date().toLocaleDateString('es-ES'), 105, 286, { align: 'center' })
      
      // Nueva página - Información general
      doc.addPage()
      doc.setTextColor(0, 0, 0)
      y = 20
      
      doc.setFontSize(18)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(201, 169, 110)
      doc.text('Información General', margin, y)
      y += 12
      doc.setTextColor(0, 0, 0)
      
      if (book.isbn) addText(`ISBN: ${book.isbn}`, 11, 'bold')
      if (book.year) addText(`Año: ${book.year}`, 11, 'bold')
      if (book.genre) addText(`Género: ${book.genre}`, 11, 'bold')
      if (book.pages) addText(`Páginas: ${book.pages}`, 11, 'bold')
      if (book.language) addText(`Idioma: ${book.language}`, 11, 'bold')
      
      y += 5
      
      // Sinopsis
      if (book.synopsis) {
        checkPage(30)
        doc.setFontSize(16)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(201, 169, 110)
        doc.text('Sinopsis', margin, y)
        y += 10
        doc.setTextColor(0, 0, 0)
        addText(book.synopsis, 10)
      }
      
      // Sobre el autor
      if (book.author_bio) {
        checkPage(30)
        doc.setFontSize(16)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(201, 169, 110)
        doc.text('Sobre el autor', margin, y)
        y += 10
        doc.setTextColor(0, 0, 0)
        addText(book.author_bio, 10)
      }
      
      // Bibliografía del autor
      if (book.author_bibliography?.length > 0) {
        checkPage(30)
        doc.setFontSize(16)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(201, 169, 110)
        doc.text('Otras obras del autor', margin, y)
        y += 10
        doc.setTextColor(0, 0, 0)
        
        book.author_bibliography.slice(0, 15).forEach((item) => {
          const title = typeof item === 'string' ? item : item.title
          const year = typeof item === 'object' ? item.year : null
          const text = year ? `• ${title} (${year})` : `• ${title}`
          addText(text, 9)
        })
      }
      
      // Resumen global
      if (book.global_summary) {
        checkPage(30)
        doc.setFontSize(16)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(201, 169, 110)
        doc.text('Resumen Global', margin, y)
        y += 10
        doc.setTextColor(0, 0, 0)
        addText(book.global_summary, 10)
      }
      
      // Capítulos
      if (chapters.length > 0) {
        doc.addPage()
        y = 20
        doc.setFontSize(18)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(201, 169, 110)
        doc.text('Capítulos', margin, y)
        y += 12
        doc.setTextColor(0, 0, 0)
        
        chapters.forEach((ch, i) => {
          checkPage(25)
          doc.setFontSize(12)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(201, 169, 110)
          doc.text(`${i + 1}. ${ch.title}`, margin, y)
          y += 7
          doc.setTextColor(0, 0, 0)
          
          if (ch.summary) {
            addText(ch.summary, 9)
          }
          
          if (ch.key_events?.length > 0) {
            doc.setFont('helvetica', 'italic')
            addText('Eventos clave: ' + ch.key_events.join(', '), 8)
          }
          
          y += 3
        })
      }
      
      // Personajes
      if (characters.length > 0) {
        doc.addPage()
        y = 20
        doc.setFontSize(18)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(201, 169, 110)
        doc.text('Personajes', margin, y)
        y += 12
        doc.setTextColor(0, 0, 0)
        
        characters.forEach((char) => {
          checkPage(30)
          doc.setFontSize(14)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(201, 169, 110)
          doc.text(char.name, margin, y)
          y += 7
          doc.setTextColor(0, 0, 0)
          
          if (char.role) {
            doc.setFontSize(9)
            doc.setFont('helvetica', 'italic')
            doc.text(`Rol: ${char.role}`, margin, y)
            y += 5
          }
          
          if (char.description) addText(char.description, 9)
          if (char.personality) {
            doc.setFont('helvetica', 'bold')
            addText('Personalidad:', 9, 'bold')
            doc.setFont('helvetica', 'normal')
            addText(char.personality, 9)
          }
          if (char.arc) {
            doc.setFont('helvetica', 'bold')
            addText('Evolución:', 9, 'bold')
            doc.setFont('helvetica', 'normal')
            addText(char.arc, 9)
          }
          
          if (char.relationships && Object.keys(char.relationships).length > 0) {
            doc.setFont('helvetica', 'bold')
            addText('Relaciones:', 9, 'bold')
            doc.setFont('helvetica', 'normal')
            Object.entries(char.relationships).forEach(([name, rel]) => {
              addText(`• ${name}: ${rel}`, 8)
            })
          }
          
          if (char.key_moments?.length > 0) {
            doc.setFont('helvetica', 'bold')
            addText('Momentos clave:', 9, 'bold')
            doc.setFont('helvetica', 'italic')
            char.key_moments.forEach(moment => {
              addText(`"${moment}"`, 8)
            })
          }
          
          y += 5
        })
      }
      
      // Guardar PDF
      const filename = `${book.title.replace(/[^a-z0-9]/gi, '_')}_analisis.pdf`
      doc.save(filename)
      
      toast.success('PDF generado correctamente')
    } catch (error) {
      console.error('Error generating PDF:', error)
      toast.error('Error al generar el PDF')
    }
  }

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar "${data?.book?.title}"?`)) return
    await booksAPI.delete(id)
    navigate('/')
  }

  if (loading) return (
    <div className="book-loading">
      <Loader size={28} className="spin" strokeWidth={1.5} />
    </div>
  )

  // Usar datos previos como fallback durante recargas (evita pantalla en blanco)
  const activeData = data || prevData
  const book = activeData?.book || {}
  if (!loading && !activeData) return (
    <div className="book-loading" style={{flexDirection:"column",gap:"1rem"}}>
      <p style={{color:"var(--slate)"}}>No se pudo cargar el libro</p>
      <button onClick={() => navigate("/")} style={{background:"var(--ink)",color:"var(--paper)",border:"none",padding:"0.5rem 1rem",borderRadius:"4px",cursor:"pointer"}}>
        Volver a la biblioteca
      </button>
    </div>
  )
  const chapters = activeData?.chapters || []
  const characters = activeData?.characters || []
  const isProcessing = PROCESSING_STATUSES.includes(status?.status)
  const isShell = book?.status === 'shell' || book?.status === 'shell_error'

  return (
    <div className="book-page">
      {/* Header */}
      <div className="book-hero">
        <button className="back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Biblioteca
        </button>

        <div className="hero-content">
          <div className="hero-cover">
            {book.cover_local ? (
              <img src={book.cover_local?.includes('/covers/') ? `/data/covers/${book.cover_local.split('/covers/')[1]}` : book.cover_local} alt={book.title} />
            ) : (
              <div className="cover-ph-lg">
                <BookOpen size={48} strokeWidth={1} />
              </div>
            )}
          </div>

          <div className="hero-info">
            <h1>{book.title}</h1>
            {book.author && (
              <p className="hero-author">
                <Link to="/authors" state={{author: book.author}} className="author-link">{book.author}</Link>
              </p>
            )}

            {/* Controles TTS globales */}
            {(ttsPlaying || ttsChapter || ttsInfoPlaying || ttsCharPlaying) && (
              <div className="hero-tts-global">
                {ttsPlaying || ttsInfoPlaying || ttsCharPlaying ? (
                  <>
                    <button className="hero-tts-btn" onClick={() => {
                      if (ttsPlaying) pauseTTS()
                      else if (ttsInfoPlaying) pauseInfoTTS()
                      else if (ttsCharPlaying) pauseCharTTS()
                    }}>
                      <Pause size={14} /> Pausar reproducción
                    </button>
                    <button className="hero-tts-btn hero-tts-stop" onClick={() => {
                      if (ttsPlaying) stopTTS()
                      else if (ttsInfoPlaying) stopInfoTTS()
                      else if (ttsCharPlaying) stopCharTTS()
                    }}>
                      <Square size={14} /> Stop
                    </button>
                  </>
                ) : (
                  <>
                    <button className="hero-tts-btn" onClick={() => {
                      if (ttsChapter) resumeCurrentTTS()
                      // Aquí se podría añadir lógica para resumir otros tipos
                    }}>
                      <Play size={14} /> Continuar reproducción
                    </button>
                    <button className="hero-tts-btn hero-tts-stop" onClick={() => {
                      stopTTS()
                      stopInfoTTS(true)
                      stopCharTTS(true)
                    }}>
                      <Square size={14} /> Stop
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="hero-meta">
              {book.year && <span>{book.year}</span>}
              {book.pages && <span>{book.pages} páginas</span>}
              {book.isbn && <span>ISBN: {book.isbn}</span>}
              {book.genre && <span>{book.genre}</span>}
            </div>

            {/* Star rating */}
            <div className="star-rating">
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => handleRating(n)}
                  className={`star ${rating >= n ? 'filled' : ''}`}>
                  <Star size={20} fill={rating >= n ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>

            {/* Read status */}
            <div className="read-status-btns">
              {[
                { v: 'to_read', l: 'Por leer' },
                { v: 'reading', l: 'Leyendo' },
                { v: 'read', l: 'Leído ✓' },
              ].map(s => (
                <button key={s.v}
                  className={`rs-btn ${book.read_status === s.v ? 'active' : ''}`}
                  onClick={() => handleReadStatus(s.v)}>
                  {s.l}
                </button>
              ))}
            </div>

            {/* Export PDF button */}
            {status?.phase3_done && (
              <button className="export-pdf-btn" onClick={exportToPDF} title="Exportar análisis completo">
                <FileText size={16} />
                Exportar a PDF
              </button>
            )}

            {/* Status pipeline */}
            {!isShell && <ProcessingPipeline status={status} isProcessing={isProcessing} onTrigger={triggerPhase} onCancel={cancelProcess} book={book} />}
            {isShell && (
              <div className="shell-upload-area">
                <span className="shell-label">Solo ficha — sube el PDF/EPUB para analizar</span>
                <label className="shell-upload-btn">
                  <input
                    type="file"
                    accept=".pdf,.epub"
                    style={{display:'none'}}
                    onChange={async (e) => {
                      const file = e.target.files[0]
                      if (!file) return
                      try {
                        toast('Subiendo archivo…', {icon: '⏳'})
                        await uploadToShell(id, file)
                        toast.success('Archivo subido. Identificando…')
                        load()
                      } catch {
                        toast.error('Error al subir el archivo')
                      }
                    }}
                  />
                  📎 Subir PDF/EPUB
                </label>
              </div>
            )}
          </div>

          <button className="delete-btn" onClick={handleDelete} title="Eliminar libro">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="book-tabs">
        {/* Barra desktop */}
        <div className="tabs-bar tabs-bar-desktop">
          {TABS.map(t => (
            <button key={t.id}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              disabled={
                (isShell && t.id !== 'info') ||
                (t.id === 'chapters' && !status?.phase2_done) ||
                (t.id === 'characters' && !status?.phase3_done) ||
                (t.id === 'summary' && !status?.phase3_done) ||
                (t.id === 'mindmap' && !status?.phase3_done) ||
                (t.id === 'podcast' && !book.podcast_audio_path)
              }
            >
              <t.icon size={15} strokeWidth={1.5} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Select móvil */}
        <div className="tabs-select-wrapper tabs-select-mobile">
          <select 
            className="tabs-select" 
            value={tab} 
            onChange={(e) => setTab(e.target.value)}
          >
            {TABS.map(t => {
              const disabled = 
                (isShell && t.id !== 'info') ||
                (t.id === 'chapters' && !status?.phase2_done) ||
                (t.id === 'characters' && !status?.phase3_done) ||
                (t.id === 'summary' && !status?.phase3_done) ||
                (t.id === 'mindmap' && !status?.phase3_done) ||
                (t.id === 'podcast' && !book.podcast_audio_path)
              
              const icon = {
                info: '📖',
                chapters: '📑',
                characters: '👤',
                summary: '🧠',
                mindmap: '🗺️',
                podcast: '🎙️',
                refs: '🔗'
              }[t.id] || '•'
              
              return (
                <option key={t.id} value={t.id} disabled={disabled}>
                  {icon} {t.label}
                </option>
              )
            })}
          </select>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab} className="tab-content"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

            {tab === 'info' && <InfoTab book={book} otherBooks={activeData?.other_books || []} ttsPlaying={ttsInfoPlaying} onPlay={playInfo} onPause={pauseInfoTTS} onStop={stopInfoTTS} />}

            {tab === 'chapters' && (
              <ChaptersTab chapters={chapters} expanded={expandedChapter} setExpanded={setExpandedChapter} bookId={id} onChapterSummarized={load} ttsPlaying={ttsPlaying} ttsChapter={ttsChapter} ttsQueue={ttsQueue} onPlayChapter={(ch) => playTTS(chapterToText(ch), ch.id)} onPlayFromChapter={(ch) => playFromChapter(ch, chapters)} onStop={stopTTS} onPause={pauseTTS} />
            )}

            {tab === 'characters' && <CharactersTab characters={characters} bookId={id} onReanalyzed={load} status={status} ttsPlaying={ttsCharPlaying} ttsCharacter={ttsCharacter} onPlayCharacter={playCharacter} onPlayFromCharacter={playFromCharacter} onStop={stopCharTTS} onPause={pauseCharTTS} />}

            {tab === 'summary' && (
              <div className="prose-content">
                <h2>Resumen global</h2>
                <p>{book.global_summary || 'No disponible'}</p>
              </div>
            )}

            {tab === 'mindmap' && (
              book.mindmap_data
                ? <MindMap data={book.mindmap_data} />
                : <p className="empty-tab">Mapa mental no disponible</p>
            )}

            {tab === 'refs' && <RefsTab book={book} />}
            {tab === 'podcast' && (
              <PodcastTab
                book={book}
                playing={audioPlaying}
                onToggle={toggleAudio}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ProcessingPipeline({ status, isProcessing, onTrigger, book = {} }) {
  if (!status) return null
  const steps = [
    { label: 'Fase 1: Identificación', sublabel: 'Ficha, sinopsis, autor', done: status.phase1_done, trigger: () => onTrigger(1), canTrigger: true },
    { label: 'Fase 2: Estructura', sublabel: 'Capítulos', done: status.phase2_done, trigger: () => onTrigger(2), canTrigger: status.phase1_done },
    { label: 'Fase 3a: Resúmenes', sublabel: 'Resumen de cada capítulo', done: status.chapters_summarized || status.phase3_done, trigger: () => onTrigger(3), canTrigger: status.phase2_done, resumable: status.phase2_done && !status.phase3_done && status.chapters_done > 0 },
    { label: 'Fase 3b: Análisis IA', sublabel: 'Personajes, resumen global, mapa mental', done: status.phase3_done, trigger: () => onTrigger(3), canTrigger: status.chapters_summarized || status.phase3_done },
    { label: 'Podcast', sublabel: 'Guión y audio', done: status.podcast_done, trigger: () => onTrigger('podcast'), canTrigger: status.phase3_done },
  ]

  return (
    <div className="pipeline">
      {steps.map((s, i) => (
        <div key={i} className={`pipeline-step ${s.done ? 'done' : ''}`}>
          {s.done
            ? <CheckCircle size={14} />
            : isProcessing && !s.done && i === steps.findIndex(x => !x.done)
              ? <Loader size={14} className="spin" />
              : <div className="step-dot" />
          }
          <span>{s.label}{s.sublabel && <span className="step-sublabel"> ({s.sublabel})</span>}</span>
          {s.canTrigger && !isProcessing && (
            <button className="trigger-btn" onClick={s.trigger}>
              {s.done ? 'Repetir' : s.resumable ? 'Reanudar' : 'Iniciar'}
            </button>
          )}
          {isProcessing && i === steps.findIndex(x => !x.done) && (
            <button className="cancel-btn" onClick={onCancel} title="Cancelar proceso">
              Cancelar
            </button>
          )}
        </div>
      ))}
      {status.error_msg && (
        <div className={`pipeline-error ${status.error_msg.includes('Cuota') || status.error_msg.includes('quota') ? 'quota-error' : ''}`}>
          <AlertCircle size={14} />
          <span>{status.error_msg.includes('Cuota') || status.status === 'quota_exceeded'
            ? status.error_msg
            : 'Error en el proceso'}</span>
        </div>
      )}
    </div>
  )
}

function InfoTab({ book, otherBooks = [], ttsPlaying, onPlay, onPause, onStop }) {
  return (
    <div className="info-tab">
      {/* Controles TTS */}
      {(book.synopsis || book.author_bio) && (
        <div className="info-tts-controls">
          {!ttsPlaying ? (
            <button className="info-tts-play-btn" onClick={() => onPlay(book)}>
              <Play size={16} />
              Reproducir ficha
            </button>
          ) : (
            <div className="info-tts-active">
              <button className="tts-control-btn pause" onClick={onPause} title="Pausar">
                <Pause size={16} />
              </button>
              <button className="tts-control-btn stop" onClick={onStop} title="Detener">
                <Square size={16} />
              </button>
              <span className="tts-indicator">
                <Volume2 size={14} className="pulse" />
                Reproduciendo
              </span>
            </div>
          )}
        </div>
      )}

      {book.synopsis && (
        <section>
          <h3>Sinopsis</h3>
          <p>{book.synopsis}</p>
        </section>
      )}
      {book.author_bio && (
        <section>
          <h3>Sobre el autor</h3>
          <p>{book.author_bio}</p>
        </section>
      )}
      {otherBooks.length > 0 && (
        <section>
          <h3>Otras obras del autor</h3>
          <div className="refs-grid">
            {otherBooks.map(ob => {
              const isAnalyzed = ob.status === 'complete' || ob.phase3_done
              const isShell = ob.status === 'shell' || ob.status === 'shell_error'
              return (
                <Link key={ob.id} to={`/book/${ob.id}`} className="ref-item" style={{ textDecoration: 'none' }}>
                  {ob.cover_local ? (
                    <div className="ref-cover">
                      <img src={`/data/covers/${ob.cover_local.split('/covers/')[1]}`} alt={ob.title} />
                    </div>
                  ) : (
                    <div className="ref-cover">
                      <div style={{ width: '60px', height: '85px', background: '#f0f0f0', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <BookOpen size={24} strokeWidth={1} color="#999" />
                      </div>
                    </div>
                  )}
                  <div className="ref-info">
                    <h4 className="ref-title">{ob.title}</h4>
                    {ob.year && <span className="ref-year">{ob.year}</span>}
                    {isAnalyzed && <span className="ref-badge" style={{ fontSize: '0.75rem', color: 'var(--gold)', fontWeight: '500' }}>✦ Analizado</span>}
                    {isShell && <span className="ref-badge" style={{ fontSize: '0.75rem', color: 'var(--mist)' }}>Solo ficha</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}
      {!book.synopsis && !book.author_bio && (
        <p className="empty-tab">La información del libro aún se está cargando…</p>
      )}
    </div>
  )
}

function ChaptersTab({ chapters, expanded, setExpanded, bookId, onChapterSummarized, ttsPlaying, ttsChapter, ttsQueue, onPlayChapter, onPlayFromChapter, onStop, onPause }) {
  const [summarizing, setSummarizing] = React.useState({})

  const handleSummarize = async (e, chapter) => {
    e.stopPropagation()
    setSummarizing(s => ({ ...s, [chapter.id]: true }))
    try {
      await chapterAPI.summarize(bookId, chapter.id)
      toast('Resumiendo capítulo...', { icon: '⏳' })
      // Poll hasta que termine
      const poll = setInterval(async () => {
        const { data } = await import('../utils/api').then(m => m.booksAPI.get(bookId))
        const ch = data.chapters?.find(c => c.id === chapter.id)
        if (ch?.summary_status === 'done') {
          clearInterval(poll)
          setSummarizing(s => ({ ...s, [chapter.id]: false }))
          onChapterSummarized?.()
          toast.success('Capítulo resumido')
        }
      }, 3000)
      setTimeout(() => clearInterval(poll), 120000)
    } catch {
      setSummarizing(s => ({ ...s, [chapter.id]: false }))
      toast.error('Error al resumir el capítulo')
    }
  }

  if (!chapters.length) return <p className="empty-tab">No se encontraron capítulos</p>
  return (
    <div className="chapters-list">
      {chapters.map((ch, i) => (
        <div key={ch.id} className={`chapter-item ${expanded === ch.id ? 'open' : ''}`}>
          <button className="chapter-header" onClick={() => setExpanded(expanded === ch.id ? null : ch.id)}>
            <span className="ch-num">{String(i + 1).padStart(2, '0')}</span>
            <span className="ch-title">{ch.title}</span>
            <div className="ch-meta">
              {ch.summary_status === 'done'
                ? <span className="badge badge-green">Resumido</span>
                : ch.summary_status === 'quota_exceeded'
                  ? <span className="badge badge-rust" title={ch.summary || 'Cuota agotada'}>⏰ Cuota agotada</span>
                : ch.summary_status === 'skipped'
                  ? <span className="badge badge-slate" title="Contenido bloqueado por filtros de seguridad">⚠ Omitido</span>
                : ch.summary_status === 'processing'
                  ? <span className="badge badge-gold">Procesando…</span>
                  : <button
                      className="summarize-ch-btn"
                      onClick={(e) => handleSummarize(e, ch)}
                      disabled={summarizing[ch.id]}
                    >
                      {summarizing[ch.id] ? '…' : '+ Resumir'}
                    </button>
              }
              {ch.summary_status === 'done' && (
                <div className="ch-tts-btns" onClick={e => e.stopPropagation()}>
                  {/* Play individual */}
                  <button
                    className={`ch-tts-btn ${ttsPlaying && ttsChapter === ch.id ? 'pause' : 'play'}`}
                    onClick={() => ttsPlaying && ttsChapter === ch.id ? onPause() : onPlayChapter(ch)}
                    title={ttsPlaying && ttsChapter === ch.id ? 'Pausar' : 'Reproducir'}
                  >
                    {ttsPlaying && ttsChapter === ch.id
                      ? <Pause size={12} />
                      : <Play size={12} />
                    }
                  </button>
                  {/* Leer desde aquí en adelante */}
                  <button className="ch-tts-btn play-from" onClick={() => onPlayFromChapter(ch)} title="Leer desde aquí hasta el final">
                    <Volume2 size={12} />
                  </button>
                </div>
              )}
              {ch.page_start && <span className="ch-pages">p. {ch.page_start}–{ch.page_end}</span>}
              {expanded === ch.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </button>
          <AnimatePresence>
            {expanded === ch.id && (
              <motion.div className="chapter-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}>
                <div className="chapter-body-inner">
                  {ch.summary
                    ? <p>{ch.summary}</p>
                    : <p className="muted">Resumen no disponible para este capítulo</p>
                  }
                  {ch.key_events?.length > 0 && (
                    <div className="key-events">
                      <strong>Eventos clave:</strong>
                      <ul>{ch.key_events.map((e, i) => <li key={i}>{e}</li>)}</ul>
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

function CharactersTab({ characters, bookId, onReanalyzed, status, ttsPlaying, ttsCharacter, onPlayCharacter, onPlayFromCharacter, onStop, onPause }) {
  const [reanalyzing, setReanalyzing] = React.useState(false)

  const handleReanalyze = async () => {
    setReanalyzing(true)
    try {
      await reanalyzeCharacters(bookId)
      toast('Reanalizando personajes…', { icon: '⏳' })
      setTimeout(async () => {
        await onReanalyzed()
        setReanalyzing(false)
      }, 60000)
    } catch {
      toast.error('Error al reanalizar')
      setReanalyzing(false)
    }
  }

  return (
    <div className="characters-tab">
      <div className="characters-header">
        <div className="characters-info">
          <span className="characters-count">
            {characters.length} personaje{characters.length !== 1 ? 's' : ''}
          </span>
          {ttsPlaying && ttsCharacter && (
            <span className="tts-indicator">
              <Volume2 size={14} className="pulse" />
              Reproduciendo personajes
            </span>
          )}
        </div>
        <div className="characters-actions">
          {ttsPlaying && (
            <>
              <button className="tts-control-btn pause" onClick={onPause} title="Pausar">
                <Pause size={16} />
              </button>
              <button className="tts-control-btn stop" onClick={onStop} title="Detener">
                <Square size={16} />
              </button>
            </>
          )}
          {status?.phase3_done && (
            <button
              className="reanalyze-chars-btn"
              onClick={handleReanalyze}
              disabled={reanalyzing}
            >
              {reanalyzing ? '⏳ Reanalizando…' : '↻ Reanalizar'}
            </button>
          )}
        </div>
      </div>
      {!characters.length
        ? <p className="empty-tab">No se encontraron personajes. Pulsa ↻ Reanalizar para generarlos.</p>
        : <div className="characters-grid">
            {characters.map((char, i) => {
              const isPlaying = ttsPlaying && ttsCharacter === char.name
              return (
                <div key={i} className={`char-card ${isPlaying ? 'char-playing' : ''}`}>
                  <div className="char-avatar">
                    {char.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="char-info">
                    <div className="char-header">
                      <h3 className="char-name">{char.name}</h3>
                      <div className="char-tts-btns">
                        <button
                          className="char-tts-btn"
                          onClick={() => onPlayCharacter(char)}
                          disabled={ttsPlaying}
                          title="Reproducir este personaje"
                        >
                          {isPlaying ? <Volume2 size={14} className="pulse" /> : <Play size={14} />}
                        </button>
                        <button
                          className="char-tts-btn from-here"
                          onClick={() => onPlayFromCharacter(char, characters)}
                          disabled={ttsPlaying}
                          title="Reproducir desde aquí"
                        >
                          <PlayCircle size={14} />
                        </button>
                      </div>
                    </div>
                    {char.role && (
                      <span className={`char-role role-${char.role}`}>{char.role}</span>
                    )}
                    {char.description && <p className="char-desc">{char.description}</p>}
                    {char.personality && (
                      <div className="char-section">
                        <strong>Personalidad</strong>
                        <p>{char.personality}</p>
                      </div>
                    )}
                    {char.arc && (
                      <div className="char-section">
                        <strong>Evolución</strong>
                        <p>{char.arc}</p>
                      </div>
                    )}
                    {char.importance && (
                      <div className="char-section">
                        <strong>Importancia</strong>
                        <p>{char.importance}</p>
                      </div>
                    )}
                    {char.relationships && Object.keys(char.relationships).length > 0 && (
                      <div className="char-section">
                        <strong>Relaciones</strong>
                        <ul className="char-relations">
                          {Object.entries(char.relationships).map(([name, rel], j) => (
                            <li key={j}><em>{name}</em>: {rel}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {char.key_moments?.length > 0 && (
                      <div className="char-section">
                        <strong>Momentos clave</strong>
                        {char.key_moments.map((q, j) => (
                          <blockquote key={j} className="char-quote">{q}</blockquote>
                        ))}
                      </div>
                    )}
                    {char.quotes?.length > 0 && (
                      <div className="char-section">
                        <strong>Citas y momentos memorables</strong>
                        {char.quotes.map((q, j) => (
                          <blockquote key={j} className="char-quote">{q}</blockquote>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
      }
    </div>
  )
}

function RefsTab({ book }) {
  // Generar URLs de referencias externas
  const bookTitle = encodeURIComponent(book.title || '')
  const author = encodeURIComponent(book.author || '')
  const isbn = book.isbn || ''
  
  const refs = {
    // Referencias sobre el libro
    wikipedia: `https://es.wikipedia.org/wiki/${bookTitle}`,
    goodreads: `https://www.goodreads.com/search?q=${bookTitle}`,
    youtube: `https://www.youtube.com/results?search_query=${bookTitle}+${author}`,
    amazon: `https://www.amazon.es/s?k=${bookTitle}+${author}`,
    googleBooks: isbn ? `https://books.google.es/books?isbn=${isbn}` : `https://books.google.es/books?q=${bookTitle}+${author}`,
    library: `https://www.worldcat.org/search?q=${bookTitle}`,
    
    // Referencias sobre el autor
    authorWikipedia: `https://es.wikipedia.org/wiki/${author}`,
    authorGoodreads: `https://www.goodreads.com/search?q=${author}`,
    authorX: `https://twitter.com/search?q=${author}`,
    authorInstagram: `https://www.instagram.com/explore/tags/${author.replace(/\s+/g, '')}/`,
    authorYoutube: `https://www.youtube.com/results?search_query=${author}+entrevista`
  }

  return (
    <div className="refs-tab">
      <h3>Referencias externas</h3>
      <p className="refs-subtitle">Enlaces para ampliar información sobre el libro y su autor</p>
      
      <div className="refs-sections">
        {/* Referencias sobre el libro */}
        <div className="refs-section">
          <h4>
            <BookOpen size={18} />
            Sobre el libro
          </h4>
          <div className="refs-links">
            <a href={refs.wikipedia} target="_blank" rel="noopener noreferrer" className="ref-link">
              <ExternalLink size={16} />
              <span>Wikipedia</span>
            </a>
            <a href={refs.goodreads} target="_blank" rel="noopener noreferrer" className="ref-link">
              <Star size={16} />
              <span>Goodreads</span>
            </a>
            <a href={refs.youtube} target="_blank" rel="noopener noreferrer" className="ref-link">
              <Play size={16} />
              <span>YouTube</span>
            </a>
            <a href={refs.amazon} target="_blank" rel="noopener noreferrer" className="ref-link">
              <ExternalLink size={16} />
              <span>Amazon</span>
            </a>
            <a href={refs.googleBooks} target="_blank" rel="noopener noreferrer" className="ref-link">
              <BookOpen size={16} />
              <span>Google Books</span>
            </a>
            <a href={refs.library} target="_blank" rel="noopener noreferrer" className="ref-link">
              <BookOpen size={16} />
              <span>WorldCat (Bibliotecas)</span>
            </a>
          </div>
        </div>

        {/* Referencias sobre el autor */}
        {book.author && (
          <div className="refs-section">
            <h4>
              <User size={18} />
              Sobre el autor
            </h4>
            <div className="refs-links">
              <a href={refs.authorWikipedia} target="_blank" rel="noopener noreferrer" className="ref-link">
                <ExternalLink size={16} />
                <span>Wikipedia (autor)</span>
              </a>
              <a href={refs.authorGoodreads} target="_blank" rel="noopener noreferrer" className="ref-link">
                <Star size={16} />
                <span>Goodreads (autor)</span>
              </a>
              <a href={refs.authorYoutube} target="_blank" rel="noopener noreferrer" className="ref-link">
                <Play size={16} />
                <span>Entrevistas YouTube</span>
              </a>
              <a href={refs.authorX} target="_blank" rel="noopener noreferrer" className="ref-link">
                <ExternalLink size={16} />
                <span>X / Twitter</span>
              </a>
              <a href={refs.authorInstagram} target="_blank" rel="noopener noreferrer" className="ref-link">
                <ExternalLink size={16} />
                <span>Instagram</span>
              </a>
            </div>
          </div>
        )}
      </div>
      
      <p className="refs-note">
        💡 Estos enlaces se generan automáticamente. Algunos pueden no estar disponibles o requerir búsqueda adicional.
      </p>
    </div>
  )
}

function PodcastTab({ book, playing, onToggle }) {
  const hasScript = book?.podcast_script
  const hasAudio = book?.podcast_audio_path

  if (!hasScript && !hasAudio) {
    return (
      <div className="empty-tab">
        <Mic size={48} strokeWidth={1} />
        <p>El podcast aún no ha sido generado</p>
        <p className="empty-subtitle">Lanza la fase de Podcast desde el Pipeline arriba</p>
      </div>
    )
  }

  // Procesar el guion para detectar secciones y formatear
  const processScript = (script) => {
    const lines = script.split('\n').filter(l => l.trim())
    const sections = []
    let currentSection = null

    lines.forEach(line => {
      const trimmed = line.trim()
      
      // Detectar títulos de sección (en mayúsculas o con marcadores)
      if (
        trimmed === trimmed.toUpperCase() && trimmed.length > 3 ||
        /^(INTRODUCCIÓN|CAPÍTULO|PARTE|PERSONAJES|CONCLUSIÓN|ANÁLISIS)/i.test(trimmed) ||
        /^(#|##|\*\*|__|=)/.test(trimmed)
      ) {
        if (currentSection) sections.push(currentSection)
        currentSection = {
          type: 'section',
          title: trimmed.replace(/^[#*_=]+\s*/, '').replace(/[#*_=]+$/, ''),
          content: []
        }
      }
      // Detectar diálogos (líneas que empiezan con - o •)
      else if (/^[-•]\s/.test(trimmed)) {
        if (!currentSection) {
          currentSection = { type: 'default', content: [] }
        }
        currentSection.content.push({
          type: 'dialogue',
          text: trimmed.substring(2)
        })
      }
      // Detectar preguntas
      else if (trimmed.endsWith('?')) {
        if (!currentSection) {
          currentSection = { type: 'default', content: [] }
        }
        currentSection.content.push({
          type: 'question',
          text: trimmed
        })
      }
      // Párrafo normal
      else if (trimmed) {
        if (!currentSection) {
          currentSection = { type: 'default', content: [] }
        }
        currentSection.content.push({
          type: 'paragraph',
          text: trimmed
        })
      }
    })

    if (currentSection) sections.push(currentSection)
    return sections
  }

  const sections = hasScript ? processScript(book.podcast_script) : []

  return (
    <div className="podcast-tab">
      {hasAudio && (
        <div className="podcast-player">
          <button className="podcast-play-btn" onClick={onToggle}>
            {playing ? <Pause size={24} /> : <Play size={24} />}
            <span>{playing ? 'Pausar podcast' : 'Reproducir podcast'}</span>
          </button>
        </div>
      )}
      
      {hasScript && (
        <div className="podcast-script">
          <h3>
            <Volume2 size={18} />
            Guión del podcast
          </h3>
          <div className="script-content-enhanced">
            {sections.map((section, i) => (
              <div key={i} className={`script-section ${section.type}`}>
                {section.title && (
                  <h4 className="section-title">
                    <span className="section-marker">▸</span>
                    {section.title}
                  </h4>
                )}
                {section.content.map((item, j) => {
                  if (item.type === 'dialogue') {
                    return (
                      <p key={j} className="script-dialogue">
                        <span className="dialogue-marker">•</span>
                        {item.text}
                      </p>
                    )
                  }
                  if (item.type === 'question') {
                    return (
                      <p key={j} className="script-question">
                        <span className="question-marker">?</span>
                        {item.text}
                      </p>
                    )
                  }
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
