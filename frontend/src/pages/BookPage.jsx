import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  BookOpen, User, List, Brain, Map, Mic, Star, ExternalLink,
  Play, Pause, Square, ChevronDown, ChevronUp, Loader, CheckCircle,
  ArrowLeft, Edit3, Trash2, AlertCircle, Volume2, VolumeX, PlayCircle, FileText, RefreshCw, X, MessageSquare
} from 'lucide-react'
import { booksAPI, analysisAPI, chapterAPI, characterAPI, uploadToShell, reanalyzeCharacters, queueAPI } from '../utils/api'
import MindMap from '../components/MindMap'
import LiteraryDialogue from '../components/LiteraryDialogue'
import { coverSrc } from '../components/BookCover'
import CoverPicker from '../components/CoverPicker'
import './BookPage.css'

const TABS = [
  { id: 'info',       label: 'Ficha',          icon: BookOpen,     statusKey: 'phase1_done' },
  { id: 'chapters',   label: 'Capítulos',       icon: List,         statusKey: 'phase2_done' },
  { id: 'characters', label: 'Personajes',      icon: User,         statusKey: 'phase3_done' },
  { id: 'summary',    label: 'Resumen global',  icon: Brain,        statusKey: 'has_global_summary' },
  { id: 'mindmap',    label: 'Mapa mental',     icon: Map,          statusKey: 'has_mindmap' },
  { id: 'chat',       label: 'Diálogo',         icon: MessageSquare,statusKey: 'phase1_done' },
  { id: 'podcast',    label: 'Podcast',         icon: Mic,          statusKey: 'podcast_done' },
  { id: 'refs',       label: 'Referencias',     icon: ExternalLink, statusKey: null },
]

const PROCESSING_STATUSES = ['queued', 'identifying', 'analyzing_structure', 'summarizing', 'generating_podcast']

// ── Modal de confirmación propio (evita el checkbox del window.confirm nativo) ──
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className=\"confirm-overlay\" onClick={onCancel}>
      <div className=\"confirm-box\" onClick={e => e.stopPropagation()}>
        <p className=\"confirm-msg\">{message}</p>
        <div className=\"confirm-btns\">
          <button className=\"confirm-btn-cancel\" onClick={onCancel}>Cancelar</button>
          <button className=\"confirm-btn-ok\" onClick={onConfirm}>Aceptar</button>
        </div>
      </div>
    </div>
  )
}

