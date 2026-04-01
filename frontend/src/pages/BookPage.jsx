import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  BookOpen, User, List, Brain, Map, Mic, Star, ExternalLink,
  Play, Pause, Square, ChevronDown, ChevronUp, Loader, CheckCircle,
  ArrowLeft, Trash2, AlertCircle, Volume2, PlayCircle, FileText,
  Upload
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
  const [prevData, setPrevData] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  // ── TTS state (chapters) ────────────────────────────────────────────────────
  // paused = speech stopped but position saved; playing = actively speaking
  const [ttsState, setTtsState] = useState('idle') // 'idle' | 'playing' | 'paused'
  const [ttsChapter, setTtsChapter] = useState(null)
  const [ttsQueue, setTtsQueue] = useState([])
  const [ttsIndex, setTtsIndex] = useState(0)
  const ttsQueueRef = useRef([])
  const ttsIndexRef = useRef(0)
  const ttsActiveRef = useRef(false) // tracks if we should continue speaking
  const storageKey = `tts_pos_${id}`

  // ── TTS state (characters) ─────────────────────────────────────────────────
  const [ttsCharState, setTtsCharState] = useState('idle') // 'idle' | 'playing' | 'paused'
  const [ttsCharacter, setTtsCharacter] = useState(null)
  const [ttsCharQueue, setTtsCharQueue] = useState([])
  const [ttsCharIndex, setTtsCharIndex] = useState(0)
  const ttsCharQueueRef = useRef([])
  const ttsCharIndexRef = useRef(0)
  const ttsCharActiveRef = useRef(false)
  const charStorageKey = `tts_char_pos_${id}`

  // ── TTS state (info tab) ───────────────────────────────────────────────────
  const [ttsInfoState, setTtsInfoState] = useState('idle') // 'idle' | 'playing' | 'paused'
  const ttsInfoActiveRef = useRef(false)
  const infoStorageKey = `tts_info_pos_${id}`

  // ── TTS state (summary tab) ────────────────────────────────────────────────
  const [ttsSummaryState, setTtsSummaryState] = useState('idle')
  const ttsSummaryActiveRef = useRef(false)

  const stopAllTTS = () => {
    ttsActiveRef.current = false
    ttsCharActiveRef.current = false
    ttsInfoActiveRef.current = false
    ttsSummaryActiveRef.current = false
    window.speechSynthesis.cancel()
  }

  // ── Chapters TTS ───────────────────────────────────────────────────────────
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

  const speakItem = (queue, idx) => {
    if (!ttsActiveRef.current || idx >= queue.length) {
      if (ttsActiveRef.current) {
        // finished naturally
        setTtsState('idle')
        setTtsChapter(null)
        localStorage.removeItem(storageKey)
        ttsActiveRef.current = false
      }
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
    utterance.onend = () => {
      if (ttsActiveRef.current) {
        speakItem(ttsQueueRef.current, ttsIndexRef.current + 1)
      }
    }
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && ttsActiveRef.current) {
        speakItem(ttsQueueRef.current, ttsIndexRef.current + 1)
      }
    }
    window.speechSynthesis.speak(utterance)
  }

  const startChaptersTTS = (queue, idx) => {
    stopAllTTS()
    if (!queue.length) return
    ttsQueueRef.current = queue
    ttsIndexRef.current = idx
    ttsActiveRef.current = true
    setTtsQueue(queue)
    setTtsIndex(idx)
    setTtsState('playing')
    setTtsChapter(queue[idx]?.id)
    speakItem(queue, idx)
  }

  const pauseChaptersTTS = () => {
    ttsActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsState('paused')
    // position is already saved in localStorage
  }

  const resumeChaptersTTS = () => {
    const queue = ttsQueueRef.current
    const idx = ttsIndexRef.current
    if (!queue.length) return
    ttsActiveRef.current = true
    setTtsState('playing')
    speakItem(queue, idx)
  }

  const stopChaptersTTS = (skipConfirm = false) => {
    if (!skipConfirm && (ttsState !== 'idle')) {
      if (!window.confirm('¿Seguro que quieres parar la reproducción? Se perderá el punto de avance guardado.')) return
    }
    ttsActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsState('idle')
    setTtsChapter(null)
    localStorage.removeItem(storageKey)
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
      .forEach(c => queue.push({ id: c.id, title: c.title, text: chapterToText(c) }))
    return queue
  }

  const playFromBeginning = (book, chapters) => {
    const queue = buildQueue(book, chapters)
    if (!queue.length) return
    startChaptersTTS(queue, 0)
  }

  const playFromChapter = (chapter, chapters) => {
    const doneChapters = chapters.filter(c => c.summary && c.summary_status === 'done')
    const idx = doneChapters.findIndex(c => c.id === chapter.id)
    const queue = doneChapters
      .slice(idx < 0 ? 0 : idx)
      .map(c => ({ id: c.id, title: c.title, text: chapterToText(c) }))
    if (!queue.length) return
    startChaptersTTS(queue, 0)
  }

  const resumeTTS = (book, chapters) => {
    const saved = loadTTSPos()
    if (!saved) { playFromBeginning(book, chapters); return }
    const queue = buildQueue(book, chapters)
    const idx = saved.chapterId
      ? Math.max(0, queue.findIndex(q => q.id === saved.chapterId))
      : saved.idx || 0
    startChaptersTTS(queue, idx)
  }

  const hasSavedPos = () => {
    try { return !!localStorage.getItem(storageKey) } catch { return false }
  }

  // ── Characters TTS ─────────────────────────────────────────────────────────
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

  const speakCharItem = (queue, idx) => {
    if (!ttsCharActiveRef.current || idx >= queue.length) {
      if (ttsCharActiveRef.current) {
        setTtsCharState('idle')
        setTtsCharacter(null)
        localStorage.removeItem(charStorageKey)
        ttsCharActiveRef.current = false
      }
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
    utterance.onend = () => {
      if (ttsCharActiveRef.current) speakCharItem(ttsCharQueueRef.current, ttsCharIndexRef.current + 1)
    }
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && ttsCharActiveRef.current) {
        speakCharItem(ttsCharQueueRef.current, ttsCharIndexRef.current + 1)
      }
    }
    window.speechSynthesis.speak(utterance)
  }

  const startCharsTTS = (queue, idx) => {
    stopAllTTS()
    if (!queue.length) return
    ttsCharQueueRef.current = queue
    ttsCharIndexRef.current = idx
    ttsCharActiveRef.current = true
    setTtsCharQueue(queue)
    setTtsCharIndex(idx)
    setTtsCharState('playing')
    setTtsCharacter(queue[idx]?.name)
    speakCharItem(queue, idx)
  }

  const pauseCharsTTS = () => {
    ttsCharActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsCharState('paused')
  }

  const resumeCharsTTS = () => {
    const queue = ttsCharQueueRef.current
    const idx = ttsCharIndexRef.current
    if (!queue.length) return
    ttsCharActiveRef.current = true
    setTtsCharState('playing')
    speakCharItem(queue, idx)
  }

  const stopCharsTTS = (skipConfirm = false) => {
    if (!skipConfirm && ttsCharState !== 'idle') {
      if (!window.confirm('¿Parar la reproducción?')) return
    }
    ttsCharActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsCharState('idle')
    setTtsCharacter(null)
    localStorage.removeItem(charStorageKey)
  }

  const playCharacter = (char) => {
    const queue = [{ name: char.name, text: characterToText(char) }]
    startCharsTTS(queue, 0)
  }

  const playFromCharacter = (char, characters) => {
    const idx = characters.findIndex(c => c.name === char.name)
    const queue = characters
      .slice(idx < 0 ? 0 : idx)
      .map(c => ({ name: c.name, text: characterToText(c) }))
    if (!queue.length) return
    startCharsTTS(queue, 0)
  }

  // ── Info TTS ───────────────────────────────────────────────────────────────
  const playInfo = (book) => {
    stopAllTTS()
    let text = ''
    if (book.synopsis) text += `Sinopsis. ${book.synopsis}. `
    if (book.author_bio) text += `Sobre el autor. ${book.author_bio}.`
    if (!text) { toast('No hay contenido para reproducir', { icon: 'ℹ️' }); return }

    ttsInfoActiveRef.current = true
    setTtsInfoState('playing')
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'es-ES'
    utterance.rate = 0.95
    utterance.onend = () => { setTtsInfoState('idle'); ttsInfoActiveRef.current = false }
    utterance.onerror = () => { setTtsInfoState('idle'); ttsInfoActiveRef.current = false }
    window.speechSynthesis.speak(utterance)
  }

  const pauseInfoTTS = () => {
    ttsInfoActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsInfoState('paused')
  }

  const resumeInfoTTS = (book) => {
    // Info TTS is short — just restart from beginning when resuming
    playInfo(book)
  }

  const stopInfoTTS = (skipConfirm = false) => {
    if (!skipConfirm && ttsInfoState !== 'idle') {
      if (!window.confirm('¿Parar la reproducción?')) return
    }
    ttsInfoActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsInfoState('idle')
  }

  // ── Summary TTS ────────────────────────────────────────────────────────────
  const playSummary = (book) => {
    stopAllTTS()
    const text = book.global_summary
    if (!text) { toast('No hay resumen disponible', { icon: 'ℹ️' }); return }

    ttsSummaryActiveRef.current = true
    setTtsSummaryState('playing')
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'es-ES'
    utterance.rate = 0.95
    utterance.onend = () => { setTtsSummaryState('idle'); ttsSummaryActiveRef.current = false }
    utterance.onerror = () => { setTtsSummaryState('idle'); ttsSummaryActiveRef.current = false }
    window.speechSynthesis.speak(utterance)
  }

  const pauseSummaryTTS = () => {
    ttsSummaryActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsSummaryState('paused')
  }

  const resumeSummaryTTS = (book) => {
    playSummary(book)
  }

  const stopSummaryTTS = (skipConfirm = false) => {
    if (!skipConfirm && ttsSummaryState !== 'idle') {
      if (!window.confirm('¿Parar la reproducción?')) return
    }
    ttsSummaryActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsSummaryState('idle')
  }

  // Determine if any TTS is active
  const anyTTSActive = ttsState !== 'idle' || ttsCharState !== 'idle' || ttsInfoState !== 'idle' || ttsSummaryState !== 'idle'
  const anyTTSPlaying = ttsState === 'playing' || ttsCharState === 'playing' || ttsInfoState === 'playing' || ttsSummaryState === 'playing'
  const anyTTSPaused = !anyTTSPlaying && anyTTSActive

  // Global pause/resume
  const globalPause = () => {
    if (ttsState === 'playing') pauseChaptersTTS()
    else if (ttsCharState === 'playing') pauseCharsTTS()
    else if (ttsInfoState === 'playing') pauseInfoTTS()
    else if (ttsSummaryState === 'playing') pauseSummaryTTS()
  }

  const globalResume = (book) => {
    if (ttsState === 'paused') resumeChaptersTTS()
    else if (ttsCharState === 'paused') resumeCharsTTS()
    else if (ttsInfoState === 'paused') resumeInfoTTS(book)
    else if (ttsSummaryState === 'paused') resumeSummaryTTS(book)
  }

  const globalStop = () => {
    if (!anyTTSActive) return
    if (!window.confirm('¿Seguro que quieres parar la reproducción? Se perderá el punto de avance guardado.')) return
    stopAllTTS()
    setTtsState('idle')
    setTtsCharState('idle')
    setTtsInfoState('idle')
    setTtsSummaryState('idle')
    setTtsChapter(null)
    setTtsCharacter(null)
    localStorage.removeItem(storageKey)
    localStorage.removeItem(charStorageKey)
    localStorage.removeItem(infoStorageKey)
  }

  const infoStorageKey = `tts_info_pos_${id}`

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      ttsActiveRef.current = false
      ttsCharActiveRef.current = false
      ttsInfoActiveRef.current = false
      ttsSummaryActiveRef.current = false
      window.speechSynthesis.cancel()
    }
  }, [])

  const [tab, setTab] = useState('info')
  const [expandedChapter, setExpandedChapter] = useState(null)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [audioEl, setAudioEl] = useState(null)
  const [rating, setRating] = useState(0)
  const [audioUrl, setAudioUrl] = useState(null)

  const load = async () => {
    try {
      const [bookRes, statusRes] = await Promise.all([
        booksAPI.get(id),
        analysisAPI.status(id),
      ])
      setPrevData(bookRes.data)
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

  // triggerPhase — stays on the same page, no navigation
  const triggerPhase = async (phase) => {
    try {
      if (phase === 1) await analysisAPI.triggerPhase1(id)
      else if (phase === 2) await analysisAPI.triggerPhase2(id)
      else if (phase === 3) await analysisAPI.triggerPhase3(id)
      else if (phase === 'podcast') await analysisAPI.triggerPodcast(id)
      toast.success('Proceso iniciado')
      // Reload data without navigating away
      setTimeout(load, 500)
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

  // ── Export to PDF ──────────────────────────────────────────────────────────
  const exportToPDF = async () => {
    if (!book) return
    toast('Generando PDF...', { icon: '📄', duration: 3000 })
    try {
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

      const checkPage = (needed = 20) => {
        if (y + needed > pageHeight - 20) { doc.addPage(); y = 20 }
      }
      const addText = (text, size = 10, weight = 'normal') => {
        doc.setFontSize(size)
        doc.setFont('helvetica', weight)
        const lines = doc.splitTextToSize(text || '', maxWidth)
        lines.forEach(line => { checkPage(); doc.text(line, margin, y); y += size * 0.4 })
        y += 3
      }

      // Cover page
      doc.setFillColor(13, 13, 13)
      doc.rect(0, 0, 210, 297, 'F')
      doc.setTextColor(201, 169, 110)
      doc.setFontSize(28)
      doc.setFont('helvetica', 'bold')
      const titleLines = doc.splitTextToSize(book.title, 170)
      titleLines.forEach((line, i) => doc.text(line, 105, 100 + (i * 12), { align: 'center' }))
      if (book.author) {
        doc.setFontSize(16)
        doc.setFont('helvetica', 'normal')
        doc.text(book.author, 105, 130, { align: 'center' })
      }
      doc.setFontSize(10)
      doc.text('Análisis generado por BookTracker', 105, 280, { align: 'center' })
      doc.text(new Date().toLocaleDateString('es-ES'), 105, 286, { align: 'center' })

      doc.addPage()
      doc.setTextColor(0, 0, 0)
      y = 20

      doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110)
      doc.text('Información General', margin, y); y += 12; doc.setTextColor(0, 0, 0)
      if (book.isbn) addText(`ISBN: ${book.isbn}`, 11, 'bold')
      if (book.year) addText(`Año: ${book.year}`, 11, 'bold')
      if (book.genre) addText(`Género: ${book.genre}`, 11, 'bold')
      if (book.pages) addText(`Páginas: ${book.pages}`, 11, 'bold')
      if (book.language) addText(`Idioma: ${book.language}`, 11, 'bold')
      y += 5

      if (book.synopsis) {
        checkPage(30); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110)
        doc.text('Sinopsis', margin, y); y += 10; doc.setTextColor(0, 0, 0)
        addText(book.synopsis, 10)
      }
      if (book.author_bio) {
        checkPage(30); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110)
        doc.text('Sobre el autor', margin, y); y += 10; doc.setTextColor(0, 0, 0)
        addText(book.author_bio, 10)
      }
      if (book.author_bibliography?.length > 0) {
        checkPage(30); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110)
        doc.text('Otras obras del autor', margin, y); y += 10; doc.setTextColor(0, 0, 0)
        book.author_bibliography.slice(0, 15).forEach((item) => {
          const title = typeof item === 'string' ? item : item.title
          const yr = typeof item === 'object' ? item.year : null
          addText(yr ? `• ${title} (${yr})` : `• ${title}`, 9)
        })
      }
      if (book.global_summary) {
        checkPage(30); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110)
        doc.text('Resumen Global', margin, y); y += 10; doc.setTextColor(0, 0, 0)
        addText(book.global_summary, 10)
      }
      if (chapters.length > 0) {
        doc.addPage(); y = 20
        doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110)
        doc.text('Capítulos', margin, y); y += 12; doc.setTextColor(0, 0, 0)
        chapters.forEach((ch, i) => {
          checkPage(25); doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110)
          doc.text(`${i + 1}. ${ch.title}`, margin, y); y += 7; doc.setTextColor(0, 0, 0)
          if (ch.summary) addText(ch.summary, 9)
          if (ch.key_events?.length > 0) { doc.setFont('helvetica', 'italic'); addText('Eventos clave: ' + ch.key_events.join(', '), 8) }
          y += 3
        })
      }
      if (characters.length > 0) {
        doc.addPage(); y = 20
        doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110)
        doc.text('Personajes', margin, y); y += 12; doc.setTextColor(0, 0, 0)
        characters.forEach((char) => {
          checkPage(30); doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110)
          doc.text(char.name, margin, y); y += 7; doc.setTextColor(0, 0, 0)
          if (char.role) { doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.text(`Rol: ${char.role}`, margin, y); y += 5 }
          if (char.description) addText(char.description, 9)
          if (char.personality) { addText('Personalidad:', 9, 'bold'); addText(char.personality, 9) }
          if (char.arc) { addText('Evolución:', 9, 'bold'); addText(char.arc, 9) }
          if (char.relationships && Object.keys(char.relationships).length > 0) {
            addText('Relaciones:', 9, 'bold')
            Object.entries(char.relationships).forEach(([name, rel]) => addText(`• ${name}: ${rel}`, 8))
          }
          if (char.key_moments?.length > 0) {
            addText('Momentos clave:', 9, 'bold'); doc.setFont('helvetica', 'italic')
            char.key_moments.forEach(moment => addText(`"${moment}"`, 8))
          }
          y += 5
        })
      }
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

  const activeData = data || prevData
  const book = activeData?.book || {}
  if (!loading && !activeData) return (
    <div className="book-loading" style={{ flexDirection: 'column', gap: '1rem' }}>
      <p style={{ color: 'var(--slate)' }}>No se pudo cargar el libro</p>
      <button onClick={() => navigate('/')} style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>
        Volver a la biblioteca
      </button>
    </div>
  )
  const chapters = activeData?.chapters || []
  const characters = activeData?.characters || []
  const isProcessing = PROCESSING_STATUSES.includes(status?.status)
  const isShell = book?.status === 'shell' || book?.status === 'shell_error'
  const hasFile = !!book?.file_path

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
                <Link to="/authors" state={{ author: book.author }} className="author-link">{book.author}</Link>
              </p>
            )}

            {/* Global TTS controls bar */}
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
              {book.year && <span>{book.year}</span>}
              {book.pages && <span>{book.pages} páginas</span>}
              {book.isbn && <span>ISBN: {book.isbn}</span>}
              {book.genre && <span>{book.genre}</span>}
            </div>

            {/* Star rating */}
            <div className="star-rating">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => handleRating(n)} className={`star ${rating >= n ? 'filled' : ''}`}>
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
                <button key={s.v} className={`rs-btn ${book.read_status === s.v ? 'active' : ''}`} onClick={() => handleReadStatus(s.v)}>
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

            {/* Upload file button — for shell or already-analyzed books */}
            {(!hasFile || isShell) && (
              <div className="shell-upload-area">
                <span className="shell-label">
                  {isShell ? 'Solo ficha — sube el PDF/EPUB para analizar' : 'Sin archivo adjunto'}
                </span>
                <label className="shell-upload-btn">
                  <input
                    type="file"
                    accept=".pdf,.epub"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files[0]
                      if (!file) return
                      try {
                        toast('Subiendo archivo…', { icon: '⏳' })
                        await uploadToShell(id, file)
                        toast.success('Archivo subido. Identificando…')
                        load()
                      } catch {
                        toast.error('Error al subir el archivo')
                      }
                    }}
                  />
                  <Upload size={14} /> Subir PDF/EPUB
                </label>
              </div>
            )}

            {/* Also allow uploading file to analyzed books (replace file) */}
            {hasFile && !isShell && status?.phase1_done && (
              <div className="attach-file-area">
                <label className="attach-file-btn" title="Reemplazar o adjuntar nuevo archivo">
                  <input
                    type="file"
                    accept=".pdf,.epub"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files[0]
                      if (!file) return
                      if (!confirm('¿Reemplazar el archivo actual? Se mantendrá todo el análisis existente.')) return
                      try {
                        toast('Subiendo archivo…', { icon: '⏳' })
                        await uploadToShell(id, file)
                        toast.success('Archivo actualizado')
                        load()
                      } catch {
                        toast.error('Error al subir el archivo')
                      }
                    }}
                  />
                  <Upload size={13} /> Reemplazar archivo
                </label>
              </div>
            )}

            {/* Status pipeline */}
            {!isShell && (
              <ProcessingPipeline
                status={status}
                isProcessing={isProcessing}
                onTrigger={triggerPhase}
                onCancel={cancelProcess}
                book={book}
              />
            )}
          </div>

          <button className="delete-btn" onClick={handleDelete} title="Eliminar libro">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="book-tabs">
        {/* Desktop sidebar */}
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

        {/* Mobile select */}
        <div className="tabs-select-wrapper tabs-select-mobile">
          <select className="tabs-select" value={tab} onChange={(e) => setTab(e.target.value)}>
            {TABS.map(t => {
              const disabled =
                (isShell && t.id !== 'info') ||
                (t.id === 'chapters' && !status?.phase2_done) ||
                (t.id === 'characters' && !status?.phase3_done) ||
                (t.id === 'summary' && !status?.phase3_done) ||
                (t.id === 'mindmap' && !status?.phase3_done) ||
                (t.id === 'podcast' && !book.podcast_audio_path)
              const icon = { info: '📖', chapters: '📑', characters: '👤', summary: '🧠', mindmap: '🗺️', podcast: '🎙️', refs: '🔗' }[t.id] || '•'
              return <option key={t.id} value={t.id} disabled={disabled}>{icon} {t.label}</option>
            })}
          </select>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab} className="tab-content"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

            {tab === 'info' && (
              <InfoTab
                book={book}
                otherBooks={activeData?.other_books || []}
                allBiblio={book.author_bibliography || []}
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
                onPlayChapter={(ch) => {
                  const queue = [{ id: ch.id, title: ch.title, text: chapterToText(ch) }]
                  startChaptersTTS(queue, 0)
                }}
                onPlayFromChapter={(ch) => playFromChapter(ch, chapters)}
                onStop={() => stopChaptersTTS()}
                onPause={pauseChaptersTTS}
                onResume={resumeChaptersTTS}
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
                onStop={() => stopCharsTTS()}
                onPause={pauseCharsTTS}
                onResume={resumeCharsTTS}
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

function ProcessingPipeline({ status, isProcessing, onTrigger, onCancel, book = {} }) {
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

function InfoTab({ book, otherBooks = [], allBiblio = [], ttsState, onPlay, onPause, onResume, onStop }) {
  // Build a unified list: books already in the app + missing ones from bibliography
  const allOtherWorks = React.useMemo(() => {
    const appMap = new Map()
    otherBooks.forEach(b => {
      appMap.set((b.title || '').toLowerCase().trim(), b)
      if (b.isbn) appMap.set(b.isbn, b)
    })

    const combined = [...otherBooks]
    allBiblio.forEach(item => {
      const title = typeof item === 'string' ? item : item.title
      const isbn = typeof item === 'object' ? item.isbn : null
      if (!title) return
      const key = (title || '').toLowerCase().trim()
      if (appMap.has(key) || (isbn && appMap.has(isbn))) return
      combined.push({
        _bibliographyOnly: true,
        title,
        isbn,
        year: typeof item === 'object' ? item.year : null,
        cover_url: typeof item === 'object' ? item.cover_url : null,
        synopsis: typeof item === 'object' ? item.synopsis : null,
      })
    })
    return combined.sort((a, b) => (b.year || 0) - (a.year || 0))
  }, [otherBooks, allBiblio])

  return (
    <div className="info-tab">
      {/* TTS Controls */}
      {(book.synopsis || book.author_bio) && (
        <div className="info-tts-controls">
          {ttsState === 'idle' && (
            <button className="info-tts-play-btn" onClick={onPlay}>
              <Play size={16} /> Reproducir ficha
            </button>
          )}
          {ttsState === 'playing' && (
            <div className="info-tts-active">
              <button className="tts-control-btn pause" onClick={onPause} title="Pausar">
                <Pause size={16} />
              </button>
              <button className="tts-control-btn stop" onClick={onStop} title="Detener">
                <Square size={16} />
              </button>
              <span className="tts-indicator">
                <Volume2 size={14} className="pulse" /> Reproduciendo
              </span>
            </div>
          )}
          {ttsState === 'paused' && (
            <div className="info-tts-active">
              <button className="info-tts-play-btn" onClick={onResume}>
                <Play size={16} /> Continuar reproducción
              </button>
              <button className="tts-control-btn stop" onClick={onStop} title="Detener">
                <Square size={16} />
              </button>
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

      {allOtherWorks.length > 0 && (
        <section>
          <h3>Otras obras del autor</h3>
          <div className="refs-grid">
            {allOtherWorks.map((ob, idx) => {
              if (ob._bibliographyOnly) {
                return (
                  <div key={`biblio-${idx}`} className="ref-item ref-item-missing">
                    {ob.cover_url ? (
                      <div className="ref-cover">
                        <img src={ob.cover_url} alt={ob.title} />
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
                      <span className="ref-badge" style={{ fontSize: '0.75rem', color: 'var(--mist)' }}>No añadido</span>
                    </div>
                  </div>
                )
              }
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
                    {!isShell && !isAnalyzed && <span className="ref-badge" style={{ fontSize: '0.75rem', color: '#3498db' }}>Sin analizar</span>}
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

function SummaryTab({ book, ttsState, onPlay, onPause, onResume, onStop }) {
  return (
    <div className="prose-content">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h2 style={{ margin: 0 }}>Resumen global</h2>
        {book.global_summary && (
          <div className="summary-tts-controls">
            {ttsState === 'idle' && (
              <button className="info-tts-play-btn" onClick={onPlay}>
                <Play size={16} /> Escuchar resumen
              </button>
            )}
            {ttsState === 'playing' && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="tts-control-btn pause" onClick={onPause} title="Pausar">
                  <Pause size={16} />
                </button>
                <button className="tts-control-btn stop" onClick={onStop} title="Detener">
                  <Square size={16} />
                </button>
                <span className="tts-indicator">
                  <Volume2 size={14} className="pulse" /> Reproduciendo
                </span>
              </div>
            )}
            {ttsState === 'paused' && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="info-tts-play-btn" onClick={onResume}>
                  <Play size={16} /> Continuar
                </button>
                <button className="tts-control-btn stop" onClick={onStop} title="Detener">
                  <Square size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <p>{book.global_summary || 'No disponible'}</p>
    </div>
  )
}

function ChaptersTab({ chapters, expanded, setExpanded, bookId, onChapterSummarized, ttsState, ttsChapter, onPlayChapter, onPlayFromChapter, onStop, onPause, onResume }) {
  const [summarizing, setSummarizing] = React.useState({})

  const handleSummarize = async (e, chapter) => {
    e.stopPropagation()
    setSummarizing(s => ({ ...s, [chapter.id]: true }))
    try {
      await chapterAPI.summarize(bookId, chapter.id)
      toast('Resumiendo capítulo...', { icon: '⏳' })
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
                    ? <span className="badge badge-slate" title="Contenido bloqueado">⚠ Omitido</span>
                    : ch.summary_status === 'processing'
                      ? <span className="badge badge-gold">Procesando…</span>
                      : (
                        <button className="summarize-ch-btn" onClick={(e) => handleSummarize(e, ch)} disabled={summarizing[ch.id]}>
                          {summarizing[ch.id] ? '…' : '+ Resumir'}
                        </button>
                      )
              }
              {ch.summary_status === 'done' && (
                <div className="ch-tts-btns" onClick={e => e.stopPropagation()}>
                  {/* Play/Pause individual chapter */}
                  <button
                    className={`ch-tts-btn ${ttsState === 'playing' && ttsChapter === ch.id ? 'pause' : 'play'}`}
                    onClick={() => {
                      if (ttsState === 'playing' && ttsChapter === ch.id) {
                        onPause()
                      } else if (ttsState === 'paused' && ttsChapter === ch.id) {
                        onResume()
                      } else {
                        onPlayChapter(ch)
                      }
                    }}
                    title={ttsState === 'playing' && ttsChapter === ch.id ? 'Pausar' : ttsState === 'paused' && ttsChapter === ch.id ? 'Continuar' : 'Reproducir'}
                  >
                    {ttsState === 'playing' && ttsChapter === ch.id
                      ? <Pause size={12} />
                      : <Play size={12} />
                    }
                  </button>
                  {/* Play from this chapter onwards */}
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

function CharactersTab({ characters, bookId, onReanalyzed, status, ttsState, ttsCharacter, onPlayCharacter, onPlayFromCharacter, onStop, onPause, onResume }) {
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
          <span className="characters-count">{characters.length} personaje{characters.length !== 1 ? 's' : ''}</span>
          {ttsState === 'playing' && ttsCharacter && (
            <span className="tts-indicator">
              <Volume2 size={14} className="pulse" /> Reproduciendo personajes
            </span>
          )}
          {ttsState === 'paused' && (
            <span className="tts-indicator" style={{ color: 'var(--slate)' }}>
              ⏸ Pausado
            </span>
          )}
        </div>
        <div className="characters-actions">
          {ttsState === 'playing' && (
            <>
              <button className="tts-control-btn pause" onClick={onPause} title="Pausar"><Pause size={16} /></button>
              <button className="tts-control-btn stop" onClick={onStop} title="Detener"><Square size={16} /></button>
            </>
          )}
          {ttsState === 'paused' && (
            <>
              <button className="tts-control-btn resume" onClick={onResume} title="Continuar"><Play size={16} /></button>
              <button className="tts-control-btn stop" onClick={onStop} title="Detener"><Square size={16} /></button>
            </>
          )}
          {status?.phase3_done && (
            <button className="reanalyze-chars-btn" onClick={handleReanalyze} disabled={reanalyzing}>
              {reanalyzing ? '⏳ Reanalizando…' : '↻ Reanalizar'}
            </button>
          )}
        </div>
      </div>
      {!characters.length
        ? <p className="empty-tab">No se encontraron personajes. Pulsa ↻ Reanalizar para generarlos.</p>
        : <div className="characters-grid">
          {characters.map((char, i) => {
            const isPlaying = ttsState === 'playing' && ttsCharacter === char.name
            return (
              <div key={i} className={`char-card ${isPlaying ? 'char-playing' : ''}`}>
                <div className="char-avatar">{char.name?.[0]?.toUpperCase() || '?'}</div>
                <div className="char-info">
                  <div className="char-header">
                    <h3 className="char-name">{char.name}</h3>
                    <div className="char-tts-btns">
                      <button className="char-tts-btn" onClick={() => onPlayCharacter(char)} disabled={ttsState === 'playing'} title="Reproducir este personaje">
                        {isPlaying ? <Volume2 size={14} className="pulse" /> : <Play size={14} />}
                      </button>
                      <button className="char-tts-btn from-here" onClick={() => onPlayFromCharacter(char, characters)} disabled={ttsState === 'playing'} title="Reproducir desde aquí">
                        <PlayCircle size={14} />
                      </button>
                    </div>
                  </div>
                  {char.role && <span className={`char-role role-${char.role}`}>{char.role}</span>}
                  {char.description && <p className="char-desc">{char.description}</p>}
                  {char.personality && <div className="char-section"><strong>Personalidad</strong><p>{char.personality}</p></div>}
                  {char.arc && <div className="char-section"><strong>Evolución</strong><p>{char.arc}</p></div>}
                  {char.importance && <div className="char-section"><strong>Importancia</strong><p>{char.importance}</p></div>}
                  {char.relationships && Object.keys(char.relationships).length > 0 && (
                    <div className="char-section">
                      <strong>Relaciones</strong>
                      <ul className="char-relations">{Object.entries(char.relationships).map(([name, rel], j) => <li key={j}><em>{name}</em>: {rel}</li>)}</ul>
                    </div>
                  )}
                  {char.key_moments?.length > 0 && (
                    <div className="char-section">
                      <strong>Momentos clave</strong>
                      {char.key_moments.map((q, j) => <blockquote key={j} className="char-quote">{q}</blockquote>)}
                    </div>
                  )}
                  {char.quotes?.length > 0 && (
                    <div className="char-section">
                      <strong>Citas y momentos memorables</strong>
                      {char.quotes.map((q, j) => <blockquote key={j} className="char-quote">{q}</blockquote>)}
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
  const bookTitle = encodeURIComponent(book.title || '')
  const author = encodeURIComponent(book.author || '')
  const isbn = book.isbn || ''
  const refs = {
    wikipedia: `https://es.wikipedia.org/wiki/${bookTitle}`,
    goodreads: `https://www.goodreads.com/search?q=${bookTitle}`,
    youtube: `https://www.youtube.com/results?search_query=${bookTitle}+${author}`,
    amazon: `https://www.amazon.es/s?k=${bookTitle}+${author}`,
    googleBooks: isbn ? `https://books.google.es/books?isbn=${isbn}` : `https://books.google.es/books?q=${bookTitle}+${author}`,
    library: `https://www.worldcat.org/search?q=${bookTitle}`,
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
        <div className="refs-section">
          <h4><BookOpen size={18} />Sobre el libro</h4>
          <div className="refs-links">
            {[
              { href: refs.wikipedia, icon: <ExternalLink size={16} />, label: 'Wikipedia' },
              { href: refs.goodreads, icon: <Star size={16} />, label: 'Goodreads' },
              { href: refs.youtube, icon: <Play size={16} />, label: 'YouTube' },
              { href: refs.amazon, icon: <ExternalLink size={16} />, label: 'Amazon' },
              { href: refs.googleBooks, icon: <BookOpen size={16} />, label: 'Google Books' },
              { href: refs.library, icon: <BookOpen size={16} />, label: 'WorldCat' },
            ].map(({ href, icon, label }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="ref-link">
                {icon}<span>{label}</span>
              </a>
            ))}
          </div>
        </div>
        {book.author && (
          <div className="refs-section">
            <h4><User size={18} />Sobre el autor</h4>
            <div className="refs-links">
              {[
                { href: refs.authorWikipedia, icon: <ExternalLink size={16} />, label: 'Wikipedia (autor)' },
                { href: refs.authorGoodreads, icon: <Star size={16} />, label: 'Goodreads (autor)' },
                { href: refs.authorYoutube, icon: <Play size={16} />, label: 'Entrevistas YouTube' },
                { href: refs.authorX, icon: <ExternalLink size={16} />, label: 'X / Twitter' },
                { href: refs.authorInstagram, icon: <ExternalLink size={16} />, label: 'Instagram' },
              ].map(({ href, icon, label }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="ref-link">
                  {icon}<span>{label}</span>
                </a>
              ))}
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

  const processScript = (script) => {
    const lines = script.split('\n').filter(l => l.trim())
    const sections = []
    let currentSection = null

    lines.forEach(line => {
      const trimmed = line.trim()
      if (
        (trimmed === trimmed.toUpperCase() && trimmed.length > 3) ||
        /^(INTRODUCCIÓN|CAPÍTULO|PARTE|PERSONAJES|CONCLUSIÓN|ANÁLISIS)/i.test(trimmed) ||
        /^(#|##|\*\*|__|=)/.test(trimmed)
      ) {
        if (currentSection) sections.push(currentSection)
        currentSection = { type: 'section', title: trimmed.replace(/^[#*_=]+\s*/, '').replace(/[#*_=]+$/, ''), content: [] }
      } else if (/^[-•]\s/.test(trimmed)) {
        if (!currentSection) currentSection = { type: 'default', content: [] }
        currentSection.content.push({ type: 'dialogue', text: trimmed.substring(2) })
      } else if (trimmed.endsWith('?')) {
        if (!currentSection) currentSection = { type: 'default', content: [] }
        currentSection.content.push({ type: 'question', text: trimmed })
      } else if (trimmed) {
        if (!currentSection) currentSection = { type: 'default', content: [] }
        currentSection.content.push({ type: 'paragraph', text: trimmed })
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
          <h3><Volume2 size={18} />Guión del podcast</h3>
          <div className="script-content-enhanced">
            {sections.map((section, i) => (
              <div key={i} className={`script-section ${section.type}`}>
                {section.title && (
                  <h4 className="section-title">
                    <span className="section-marker">▸</span>{section.title}
                  </h4>
                )}
                {section.content.map((item, j) => {
                  if (item.type === 'dialogue') return <p key={j} className="script-dialogue"><span className="dialogue-marker">•</span>{item.text}</p>
                  if (item.type === 'question') return <p key={j} className="script-question"><span className="question-marker">?</span>{item.text}</p>
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