function useConfirm() {
  const [state, setState] = useState(null) // { message, resolve }
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
  const [progressMsg, setProgressMsg] = useState('')  // mensaje en tiempo real de la cola

  // TTS state — capítulos
  const [ttsPlaying,       setTtsPlaying]       = useState(false)
  const [ttsChapterPaused, setTtsChapterPaused] = useState(false)  // pausa activa
  const [ttsChapter,       setTtsChapter]       = useState(null)   // id capítulo activo
  const [ttsMode,          setTtsMode]          = useState('single') // 'single' | 'from'
  const [ttsQueue,         setTtsQueue]         = useState([])
  const [ttsIndex,         setTtsIndex]         = useState(0)
  const ttsQueueRef       = React.useRef([])
  const ttsIndexRef       = React.useRef(0)
  const ttsActiveRef      = React.useRef(false)
  const ttsSentencesRef   = React.useRef([])   // frases del item actual
  const ttsSentIdxRef     = React.useRef(0)    // índice de frase dentro del item
  const storageKey        = `tts_pos_${id}`

  // TTS state for characters
  const [ttsCharPlaying, setTtsCharPlaying] = useState(false)
  const [ttsCharPaused,  setTtsCharPaused]  = useState(false)
  const [ttsCharacter, setTtsCharacter] = useState(null)
  const [ttsCharQueue, setTtsCharQueue] = useState([])
  const [ttsCharIndex, setTtsCharIndex] = useState(0)
  const ttsCharQueueRef    = React.useRef([])
  const ttsCharIndexRef    = React.useRef(0)
  const ttsCharActiveRef   = React.useRef(false)
  const ttsCharSentRef     = React.useRef([])  // frases del personaje actual
  const ttsCharSentIdxRef  = React.useRef(0)   // índice de frase dentro del personaje
  const charStorageKey = `tts_char_pos_${id}`

  // TTS state for InfoTab (Ficha) y Resumen Global
  const [ttsInfoPlaying, setTtsInfoPlaying] = useState(false)
  const [ttsInfoPaused,  setTtsInfoPaused]  = useState(false)
  const ttsInfoSentencesRef = React.useRef([])   // array de frases
  const ttsInfoIndexRef     = React.useRef(0)    // índice de frase actual
  const ttsInfoActiveRef    = React.useRef(false) // controla si onend/onerror actúan
  const infoStorageKey = `tts_info_pos_${id}`

  const pauseTTS = () => {
    ttsActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsPlaying(false)
    setTtsChapterPaused(true)  // ttsChapter se mantiene — cabecera y tab muestran 'Continuar'
  }

  const resumeCurrentTTS = () => {
    if (!ttsQueueRef.current.length) return
    ttsActiveRef.current = true
    setTtsPlaying(true); setTtsChapterPaused(false)
    // Reanudar desde la frase exacta donde se pausó
    _speakChapterSentence(ttsSentencesRef.current, ttsSentIdxRef.current)
  }

  const stopTTS = async (skipConfirm = false) => {
    if (!skipConfirm && (ttsPlaying || ttsChapter || ttsChapterPaused)) {
      if (!await confirm('¿Seguro que quieres parar la reproducción? Se perderá el punto de avance guardado.')) return
    }
    ttsActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsPlaying(false); setTtsChapter(null); setTtsChapterPaused(false); setTtsMode('single')
    ttsSentencesRef.current = []; ttsSentIdxRef.current = 0
    localStorage.removeItem(storageKey)
  }

  // Habla una frase dentro del capítulo actual; al terminar, avanza frase o pasa al siguiente capítulo
  const _speakChapterSentence = (sentences, sIdx) => {
    if (!ttsActiveRef.current) return
    if (sIdx >= sentences.length) {
      // Acabó este capítulo — pasar al siguiente item de la cola
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
    u.onend = () => {
      if (!ttsActiveRef.current) return
      _speakChapterSentence(sentences, sIdx + 1)
    }
    u.onerror = (e) => {
      if (e.error === 'interrupted') return
      if (ttsActiveRef.current) _speakChapterSentence(sentences, sIdx + 1)
    }
    window.speechSynthesis.speak(u)
  }

  const speakItem = (queue, idx) => {
    if (!ttsActiveRef.current) return
    if (idx >= queue.length) {
      ttsActiveRef.current = false
      setTtsPlaying(false); setTtsChapter(null); setTtsChapterPaused(false)
      localStorage.removeItem(storageKey)
      return
    }
    const item = queue[idx]
    ttsIndexRef.current = idx; ttsQueueRef.current = queue
    saveTTSPos(idx, queue, 0)
    setTtsIndex(idx); setTtsChapter(item.id)
    // Dividir texto del capítulo en frases
    const raw = item.text.match(/[^.!?]+[.!?]+[\s]*/g) || [item.text]
    const sentences = raw.map(s => s.trim()).filter(Boolean)
    ttsSentencesRef.current = sentences
    ttsSentIdxRef.current = 0
    _speakChapterSentence(sentences, 0)
  }

  const saveTTSPos = (idx, queue, sentIdx = 0) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ idx, chapterId: queue[idx]?.id, sentIdx }))
    } catch {}
  }

  const loadTTSPos = () => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? JSON.parse(saved) : null
    } catch { return null }
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
    ttsActiveRef.current = true
    setTtsPlaying(true)
    speakItem(queue, 0)
  }

  const playFromChapter = (chapter, chapters) => {
    stopTTS(true)
    const doneChapters = chapters.filter(c => c.summary && c.summary_status === 'done')
    const idx = doneChapters.findIndex(c => c.id === chapter.id)
    const queue = Object.assign(
      doneChapters.slice(idx < 0 ? 0 : idx).map(c => ({ id: c.id, title: c.title, text: chapterToText(c) })),
      { _mode: 'from' }
    )
    if (!queue.length) return
    ttsQueueRef.current = queue
    ttsIndexRef.current = 0
    setTtsQueue(queue); setTtsIndex(0)
    setTtsMode('from'); setTtsChapterPaused(false)
    ttsActiveRef.current = true
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

  const pauseCharTTS = () => {
    ttsCharActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsCharPlaying(false); setTtsCharPaused(true)
    // ttsCharSentRef y ttsCharSentIdxRef conservan posición exacta
  }

  const resumeCharTTS = () => {
    if (!ttsCharQueueRef.current.length) return
    ttsCharActiveRef.current = true
    setTtsCharPlaying(true); setTtsCharPaused(false)
    _speakCharSentence(ttsCharSentRef.current, ttsCharSentIdxRef.current)
  }

  const stopCharTTS = async (skipConfirm = false) => {
    if (!skipConfirm && (ttsCharPlaying || ttsCharPaused || ttsCharacter)) {
      if (!await confirm('¿Seguro que quieres parar la reproducción? Se perderá el punto de avance guardado.')) return
    }
    ttsCharActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsCharPlaying(false); setTtsCharPaused(false); setTtsCharacter(null)
    ttsCharSentRef.current = []; ttsCharSentIdxRef.current = 0
    localStorage.removeItem(charStorageKey)
  }

  // Habla una frase dentro del personaje actual; al terminar avanza frase o pasa al siguiente personaje
  const _speakCharSentence = (sentences, sIdx) => {
    if (!ttsCharActiveRef.current) return
    if (sIdx >= sentences.length) {
      speakCharItem(ttsCharQueueRef.current, ttsCharIndexRef.current + 1)
      return
    }
    ttsCharSentIdxRef.current = sIdx
    const u = new SpeechSynthesisUtterance(sentences[sIdx])
    u.lang = 'es-ES'; u.rate = 0.95
    u.onend = () => {
      if (!ttsCharActiveRef.current) return
      _speakCharSentence(sentences, sIdx + 1)
    }
    u.onerror = (e) => {
      if (e.error === 'interrupted') return
      if (ttsCharActiveRef.current) _speakCharSentence(sentences, sIdx + 1)
    }
    window.speechSynthesis.speak(u)
  }

  const speakCharItem = (queue, idx) => {
    if (!ttsCharActiveRef.current) return
    if (idx >= queue.length) {
      ttsCharActiveRef.current = false
      setTtsCharPlaying(false); setTtsCharPaused(false); setTtsCharacter(null)
      localStorage.removeItem(charStorageKey)
      return
    }
    const item = queue[idx]
    ttsCharIndexRef.current = idx; ttsCharQueueRef.current = queue
    saveCharTTSPos(idx, queue)
    setTtsCharIndex(idx); setTtsCharacter(item.name)
    // Dividir texto del personaje en frases
    const raw = item.text.match(/[^.!?]+[.!?]+[\s]*/g) || [item.text]
    const sentences = raw.map(s => s.trim()).filter(Boolean)
    ttsCharSentRef.current = sentences
    ttsCharSentIdxRef.current = 0
    _speakCharSentence(sentences, 0)
  }

  const _startCharTTS = (queue) => {
    stopCharTTS(true); stopTTS(true); stopInfoTTS(true)
    window.speechSynthesis.cancel()
    ttsCharQueueRef.current = queue; ttsCharIndexRef.current = 0
    setTtsCharQueue(queue); setTtsCharIndex(0)
    ttsCharActiveRef.current = true
    setTtsCharPlaying(true); setTtsCharPaused(false)
    speakCharItem(queue, 0)
  }

  const playCharacter = (char) => {
    _startCharTTS([{ name: char.name, text: characterToText(char) }])
  }

  const playFromCharacter = (char, characters) => {
    const idx = characters.findIndex(c => c.name === char.name)
    const queue = characters.slice(idx < 0 ? 0 : idx).map(c => ({ name: c.name, text: characterToText(c) }))
    if (!queue.length) return
    _startCharTTS(queue)
  }

  // Divide texto en frases y habla desde el índice dado
  const _speakInfoFromIndex = (sentences, idx) => {
    if (!ttsInfoActiveRef.current || idx >= sentences.length) {
      if (ttsInfoActiveRef.current) {
        ttsInfoActiveRef.current = false
        setTtsInfoPlaying(false); setTtsInfoPaused(false)
        ttsInfoSentencesRef.current = []; ttsInfoIndexRef.current = 0
        localStorage.removeItem(infoStorageKey)
      }
      return
    }
    ttsInfoIndexRef.current = idx
    localStorage.setItem(infoStorageKey, JSON.stringify({ idx }))
    const u = new SpeechSynthesisUtterance(sentences[idx])
    u.lang = 'es-ES'; u.rate = 0.95
    u.onend = () => {
      if (!ttsInfoActiveRef.current) return
      _speakInfoFromIndex(sentences, idx + 1)
    }
    u.onerror = (e) => {
      if (e.error === 'interrupted') return
      if (ttsInfoActiveRef.current) _speakInfoFromIndex(sentences, idx + 1)
    }
    window.speechSynthesis.speak(u)
  }

  const _startInfoTTS = (text, fromIdx = 0) => {
    // Partir en frases por '. ', '! ', '? ' manteniendo el delimitador
    const raw = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text]
    const sentences = raw.map(s => s.trim()).filter(Boolean)
    ttsInfoSentencesRef.current = sentences
    ttsInfoIndexRef.current = fromIdx
    ttsInfoActiveRef.current = true
    _speakInfoFromIndex(sentences, fromIdx)
  }

  const playInfo = (book) => {
    stopTTS(true); stopCharTTS(true); stopInfoTTS(true); window.speechSynthesis.cancel()
    const text = book.synopsis || ''
    if (!text) { toast('No hay sinopsis disponible', { icon: 'ℹ️' }); return }
    setTtsInfoPlaying(true); setTtsInfoPaused(false)
    _startInfoTTS(text, 0)
  }

  const playSummary = (book) => {
    stopTTS(true); stopCharTTS(true); stopInfoTTS(true); window.speechSynthesis.cancel()
    if (!book.global_summary) { toast('No hay resumen disponible', { icon: 'ℹ️' }); return }
    setTtsInfoPlaying(true); setTtsInfoPaused(false)
    _startInfoTTS(book.global_summary, 0)
  }

  const pauseInfoTTS = () => {
    ttsInfoActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsInfoPlaying(false)
    setTtsInfoPaused(true)
    // ttsInfoSentencesRef e ttsInfoIndexRef se conservan para reanudar en el mismo punto
  }

  const resumeInfoTTS = () => {
    const sentences = ttsInfoSentencesRef.current
    const idx = ttsInfoIndexRef.current
    if (!sentences.length) return
    setTtsInfoPlaying(true); setTtsInfoPaused(false)
    ttsInfoActiveRef.current = true
    _speakInfoFromIndex(sentences, idx)
  }

  const stopInfoTTS = async (skipConfirm = false) => {
    if (!skipConfirm && (ttsInfoPlaying || ttsInfoPaused)) {
      if (!await confirm('¿Seguro que quieres parar la reproducción? Se perderá el punto de avance guardado.')) return
    }
    ttsInfoActiveRef.current = false
    window.speechSynthesis.cancel()
    setTtsInfoPlaying(false); setTtsInfoPaused(false)
    ttsInfoSentencesRef.current = []; ttsInfoIndexRef.current = 0
    localStorage.removeItem(infoStorageKey)
  }

  React.useEffect(() => { return () => window.speechSynthesis.cancel() }, [])
  const [tab, setTab] = useState('info')
  const [expandedChapter, setExpandedChapter] = useState(null)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [coverKey, setCoverKey] = useState(0) // fuerza re-render de BookCover tras cambio
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [audioPaused, setAudioPaused] = useState(false)
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
      // Obtener mensaje de progreso de Redis si hay proceso activo
      try {
        const { data: qState } = await queueAPI.get()
        const info = qState?.infos?.[id]
        if (info?.msg) setProgressMsg(info.msg)
        else setProgressMsg('')
      } catch { /* silencioso */ }
    } catch {
      toast.error('No se encontró el libro')
      navigate('/')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

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

  const triggerPhase = async (phase, force = false) => {
    try {
      if (phase === 1) await analysisAPI.triggerPhase1(id, force)
      else if (phase === 2) await analysisAPI.triggerPhase2(id)
      else if (phase === 3) await analysisAPI.triggerPhase3(id)
      else if (phase === 4) await analysisAPI.triggerPhase4(id)
      else if (phase === 5) await analysisAPI.triggerPhase5(id)
      else if (phase === 6) await analysisAPI.triggerPodcast(id)
      
      toast.success(force ? 'Análisis completo encolado' : 'Proceso iniciado')
      navigate('/')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al iniciar proceso')
    }
  }

  const handleCancelAnalysis = async () => {
    if (!confirm(`¿Seguro que quieres detener el análisis de «${book.title}»?`)) return
    try {
      await analysisAPI.cancel(id)
      toast.success('Análisis detenido')
      setTimeout(load, 500)
    } catch (err) {
      toast.error('Error al detener: ' + (err.response?.data?.detail || err.message))
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
      el.onended = () => { setAudioPlaying(false); setAudioPaused(false) }
      setAudioEl(el)
      el.play()
      setAudioPlaying(true); setAudioPaused(false)
    } else {
      if (audioPlaying) { audioEl.pause(); setAudioPlaying(false); setAudioPaused(true) }
      else { audioEl.play(); setAudioPlaying(true); setAudioPaused(false) }
    }
  }

  const stopAudio = async (skipConfirm = false) => {
    if (!skipConfirm && (audioPlaying || audioPaused)) {
      if (!await confirm('¿Seguro que quieres parar la reproducción? Se perderá el punto de avance guardado.')) return
    }
    if (audioEl) { audioEl.pause(); audioEl.currentTime = 0 }
    setAudioPlaying(false); setAudioPaused(false)
  }

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
        doc.setFontSize(size); doc.setFont('helvetica', weight)
        const lines = doc.splitTextToSize(text || '', maxWidth)
        lines.forEach(line => { checkPage(); doc.text(line, margin, y); y += size * 0.4 })
        y += 3
      }
      doc.setFillColor(13, 13, 13); doc.rect(0, 0, 210, 297, 'F')
      doc.setTextColor(201, 169, 110); doc.setFontSize(28); doc.setFont('helvetica', 'bold')
      const titleLines = doc.splitTextToSize(book.title, 170)
      titleLines.forEach((line, i) => { doc.text(line, 105, 100 + (i * 12), { align: 'center' }) })
      if (book.author) { doc.setFontSize(16); doc.setFont('helvetica', 'normal'); doc.text(book.author, 105, 130, { align: 'center' }) }
      doc.setFontSize(10)
      doc.text('Análisis generado por BookTracker', 105, 280, { align: 'center' })
      doc.text(new Date().toLocaleDateString('es-ES'), 105, 286, { align: 'center' })
      doc.addPage(); doc.setTextColor(0, 0, 0); y = 20
      doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110)
      doc.text('Información General', margin, y); y += 12; doc.setTextColor(0, 0, 0)
      if (book.isbn) addText(`ISBN: ${book.isbn}`, 11, 'bold')
      if (book.year) addText(`Año: ${book.year}`, 11, 'bold')
      if (book.genre) addText(`Género: ${book.genre}`, 11, 'bold')
      if (book.pages) addText(`Páginas: ${book.pages}`, 11, 'bold')
      if (book.language) addText(`Idioma: ${book.language}`, 11, 'bold')
      y += 5
      if (book.synopsis) { checkPage(30); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110); doc.text('Sinopsis', margin, y); y += 10; doc.setTextColor(0, 0, 0); addText(book.synopsis, 10) }
      if (book.author_bio) { checkPage(30); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110); doc.text('Sobre el autor', margin, y); y += 10; doc.setTextColor(0, 0, 0); addText(book.author_bio, 10) }
      if (book.author_bibliography?.length > 0) {
        checkPage(30); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110)
        doc.text('Otras obras del autor', margin, y); y += 10; doc.setTextColor(0, 0, 0)
        book.author_bibliography.slice(0, 15).forEach((item) => {
          const title = typeof item === 'string' ? item : item.title
          const yr = typeof item === 'object' ? item.year : null
          addText(yr ? `• ${title} (${yr})` : `• ${title}`, 9)
        })
      }
      if (book.global_summary) { checkPage(30); doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(201, 169, 110); doc.text('Resumen Global', margin, y); y += 10; doc.setTextColor(0, 0, 0); addText(book.global_summary, 10) }
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
    if (!confirm(`¿Eliminar \"${data?.book?.title}\"?`)) return
    await booksAPI.delete(id)
    navigate('/')
  }

  if (loading) return (
    <div className=\"book-loading\">
      <Loader size={28} className=\"spin\" strokeWidth={1.5} />
      <p>Cargando información del libro...</p>
    </div>
  )

  const activeData = data || prevData
  const book = activeData?.book || {}
  const statusInfo = status || {}
  
  if (!activeData || !book.id) return (
    <div className=\"book-loading\" style={{flexDirection:\"column\",gap:\"1rem\"}}>
      <p style={{color:\"var(--slate)\"}}>No se pudo encontrar el libro o no tienes permiso para verlo.</p>
      <button onClick={() => navigate(\"/\")} style={{background:\"var(--ink)\",color:\"var(--paper)\",border:\"none\",padding:\"0.5rem 1rem\",borderRadius:\"4px\",cursor:\"pointer\"}}>
        Volver a la biblioteca
      </button>
    </div>
  )
  const chapters = activeData?.chapters || []
  const characters = activeData?.characters || []
  const isProcessing = PROCESSING_STATUSES.includes(statusInfo.status)
  const isShell = book.status === 'shell' || book.status === 'shell_error'

  return (
    <div className=\"book-page\">
      <div className=\"book-hero\">
        <button className=\"back-btn\" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Biblioteca
        </button>

        <div className=\"hero-content\">
          <div className=\"hero-cover\" style={{ cursor: 'pointer', position: 'relative' }} onClick={() => setCoverPickerOpen(true)} title=\"Haz clic para cambiar la portada\">
            <HeroCover key={coverKey} book={book} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: '0.7rem', textAlign: 'center', padding: '4px 0', opacity: 0, transition: 'opacity 0.2s' }}
              className=\"cover-change-hint\">
              ✏ Cambiar
            </div>
          </div>

          <div className=\"hero-info\">
            <div className="hero-info">
              <h1>{book.title}</h1>
              {book.author && (
                <p className="hero-author">
                  <Link to="/authors" state={{author: book.author}} className="author-link">{book.author}</Link>
                </p>
              )}

              {(ttsPlaying || ttsChapterPaused || ttsChapter || ttsInfoPlaying || ttsInfoPaused || ttsCharPlaying || ttsCharPaused || audioPlaying || audioPaused) && (
                <div className="hero-tts-global">
                  {(ttsPlaying || ttsInfoPlaying || ttsCharPlaying || audioPlaying) ? (
                    <>
                      <button className="hero-tts-btn" onClick={() => {
                        if (ttsPlaying)          pauseTTS()
                        else if (ttsInfoPlaying)  pauseInfoTTS()
                        else if (ttsCharPlaying)  pauseCharTTS()
                        else if (audioPlaying)    toggleAudio()
                      }}>
                        <Pause size={14} /> Pausar reproducción
                      </button>
                      <button className="hero-tts-btn hero-tts-stop" onClick={() => {
                        if (ttsPlaying)      stopTTS()
                        if (ttsInfoPlaying)  stopInfoTTS()
                        if (ttsCharPlaying)  stopCharTTS()
                        if (audioPlaying)    stopAudio()
                      }}>
                        <Square size={14} /> Stop
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="hero-tts-btn hero-tts-resume" onClick={() => {
                        if (ttsChapterPaused)   resumeCurrentTTS()
                        else if (ttsCharPaused) resumeCharTTS()
                        else if (ttsInfoPaused) resumeInfoTTS()
                        else if (audioPaused)   toggleAudio()
                      }}>
                        <Play size={14} /> Continuar reproducción
                      </button>
                      <button className="hero-tts-btn hero-tts-stop" onClick={() => {
                        if (ttsChapterPaused || ttsChapter) stopTTS()
                        if (ttsInfoPaused)  stopInfoTTS()
                        if (ttsCharPaused)  stopCharTTS()
                        if (audioPaused)    stopAudio()
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

              <div className="star-rating">
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => handleRating(n)}
                    className={`star ${rating >= n ? 'filled' : ''}`}>
                    <Star size={20} fill={rating >= n ? 'currentColor' : 'none'} />
                  </button>
                ))}
              </div>

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

              <div className="hero-actions-row">
                {statusInfo?.has_global_summary && (
                  <button className="export-pdf-btn" onClick={exportToPDF} title="Generar PDF del análisis completo">
                    <FileText size={16} />
                    Genera PDF del análisis
                  </button>
                )}
                
                {book.file_path && (
                  <button
                    className="export-pdf-btn"
                    title={`Descargar archivo original`}
                    onClick={async () => {
                      try {
                        const token = localStorage.getItem('bt_token')
                        const resp = await fetch(analysisAPI.downloadUrl(id), {
                          headers: { Authorization: `Bearer ${token}` }
                        })
                        if (!resp.ok) { toast.error('No se pudo descargar el archivo'); return }
                        const blob = await resp.blob()
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `${book.title}.${book.file_type || 'pdf'}`
                        a.click()
                        setTimeout(() => URL.revokeObjectURL(url), 5000)
                      } catch { toast.error('Error al descargar el archivo') }
                    }}
                  >
                    <BookOpen size={16} />
                    Descarga EPUB
                  </button>
                )}

                <label className="export-pdf-btn" style={{ cursor: 'pointer' }} title="Reemplazar archivo PDF/EPUB del libro">
                  <input type="file" accept=".pdf,.epub" style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files[0]; if (!file) return
                      if (!confirm('¿Reemplazar los archivos? El análisis se conservará.')) return
                      try {
                        toast('Subiendo archivo…', { icon: '⏳' })
                        await uploadToShell(id, file)
                        toast.success('Archivo subido. Identificando…')
                        load()
                      } catch { toast.error('Error al subir el archivo') }
                    }} />
                  <RefreshCw size={14} /> Reemplazar archivos
                </label>
              </div>
            </div>

            <button className="delete-btn" onClick={handleDelete} title="Eliminar libro" style={{alignSelf: 'flex-start', marginTop: '1rem'}}>
              <Trash2 size={20} />
            </button>
          </div>
          
        </div>
      </div>

      <div className=\"book-tabs\">
        {/* Selector de pestañas para móvil */}
        <div className=\"tabs-select-mobile\">
          <div className=\"tabs-select-wrapper\">
            <select 
              className=\"tabs-select\" 
              value={tab} 
              onChange={(e) => setTab(e.target.value)}
            >
              {TABS.map(t => {
                const isDone = t.statusKey ? (t.statusKey === 'status' ? true : statusInfo[t.statusKey]) : true
                const icon = {info:'📖',chapters:'📑',characters:'👤',summary:'🧠',mindmap:'🗺️',chat:'💬',podcast:'🎙️',refs:'🔗'}[t.id]||'•'
                const can = t.id === 'chat' ? (statusInfo.phase1_done) : true
                return (
                  <option key={t.id} value={t.id} disabled={!can}>
                    {t.label} {!isDone ? '(Pendiente)' : ''}
                  </option>
                )
              })}
            </select>
          </div>
        </div>

        {/* Sidebar de pestañas para desktop */}
        <div className=\"tabs-bar tabs-bar-desktop\">
          {TABS.map(t => {
            const Icon = t.icon
            const isDone = t.statusKey ? (t.statusKey === 'status' ? true : statusInfo[t.statusKey]) : true
            const isActivePhase = false // simplificado
            const can = t.id === 'chat' ? (statusInfo.phase1_done) : true
            
            let StatusIcon, statusClass;
            if (t.statusKey || t.id === 'refs') {
              if (isDone) {
                StatusIcon = CheckCircle;
                statusClass = 'status-done';
              } else if (isProcessing && (
                (t.id === 'info' && status.status === 'identifying') ||
                (t.id === 'chapters' && status.status === 'analyzing_structure') ||
                (t.id === 'characters' && status.status === 'summarizing') ||
                (t.id === 'summary' && status.status === 'summarizing') ||
                (t.id === 'podcast' && status.status === 'generating_podcast')
              )) {
                StatusIcon = Loader;
                statusClass = 'status-loading';
              } else {
                StatusIcon = AlertCircle;
                statusClass = 'status-pending';
              }
            }
            
            return (
              <button 
                key={t.id} 
                onClick={() => setTab(t.id)} 
                className={`tab-btn ${tab === t.id ? 'active' : ''} ${statusClass}`} 
                disabled={!can}
              >
                <div className="tab-btn-main">
                  <Icon size={18} />
                  <span className="tab-btn-text">{t.label}</span>
                </div>
                {StatusIcon && <StatusIcon size={14} className={`tab-status-icon ${statusClass}`} />}
              </button>
            )
          })}
        </div>

        <div className=\"tab-content\">
          {tab === 'info' && <InfoTab book={book} ttsPlaying={ttsInfoPlaying} ttsPaused={ttsInfoPaused} onPlay={playInfo} onPause={pauseInfoTTS} onResume={resumeInfoTTS} onStop={stopInfoTTS} status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} onCancel={handleCancelAnalysis} progressMsg={progressMsg} onDelete={handleDelete} />}
          {tab === 'chapters' && <ChaptersTab chapters={chapters} expanded={expandedChapter} setExpanded={setExpandedChapter} bookId={id} onChapterSummarized={load} ttsPlaying={ttsPlaying} ttsChapterPaused={ttsChapterPaused} ttsChapter={ttsChapter} ttsQueue={ttsQueue} onPlayChapter={(c) => { stopTTS(); stopCharTTS(true); stopInfoTTS(true); window.speechSynthesis.cancel(); ttsActiveRef.current = true; setTtsPlaying(true); speakItem([{id:c.id, title:c.title, text:chapterToText(c)}], 0); setTtsMode('single') }} onPlayFromChapter={(c) => playFromChapter(c, chapters)} onResume={resumeCurrentTTS} onStop={stopTTS} onPause={pauseTTS} status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} onCancel={handleCancelAnalysis} progressMsg={progressMsg} />}
          {tab === 'characters' && <CharactersTab characters={characters} ttsPlaying={ttsCharPlaying} ttsPaused={ttsCharPaused} ttsCharacter={ttsCharacter} onPlay={playCharacter} onPlayFrom={(c) => playFromCharacter(c, characters)} onPause={pauseCharTTS} onResume={resumeCharTTS} onStop={stopCharTTS} status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} bookId={id} onDone={load} />}
          {tab === 'summary' && <SummaryTab book={book} ttsPlaying={ttsInfoPlaying} ttsPaused={ttsInfoPaused} onPlay={() => playSummary(book)} status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} />}
          {tab === 'mindmap' && (
            <div className=\"prose-content\" style={{height:'80vh', display:'flex', flexDirection:'column'}}>
               <TabPhaseBar phase={5} label=\"Mapa Mental\" doneProp=\"has_mindmap\" canProp=\"has_global_summary\" status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} />
               <h2 style={{marginBottom:'1rem'}}>Mapa mental de ideas</h2>
               <div style={{flex:1, minHeight:0, background:'#fcfaf7', borderRadius:'12px', border:'1px solid var(--paper-dark)'}}>
                 <MindMap data={book.mindmap_data} />
               </div>
            </div>
          )}
          {tab === 'podcast' && (
            <div className=\"prose-content\">
               <TabPhaseBar phase={6} label=\"Podcast\" doneProp=\"podcast_done\" canProp=\"has_mindmap\" status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} />
               <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.5rem'}}>
                 <h2 style={{margin:0}}>Podcast del libro</h2>
               </div>
               {statusInfo.podcast_done ? (
                 <div className=\"podcast-player-card\">
                   <div className=\"podcast-visual\">
                     <div className={`wave-bar ${audioPlaying ? 'animate' : ''}`} />
                     <div className={`wave-bar ${audioPlaying ? 'animate' : ''}`} style={{animationDelay:'0.2s'}} />
                     <div className={`wave-bar ${audioPlaying ? 'animate' : ''}`} style={{animationDelay:'0.4s'}} />
                     <Mic size={48} color=\"var(--gold)\" style={{opacity:0.2, position:'absolute'}} />
                   </div>
                   <div className=\"podcast-controls\">
                     <button className=\"p-play-btn\" onClick={toggleAudio}>
                       {audioPlaying ? <Pause size={24} /> : <Play size={24} />}
                       {audioPlaying ? 'Pausar Podcast' : audioPaused ? 'Continuar Podcast' : 'Escuchar Podcast'}
                     </button>
                     {(audioPlaying || audioPaused) && (
                       <button className=\"p-stop-btn\" onClick={() => stopAudio()}>
                         <Square size={16} /> Parar
                       </button>
                     )}
                     <a href={analysisAPI.podcastAudioUrl(id)} download className=\"p-download-link\">
                        Descargar MP3
                     </a>
                   </div>
                   {book.podcast_script && (
                     <div className=\"podcast-script\">
                       <h3>Guión del episodio</h3>
                       <div className=\"script-content\">
                         {book.podcast_script.split('\n').map((line, i) => (
                           <p key={i} className={line.startsWith('Locutor') ? 'script-speaker' : ''}>{line}</p>
                         ))}
                       </div>
                     </div>
                   )}
                 </div>
               ) : (
                 <div className=\"empty-podcast\">
                   <Mic size={40} />
                   <p>El podcast aún no se ha generado.</p>
                   {statusInfo.has_mindmap && !isProcessing && (
                     <button className=\"phase-btn\" onClick={() => triggerPhase(6)}>Generar Podcast ahora</button>
                   )}
                 </div>
               )}
            </div>
          )}
          {tab === 'chat' && (
            <div className=\"prose-content\" style={{height:'80vh', display:'flex', flexDirection:'column'}}>
               <h2 style={{marginBottom:'1rem'}}>Diálogo Literario</h2>
               <div style={{flex:1, minHeight:0}}>
                 <LiteraryDialogue bookId={id} bookTitle={book.title} />
               </div>
            </div>
          )}
          {tab === 'refs' && (
            <div className=\"prose-content\">
               <h2>Referencias externas</h2>
               <div className=\"refs-grid\">
                 <a href={`https://www.google.com/search?q=libro+${encodeURIComponent(book.title)}+${encodeURIComponent(book.author || '')}`} target=\"_blank\" className=\"ref-card\">
                   <Box size={24} />
                   <span>Google Search</span>
                 </a>
                 <a href={`https://es.wikipedia.org/wiki/${encodeURIComponent(book.title)}`} target=\"_blank\" className=\"ref-card\">
                   <FileText size={24} />
                   <span>Wikipedia</span>
                 </a>
                 <a href={`https://www.goodreads.com/search?q=${encodeURIComponent(book.title)}`} target=\"_blank\" className=\"ref-card\">
                   <Star size={24} />
                   <span>Goodreads</span>
                 </a>
               </div>
            </div>
          )}
        </div>
      </div>
      {confirmModal}
      {coverPickerOpen && (
        <CoverPicker 
          book={book} 
          onClose={() => setCoverPickerOpen(false)} 
          onSelect={async (newUrl) => {
            await booksAPI.update(id, { cover_url: newUrl, cover_local: null })
            setCoverKey(prev => prev + 1)
            setCoverPickerOpen(false)
            load()
          }} 
        />
      )}
    </div>
  )
}

function ProcessingPipeline({ status, isProcessing, onTrigger, onCancel, book = {} }) {
  if (!status) return null
  const steps = [
    { label: 'Fase 1: Ficha y Autor',        sublabel: 'Identificación, sinopsis, autor',     done: status.phase1_done,        trigger: () => onTrigger(1), canTrigger: true },
    { label: 'Fase 2: Capítulos',             sublabel: 'Estructura y resúmenes individuales', done: status.phase2_done,        trigger: () => onTrigger(2), canTrigger: status.phase1_done },
    { label: 'Fase 3: Personajes',            sublabel: 'Análisis profundo uno a uno',         done: status.phase3_done,        trigger: () => onTrigger(3), canTrigger: status.phase2_done },
    { label: 'Fase 4: Resumen Global',        sublabel: 'Ensayo global del libro',             done: status.has_global_summary, trigger: () => onTrigger(4), canTrigger: status.phase3_done },
    { label: 'Fase 5: Mapa Mental',           sublabel: 'Estructura visual de ideas',          done: status.has_mindmap,        trigger: () => onTrigger(5), canTrigger: status.has_global_summary },
    { label: 'Fase 6: Podcast',               sublabel: 'Guión y audio sincronizado',          done: status.podcast_done,       trigger: () => onTrigger(6), canTrigger: status.has_mindmap },
  ]

  return (
    <div className=\"pipeline\">
      {steps.map((s, i) => (
        <div key={i} className={`pipeline-step ${s.done ? 'done' : ''}`}>
          {s.done
            ? <CheckCircle size={14} />
            : isProcessing && !s.done && i === steps.findIndex(x => !x.done)
              ? <Loader size={14} className=\"spin\" />
              : <div className=\"step-dot\" />
          }
          <span>
            {s.label}{s.sublabel && <span className=\"step-sublabel\"> ({s.sublabel})</span>}
            {isProcessing && i === steps.findIndex(x => !x.done) && status?.model && (
              <span className=\"pipeline-model-tag\"> [{status.model}]</span>
            )}
          </span>
          {s.canTrigger && !isProcessing && (
            <button className=\"trigger-btn\" onClick={s.trigger}>
              {s.done ? 'Repetir' : s.resumable ? 'Reanudar' : 'Iniciar'}
            </button>
          )}
          {isProcessing && i === steps.findIndex(x => !x.done) && (
            <button className=\"cancel-btn\" onClick={onCancel} title=\"Cancelar proceso\">
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

function HeroCover({ book }) {
  // src canónica del libro (cover_local o cover_url)
  const src = coverSrc(book)
  // fallback: portada obtenida externamente si src no existe o falla
  const [fallback, setFallback] = React.useState(null)
  const [fetchedKey, setFetchedKey] = React.useState(null)
  const [srcError, setSrcError] = React.useState(false)

  // Cuando src cambia (el padre recargó datos con nueva portada), resetear error
  React.useEffect(() => {
    setSrcError(false)
  }, [src])

  // Buscar portada externa SOLO si no hay src válida
  const fetchKey = `${book.isbn || ''}|${book.title || ''}`
  React.useEffect(() => {
    if (src && !srcError) return          // tenemos portada local — no buscar
    if (!book.isbn && !book.title) return
    if (fetchedKey === fetchKey && fallback) return  // ya buscamos esto

    let cancelled = false
    setFallback(null)
    setFetchedKey(fetchKey)

    const go = async () => {
      if (book.isbn) {
        try {
          const resp = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${book.isbn}`)
          const json = await resp.json()
          const img = json.items?.[0]?.volumeInfo?.imageLinks?.thumbnail
          if (img && !cancelled) { setFallback(img.replace('http:', 'https:')); return }
        } catch {}
      }
      // fallback por título si ISBN falla o no hay
      try {
        const resp = await fetch(`https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(book.title)}`)
        const json = await resp.json()
        const img = json.items?.[0]?.volumeInfo?.imageLinks?.thumbnail
        if (img && !cancelled) setFallback(img.replace('http:', 'https:'))
      } catch {}
    }
    go()
    return () => { cancelled = true }
  }, [src, srcError, book.isbn, book.title])

  if (!src || srcError) {
    if (fallback) return <img src={fallback} alt=\"Portada fallback\" onError={() => setFallback(null)} />
    return <div className=\"cover-ph-lg\"><BookOpen size={48} /></div>
  }

  return <img src={src} alt={book.title} onError={() => setSrcError(true)} />
}

function TabPhaseBar({ phase, label, doneProp, canProp, status, isProcessing, onTrigger, onCancel, progressMsg }) {
  const isDone = doneProp === 'status' ? true : status[doneProp]
  const canTrigger = canProp ? status[canProp] : true
  const isThisPhaseActive = isProcessing && (
    (phase === 1 && status.status === 'identifying') ||
    (phase === 2 && (status.status === 'analyzing_structure' || status.status === 'summarizing')) ||
    (phase === 6 && status.status === 'generating_podcast')
  )
  const btnLabel = isDone ? `Repetir ${label}` : `Iniciar ${label}`
  const btnClass = isDone ? 'secondary' : 'primary'

  return (
    <div className=\"tab-phase-bar\">
      {isProcessing ? (
        <div className=\"tab-phase-processing-wrap\">
          <span className=\"tab-phase-processing\">
            <Loader size={14} className=\"spin-icon\" />
            <span className=\"progress-msg-text\">{progressMsg || 'Procesando…'}</span>
            {status?.model && <span className=\"ai-model-tag\">{status.model}</span>}
          </span>
          <button className=\"tab-phase-cancel-btn\" onClick={onCancel} title=\"Detener análisis\">
            <X size={12} /> Detener
          </button>
        </div>
      ) : (
        <button
          className={`tab-phase-btn ${btnClass}`}
          onClick={() => onTrigger(phase)}
          disabled={!canTrigger}
          title={!canTrigger ? 'Completa la fase anterior primero' : undefined}
        >
          <RefreshCw size={13} />
          {btnLabel}
        </button>
      )}
    </div>
  )
}

function InfoTab({ book, ttsPlaying, ttsPaused, onPlay, onPause, onResume, onStop, status, isProcessing, onTrigger, onCancel, progressMsg, onDelete }) {
  const isDuplicate = status.status === 'duplicate'

  return (
    <div className=\"info-tab\">
      {isDuplicate && (
        <div className=\"duplicate-banner\">
          <div className=\"duplicate-banner-content\">
            <AlertCircle size={20} />
            <div>
              <strong>Posible libro duplicado</strong>
              <p>{status.error_msg || 'Este libro parece que ya existe en tu biblioteca.'}</p>
            </div>
          </div>
          <div className=\"duplicate-banner-actions\">
            <button className=\"dup-btn-ignore\" onClick={() => onTrigger(1, true)}>
              <RefreshCw size={14} /> Ignorar y analizar de todos modos
            </button>
            <button className=\"dup-btn-delete\" onClick={onDelete}>
              <Trash2 size={14} /> Eliminar este libro
            </button>
          </div>
        </div>
      )}
      <TabPhaseBar phase={1} label=\"Ficha y Autor\" doneProp=\"phase1_done\" canProp={null} status={status} isProcessing={isProcessing} onTrigger={onTrigger} onCancel={onCancel} progressMsg={progressMsg} />
      {book.synopsis && (
        <div className=\"info-tts-controls\">
          {!ttsPlaying && !ttsPaused && (
            <button className=\"info-tts-play-btn\" onClick={() => onPlay(book)}>
              <Play size={16} /> Reproducir ficha
            </button>
          )}
          {ttsPaused && (
            <span className=\"tts-indicator\" style={{color:'var(--mist)', fontSize:'0.85rem'}}>
              ⏸ Pausado — usa los controles de arriba para continuar
            </span>
          )}
        </div>
      )}

      {book.synopsis && <section><h3>Sinopsis</h3><p>{book.synopsis}</p></section>}
      {!book.synopsis && (
        <p className=\"empty-tab\">La sinopsis aún se está cargando…</p>
      )}
    </div>
  )
}

// ── SummaryTab ─────────────────────────────────────────────────────────────────
function SummaryTab({ book, ttsPlaying, ttsPaused, onPlay, onPause, onResume, onStop, status, isProcessing, onTrigger, progressMsg }) {
  return (
    <div className=\"prose-content\">
      <TabPhaseBar phase={4} label=\"Resumen Global\" doneProp=\"has_global_summary\" canProp=\"phase3_done\" status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} />
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1.25rem',flexWrap:'wrap',gap:'0.75rem'}}>
        <h2 style={{margin:0}}>Resumen global</h2>
        {book.global_summary && (
          <div className=\"info-tts-controls\" style={{marginBottom:0}}>
            {!ttsPlaying && !ttsPaused && (
              <button className=\"info-tts-play-btn\" onClick={onPlay}>
                <Play size={15}/> Escuchar
              </button>
            )}
            {ttsPaused && (
              <span className=\"tts-indicator\" style={{color:'var(--mist)', fontSize:'0.85rem'}}>
                ⏸ Pausado — usa los controles de arriba para continuar
              </span>
            )}
          </div>
        )}
      </div>
      <p>{book.global_summary || 'No disponible'}</p>
    </div>
  )
}


function ChaptersTab({ chapters, expanded, setExpanded, bookId, onChapterSummarized, ttsPlaying, ttsChapterPaused, ttsChapter, ttsQueue, onPlayChapter, onPlayFromChapter, onResume, onStop, onPause, status, isProcessing, onTrigger, onCancel, progressMsg }) {
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

  return (
    <div className=\"chapters-list\">
      <TabPhaseBar phase={2} label=\"Capítulos\" doneProp=\"phase2_done\" canProp=\"phase1_done\" status={status} isProcessing={isProcessing} onTrigger={onTrigger} onCancel={onCancel} progressMsg={progressMsg} />
      {chapters.map((ch, i) => (
        <div key={ch.id} className={`chapter-item ${expanded === ch.id ? 'open' : ''}`}>
          <button className=\"chapter-header\" onClick={() => setExpanded(expanded === ch.id ? null : ch.id)}>
            <span className=\"ch-num\">{String(i + 1).padStart(2, '0')}</span>
            <span className=\"ch-title\">{ch.title}</span>
            <div className=\"ch-meta\">
              {ch.summary_status === 'done'
                ? <span className=\"badge badge-green\">Resumido</span>
                : ch.summary_status === 'quota_exceeded'
                  ? <span className=\"badge badge-rust\" title={ch.summary || 'Cuota agotada'}>⏰ Cuota agotada</span>
                : ch.summary_status === 'skipped'
                  ? <span className=\"badge badge-slate\" title=\"Contenido bloqueado por filtros de seguridad\">⚠ Omitido</span>
                : ch.summary_status === 'processing'
                  ? <span className=\"badge badge-gold\">Procesando…</span>
                : ch.summary_status === 'error'
                  ? (
                    <button
                      className=\"summarize-ch-btn summarize-ch-btn--error\"
                      onClick={(e) => handleSummarize(e, ch)}
                      disabled={summarizing[ch.id]}
                      title=\"Error al resumir. Haz clic para reintentar\"
                    >
                      {summarizing[ch.id] ? '…' : '⚠️ Reintentar'}
                    </button>
                  )
                  : <button
                      className=\"summarize-ch-btn\"
                      onClick={(e) => handleSummarize(e, ch)}
                      disabled={summarizing[ch.id]}
                    >
                      {summarizing[ch.id] ? '…' : '+ Resumir'}
                    </button>
              }
              {ch.summary_status === 'done' && (
                <div className=\"ch-tts-btns\" onClick={e => e.stopPropagation()}>
                  {/* Botón play/pausa/continuar del capítulo */}
                  {ttsPlaying && ttsChapter === ch.id ? (
                    <button className=\"ch-tts-btn pause\" onClick={onPause} title=\"Pausar\">
                      <Pause size={12} />
                    </button>
                  ) : ttsChapterPaused && ttsChapter === ch.id ? (
                    <button className=\"ch-tts-btn play\" onClick={onResume} title=\"Continuar\">
                      <Play size={12} />
                    </button>
                  ) : (
                    <button className=\"ch-tts-btn play\" onClick={() => onPlayChapter(ch)} title=\"Reproducir solo este capítulo\">
                      <Play size={12} />
                    </button>
                  )}
                  {/* Stop — solo visible si este capítulo está activo (playing o paused) */}
                  {(ttsChapter === ch.id && (ttsPlaying || ttsChapterPaused)) && (
                    <button className=\"ch-tts-btn stop\" onClick={onStop} title=\"Parar reproducción\">
                      <Square size={12} />
                    </button>
                  )}
                  {/* Leer desde aquí — solo si no hay nada activo en este capítulo */}
                  {!(ttsChapter === ch.id && (ttsPlaying || ttsChapterPaused)) && (
                    <button className=\"ch-tts-btn play-from\" onClick={() => onPlayFromChapter(ch)} title=\"Leer desde aquí hasta el final\">
                      <Volume2 size={12} />
                    </button>
                  )}
                </div>
              )}
              {ch.page_start && <span className=\"ch-pages\">p. {ch.page_start}–{ch.page_end}</span>}
              {expanded === ch.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </button>
          <AnimatePresence>
            {expanded === ch.id && (
              <motion.div className=\"chapter-body\"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}>
                <div className=\"chapter-body-inner\">
                  {ch.summary
                    ? <p>{ch.summary}</p>
                    : <p className=\"muted\">Resumen no disponible para este capítulo</p>
                  }
                  {ch.key_events?.length > 0 ? (
                    <div className=\"key-events\">
                      <strong>Eventos clave:</strong>
                      <ul>{ch.key_events.map((e, i) => <li key={i}>{e}</li>)}</ul>
                    </div>
                  ) : ch.summary_status === 'done' && (
                    <div className=\"key-events-missing\">
                      <button 
                        className=\"btn-text-link\" 
                        onClick={(e) => handleSummarize(e, ch)}
                        disabled={summarizing[ch.id]}
                      >
                        {summarizing[ch.id] ? '⏳ Generando eventos clave...' : '✨ Generar eventos clave para este capítulo'}
                      </button>
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

function CharactersTab({ characters, ttsPlaying, ttsPaused, ttsCharacter, onPlay, onPlayFrom, onPause, onResume, onStop, status, isProcessing, onTrigger, progressMsg, bookId, onDone }) {
  const [analyzing, setAnalyzing] = React.useState({})
  
  const handleReanalyze = async (char) => {
    setAnalyzing(s => ({ ...s, [char.id]: true }))
    try {
      await characterAPI.analyze(bookId, char.id)
      toast.success(`Analizando a ${char.name}...`)
      // Polling simple para este personaje
      const poll = setInterval(async () => {
         const { data } = await booksAPI.get(bookId)
         const c = data.characters?.find(x => x.id === char.id)
         // Aquí dependemos de que el worker actualice algo, summuary o similar
         // Por ahora, recargamos el global tras 10s
      }, 5000)
      setTimeout(() => { clearInterval(poll); setAnalyzing(s => ({ ...s, [char.id]: false })); onDone() }, 15000)
    } catch {
       setAnalyzing(s => ({ ...s, [char.id]: false }))
       toast.error(\"Error al reanalizar\")
    }
  }

  return (
    <div className=\"characters-tab\">
      <TabPhaseBar phase={3} label=\"Personajes\" doneProp=\"phase3_done\" canProp=\"phase2_done\" status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} />
      <div className=\"characters-header\">
        <div className=\"characters-info\">
          <h2 style={{margin:0}}>Personajes</h2>
          <span className=\"characters-count\">{characters.length} encontrados</span>
        </div>
        <div className=\"characters-actions\">
          {ttsPlaying || ttsPaused ? (
             <div className=\"tts-indicator\">
                {ttsPlaying ? <Loader size={12} className=\"spin\" /> : <Pause size={12} />}
                <span>{ttsCharacter}</span>
                <button className=\"tts-control-btn stop\" onClick={() => onStop()} title=\"Parar\"><Square size={10} /></button>
             </div>
          ) : (
            characters.length > 0 && <button className=\"reanalyze-chars-btn\" onClick={() => onPlayFrom(characters[0])}><Play size={12} /> Leer todos</button>
          )}
          {!isProcessing && characters.length > 0 && (
             <button className=\"reanalyze-chars-btn\" onClick={() => onTrigger(3)}>Reanalizar todos</button>
          )}
        </div>
      </div>

      <div className=\"characters-grid\">
        {characters.map(char => (
          <div key={char.id} className={`char-card ${ttsCharacter === char.name ? 'active' : ''}`}>
            <div className=\"char-avatar\">
               {char.name.charAt(0)}
            </div>
            <div className=\"char-content\">
              <div className=\"char-header-row\">
                <h3>{char.name}</h3>
                <div className=\"char-btns\">
                   {ttsCharacter === char.name ? (
                      ttsPlaying ? <button className=\"char-inline-btn\" onClick={onPause}><Pause size={14} /></button>
                                : <button className=\"char-inline-btn\" onClick={onResume}><Play size={14} /></button>
                   ) : (
                      <button className=\"char-inline-btn\" onClick={() => onPlay(char)} title=\"Escuchar ficha\"><Play size={14} /></button>
                   )}
                   <button className=\"char-inline-btn\" onClick={() => onPlayFrom(char, characters)} title=\"Leer desde aquí\"><Volume2 size={14} /></button>
                   <button className=\"char-inline-btn\" onClick={() => handleReanalyze(char)} disabled={analyzing[char.id]} title=\"Reanalizar este personaje\">
                     <RefreshCw size={14} className={analyzing[char.id] ? 'spin' : ''} />
                   </button>
                </div>
              </div>
              <p className=\"char-role\">{char.role}</p>
              <p className=\"char-desc\">{char.description}</p>
              
              <div className=\"char-details-grid\">
                {char.personality && (
                  <div className=\"char-detail-box\">
                    <strong>Personalidad</strong>
                    <p>{char.personality}</p>
                  </div>
                )}
                {char.arc && (
                  <div className=\"char-detail-box\">
                    <strong>Evolución</strong>
                    <p>{char.arc}</p>
                  </div>
                )}
              </div>

              {char.relationships && Object.keys(char.relationships).length > 0 && (
                <div className=\"char-relas\">
                  <strong>Relaciones:</strong>
                  <div className=\"relas-tags\">
                    {Object.entries(char.relationships).map(([name, rel]) => (
                      <span key={name} className=\"rela-tag\"><b>{name}</b>: {rel}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Box({ size, ...props }) {
  return (
    <svg
      xmlns=\"http://www.w3.org/2000/svg\"
      width={size}
      height={size}
      viewBox=\"0 0 24 24\"
      fill=\"none\"
      stroke=\"currentColor\"
      strokeWidth=\"2\"
      strokeLinecap=\"round\"
      strokeLinejoin=\"round\"
      {...props}
    >
      <path d=\"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z\" />
      <path d=\"m3.3 7 8.7 5 8.7-5\" />
      <path d=\"M12 22V12\" />
    </svg>
  )
}
