import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  BookOpen, User, List, Brain, Map, Mic, Star, ExternalLink,
  Play, Pause, Square, ChevronDown, ChevronUp, Loader, CheckCircle,
  ArrowLeft, Edit3, Trash2, AlertCircle, Volume2, VolumeX, PlayCircle, FileText, RefreshCw, X, MessageSquare, Download
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
  { id: 'podcast',    label: 'Podcast',         icon: Mic,          statusKey: 'podcast_done' },
  { id: 'chat',       label: 'Diálogo',         icon: MessageSquare,statusKey: 'status' },
  { id: 'refs',       label: 'Referencias',     icon: ExternalLink, statusKey: 'status' },
]

const PROCESSING_STATUSES = ['queued', 'identifying', 'analyzing_structure', 'summarizing', 'generating_podcast']

// ── Modal de confirmación propio (evita el checkbox del window.confirm nativo) ──
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

  const handleDownloadAudio = async () => {
    if (!statusInfo?.podcast_done) return toast.error('El podcast aún no está listo')
    try {
      const token = localStorage.getItem('bt_token')
      const resp = await fetch(analysisAPI.podcastAudioUrl(id), {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!resp.ok) throw new Error('Error al descargar')
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${book.title} - Podcast.mp3`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error('No se pudo descargar el audio')
    }
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
    if (!confirm(`¿Eliminar "${data?.book?.title}"?`)) return
    await booksAPI.delete(id)
    navigate('/')
  }

  if (loading) return (
    <div className="book-loading">
      <Loader size={28} className="spin" strokeWidth={1.5} />
      <p>Cargando información del libro...</p>
    </div>
  )

  const activeData = data || prevData
  const book = activeData?.book || {}
  const statusInfo = status || {}
  
  if (!activeData || !book.id) return (
    <div className="book-loading" style={{flexDirection:"column",gap:"1rem"}}>
      <p style={{color:"var(--slate)"}}>No se pudo encontrar el libro o no tienes permiso para verlo.</p>
      <button onClick={() => navigate("/")} style={{background:"var(--ink)",color:"var(--paper)",border:"none",padding:"0.5rem 1rem",borderRadius:"4px",cursor:"pointer"}}>
        Volver a la biblioteca
      </button>
    </div>
  )
  const chapters = activeData?.chapters || []
  const characters = activeData?.characters || []
  const isProcessing = PROCESSING_STATUSES.includes(statusInfo.status)

  return (
    <div className="book-page">
      <div className="book-hero">
        <button className="back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Biblioteca
        </button>

        <div className="hero-content">
          <div className="hero-cover" style={{ cursor: 'pointer', position: 'relative' }} onClick={() => setCoverPickerOpen(true)} title="Haz clic para cambiar la portada">
            <HeroCover book={book} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: '0.7rem', textAlign: 'center', padding: '4px 0', opacity: 0, transition: 'opacity 0.2s' }}
              className="cover-change-hint">
              ✏ Cambiar
            </div>
          </div>

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

            <div className="hero-actions-container">
              {statusInfo?.has_global_summary && (
                <button className="hero-action-btn pdf-btn" onClick={exportToPDF} title="Generar PDF del análisis completo">
                  <FileText size={16} />
                  <span>Genera PDF</span>
                </button>
              )}

              {book.file_path && (
                <button
                  className="hero-action-btn epub-btn"
                  title="Descargar archivo original"
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
                  <span>Descarga EPUB</span>
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
                      load()
                    } catch { toast.error('Error al subir el archivo') }
                  }} />
                <RefreshCw size={14} /> 
                <span>Reemplazar archivos</span>
              </label>
            </div>
          </div>

          <button className="delete-btn" onClick={handleDelete} title="Eliminar libro" style={{ alignSelf: 'flex-start' }}>
            <Trash2 size={20} />
          </button>
        </div>
      </div>

      <div className="book-tabs">
        <div className="tabs-select-mobile">
          <div className="tabs-select-wrapper">
            <select 
              className="tabs-select" 
              value={tab} 
              onChange={(e) => setTab(e.target.value)}
            >
              {TABS.map(t => {
                const isDone = t.statusKey ? (t.statusKey === 'status' ? true : statusInfo[t.statusKey]) : true
                const iconMap = {info:'📖',chapters:'📑',characters:'👤',summary:'🧠',mindmap:'🗺️',chat:'💬',podcast:'🎙️',refs:'🔗'}
                const statusSymbol = isDone ? ' ✅' : ' ⏳'
                return (
                  <option key={t.id} value={t.id}>
                    {iconMap[t.id] || '•'} {t.label}{statusSymbol}
                  </option>
                )
              })}
            </select>
            <ChevronDown className="tabs-select-arrow" size={20} />
          </div>
        </div>

        <div className="tabs-bar tabs-bar-desktop">
          {TABS.map(t => {
            const Icon = t.icon
            const isDone = t.statusKey ? (t.statusKey === 'status' ? true : statusInfo[t.statusKey]) : true
            
            let StatusIcon, statusClass;
            const isProcessingThis = isProcessing && (
              (t.id === 'info' && statusInfo.status === 'identifying') ||
              (t.id === 'chapters' && (statusInfo.status === 'analyzing_structure' || statusInfo.status === 'summarizing' || !statusInfo.chapters_summarized)) ||
              (t.id === 'characters' && statusInfo.status === 'analyzing_characters') ||
              (t.id === 'summary' && statusInfo.status === 'summarizing') ||
              (t.id === 'podcast' && statusInfo.status === 'generating_podcast')
            )

            const showDone = isDone && (t.id !== 'chapters' || statusInfo.chapters_summarized)

            if (t.statusKey || t.id === 'refs') {
              if (showDone && !isProcessingThis) {
                StatusIcon = CheckCircle;
                statusClass = 'status-done';
              } else if (isProcessingThis) {
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

        <div className="tab-content">
          {tab === 'info' && <InfoTab book={book} ttsPlaying={ttsInfoPlaying} ttsPaused={ttsInfoPaused} onPlay={playInfo} onPause={pauseInfoTTS} onResume={resumeInfoTTS} onStop={stopInfoTTS} status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} onCancel={handleCancelAnalysis} progressMsg={progressMsg} onDelete={handleDelete} />}
          {tab === 'chapters' && <ChaptersTab chapters={chapters} expanded={expandedChapter} setExpanded={setExpandedChapter} bookId={id} onChapterSummarized={load} ttsPlaying={ttsPlaying} ttsChapterPaused={ttsChapterPaused} ttsChapter={ttsChapter} onPlayChapter={(c) => { stopTTS(); stopCharTTS(true); stopInfoTTS(true); window.speechSynthesis.cancel(); ttsActiveRef.current = true; setTtsPlaying(true); speakItem([{id:c.id, title:c.title, text:chapterToText(c)}], 0); setTtsMode('single') }} onPlayFromChapter={(c) => playFromChapter(c, chapters)} onResume={resumeCurrentTTS} onStop={stopTTS} onPause={pauseTTS} status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} onCancel={handleCancelAnalysis} progressMsg={progressMsg} />}
          {tab === 'characters' && <CharactersTab characters={characters} ttsPlaying={ttsCharPlaying} ttsPaused={ttsCharPaused} ttsCharacter={ttsCharacter} onPlay={playCharacter} onPlayFrom={(c) => playFromCharacter(c, characters)} onPause={pauseCharTTS} onResume={resumeCharTTS} onStop={stopCharTTS} status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} bookId={id} onDone={load} />}
          {tab === 'summary' && <SummaryTab book={book} ttsPlaying={ttsInfoPlaying} ttsPaused={ttsInfoPaused} onPlay={() => playSummary(book)} status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} />}
          {tab === 'mindmap' && (
            <div className="prose-content" style={{height:'80vh', display:'flex', flexDirection:'column'}}>
               <TabPhaseBar phase={5} label="Mapa Mental" doneProp="has_mindmap" canProp="has_global_summary" status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} />
               <h2 style={{marginBottom:'1rem'}}>Mapa mental de ideas</h2>
               <div style={{flex:1, minHeight:0, background:'#fcfaf7', borderRadius:'12px', border:'1.5px solid var(--paper-dark)'}}>
                 <MindMap data={book.mindmap_data} />
               </div>
            </div>
          )}
          {tab === 'podcast' && (
            <div className="prose-content">
                <TabPhaseBar phase={6} label="Podcast" doneProp="podcast_done" canProp="has_mindmap" status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} />
                {statusInfo.podcast_done ? (
                  <div className="podcast-content">
                    <div className="podcast-script-header">
                      <h2 style={{margin:0}}>Episodio Generado</h2>
                      <div style={{display:'flex', gap:'0.75rem'}}>
                        <button className="download-mp3-btn" onClick={handleDownloadAudio} title="Descargar podcast">
                           <Download size={16} />
                           <span>Descargar MP3</span>
                        </button>
                        <button className={`download-mp3-btn ${audioPlaying ? 'active' : ''}`} onClick={toggleAudio}>
                          {audioPlaying ? <Pause size={18} /> : <Play size={18} />}
                          <span>{audioPlaying ? 'Pausar' : audioPaused ? 'Continuar' : 'Escuchar'}</span>
                        </button>
                      </div>
                    </div>

                    <div className="podcast-player-card" style={{background:'var(--ink)', borderRadius:'12px', padding:'2.5rem', marginBottom:'2.5rem', display:'flex', alignItems:'center', gap:'2.5rem', boxShadow:'var(--shadow-lg)'}}>
                       <div className={`podcast-visual ${audioPlaying ? 'playing' : ''}`} style={{width:'100px', height:'100px', background:'rgba(255,255,255,0.05)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', border:'2px solid var(--gold)', position:'relative', boxShadow: audioPlaying ? '0 0 20px var(--gold)' : 'none', transition: 'all 0.5s' }}>
                          <Mic size={40} color="var(--gold)" />
                       </div>
                       <div style={{flex:1}}>
                          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:'1rem'}}>
                            <div>
                              <div style={{fontSize:'0.75rem', color:'var(--gold)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.15em', marginBottom:'0.25rem'}}>Podcast Literario</div>
                              <div style={{fontSize:'1.1rem', color:'white', fontWeight:600}}>{book.title}</div>
                            </div>
                            <div style={{fontSize:'0.85rem', color:'var(--mist)'}}>{audioPlaying ? 'Reproduciendo...' : audioPaused ? 'En pausa' : 'Listo para escuchar'}</div>
                          </div>
                          <div style={{height:'6px', background:'rgba(255,255,255,0.1)', borderRadius:'10px', overflow:'hidden', position:'relative'}}>
                             <div className={audioPlaying ? 'animate-progress' : ''} style={{height:'100%', background:'var(--gold)', width: audioPlaying ? '100%' : '0%', transition: audioPlaying ? 'width 300s linear' : 'none', boxShadow:'0 0 10px var(--gold)'}} />
                          </div>
                       </div>
                    </div>

                    {book.podcast_script && (
                      <div className="podcast-script-card">
                        <div className="podcast-script-header">
                          <h3 style={{display:'flex', alignItems:'center', gap:'0.75rem'}}>
                            <FileText size={20} color="var(--gold)" />
                            Guión del Episodio
                          </h3>
                        </div>
                        <div className="script-content">
                          {book.podcast_script.split('\n').map((line, i) => {
                            if (!line.trim()) return <br key={i} />
                            const isSpeaker = line.includes(':')
                            return (
                              <p key={i} style={{ marginBottom: '1.25rem', opacity: isSpeaker ? 1 : 0.8, background: isSpeaker && line.startsWith('ANA') ? 'rgba(201,169,110,0.05)' : 'transparent', padding: isSpeaker ? '0.5rem 1rem' : '0', borderRadius: '8px', borderLeft: isSpeaker ? `3px solid ${line.startsWith('ANA') ? 'var(--gold)' : 'var(--ink)'}` : 'none' }}>
                                {isSpeaker ? <strong>{line.split(':')[0]}:</strong> : null}
                                {isSpeaker ? line.split(':')[1] : line}
                              </p>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="empty-podcast" style={{ textAlign: 'center', padding: '4rem 2rem', background: 'white', borderRadius: '12px', border: '1.5px solid var(--paper-dark)' }}>
                    <Mic size={48} color="var(--mist)" style={{ marginBottom: '1rem', opacity: 0.5 }} />
                    <p style={{ color: 'var(--mist)', marginBottom: '1.5rem' }}>El podcast aún no se ha generado.</p>
                    {statusInfo.has_mindmap && !isProcessing && (
                      <button className="reanalyze-btn" style={{ margin: '0 auto' }} onClick={() => triggerPhase(6)}>
                        <RefreshCw size={14} />
                        <span>Generar Podcast ahora</span>
                      </button>
                    )}
                  </div>
                )}
            </div>
          )}
          {tab === 'chat' && (
            <div className="prose-content" style={{height:'80vh', display:'flex', flexDirection:'column'}}>
                <h2 style={{marginBottom:'1rem'}}>Diálogo Literario</h2>
                <div style={{flex:1, minHeight:0}}>
                  <LiteraryDialogue bookId={id} bookTitle={book.title} />
                </div>
            </div>
          )}
          {tab === 'refs' && (
            <div className="prose-content">
                <h2>Referencias externas</h2>
                <div className="refs-grid">
                  <a href={`https://www.google.com/search?q=libro+${encodeURIComponent(book.title)}+${encodeURIComponent(book.author || '')}`} target="_blank" className="ref-card">
                    <Box size={24} />
                    <span>Google Search</span>
                  </a>
                  <a href={`https://es.wikipedia.org/wiki/${encodeURIComponent(book.title)}`} target="_blank" className="ref-card">
                    <FileText size={24} />
                    <span>Wikipedia</span>
                  </a>
                  <a href={`https://www.goodreads.com/search?q=${encodeURIComponent(book.title)}`} target="_blank" className="ref-card">
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

function ProcessingPipeline({ status, isProcessing, onTrigger, onCancel }) {
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
    <div className="pipeline">
      {steps.map((s, i) => (
        <div key={i} className={`pipeline-step ${s.done ? 'done' : ''}`}>
          {s.done
            ? <CheckCircle size={14} />
            : isProcessing && !s.done && i === steps.findIndex(x => !x.done)
              ? <Loader size={14} className="spin" />
              : <div className="step-dot" />
          }
          <span>
            {s.label}{s.sublabel && <span className="step-sublabel"> ({s.sublabel})</span>}
            {isProcessing && i === steps.findIndex(x => !x.done) && status?.model && (
              <span className="pipeline-model-tag"> [{status.model}]</span>
            )}
          </span>
          {s.canTrigger && !isProcessing && (
            <button className="trigger-btn" onClick={s.trigger}>
              {s.done ? 'Repetir' : 'Iniciar'}
            </button>
          )}
          {isProcessing && i === steps.findIndex(x => !x.done) && (
            <button className="cancel-btn" onClick={onCancel} title="Cancelar proceso">
              Cancelar
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function HeroCover({ book }) {
  const src = coverSrc(book)
  const [fallback, setFallback] = React.useState(null)
  const [srcError, setSrcError] = React.useState(false)

  React.useEffect(() => { setSrcError(false) }, [src])

  React.useEffect(() => {
    if (src && !srcError) return
    if (!book.isbn && !book.title) return
    let cancelled = false
    const go = async () => {
      if (book.isbn) {
        try {
          const resp = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${book.isbn}`)
          const json = await resp.json()
          const img = json.items?.[0]?.volumeInfo?.imageLinks?.thumbnail
          if (img && !cancelled) { setFallback(img.replace('http:', 'https:')); return }
        } catch {}
      }
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
    if (fallback) return <img src={fallback} alt="Portada fallback" onError={() => setFallback(null)} />
    return <div className="cover-ph-lg"><BookOpen size={48} /></div>
  }
  return <img src={src} alt={book.title} onError={() => setSrcError(true)} />
}

function TabPhaseBar({ phase, label, doneProp, canProp, status, isProcessing, onTrigger, onCancel, progressMsg }) {
  const isDone = doneProp === 'status' ? true : status[doneProp]
  const canTrigger = canProp ? status[canProp] : true

  // Lógica para determinar si ESTA fase específica se está procesando
  const phaseStatusMap = {
    1: ['identifying'],
    2: ['analyzing_structure', 'summarizing'], // Incluimos summarising porque a veces se solapa
    3: ['analyzing_characters'],
    4: ['summarizing'],
    6: ['generating_podcast']
  }
  
  const isThisPhaseProcessing = isProcessing && (phaseStatusMap[phase]?.includes(status.status) || false)

  const labels = {
    1: 'Repetir Ficha y Autor',
    2: 'Reanalizar Capítulos',
    3: 'Reanalizar Personajes',
    4: 'Rehacer Resumen',
    5: 'Rehacer Mapa',
    6: 'Rehacer Podcast'
  }

  return (
    <div className="tab-phase-bar" style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', borderBottom: '1.5px solid var(--paper-dark)', paddingBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
        {isDone ? <CheckCircle size={20} className="status-done" /> : <div className="phase-dot">{phase}</div>}
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--ink)' }}>Fase {phase}: {label}</h3>
          {isThisPhaseProcessing && (
            <div style={{display:'flex', alignItems:'center', gap:'0.5rem', marginTop:'0.2rem'}}>
               <Loader size={12} className="spin" style={{color:'var(--gold)'}} />
               <span style={{fontSize:'0.75rem', color: 'var(--gold)', fontWeight: 600}}>{progressMsg || 'Procesando…'}</span>
               {status?.model && <span className="ai-model-tag">{status.model}</span>}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        {isThisPhaseProcessing && (
          <button className="cancel-btn" onClick={onCancel} style={{margin:0}}>Detener</button>
        )}
        {canTrigger && !isThisPhaseProcessing && (
          <button 
            className="reanalyze-btn" 
            style={{ margin: 0 }} 
            onClick={() => onTrigger(phase, isDone)}
          >
            <RefreshCw size={14} />
            <span>{isDone ? labels[phase] : `Iniciar ${label}`}</span>
          </button>
        )}
      </div>
    </div>
  )
}

function InfoTab({ book, ttsPlaying, ttsPaused, onPlay, onPause, onResume, onStop, status, isProcessing, onTrigger, onCancel, progressMsg, onDelete }) {
  const isDuplicate = status.status === 'duplicate'
  return (
    <div className="info-tab">
      {isDuplicate && (
        <div className="duplicate-banner">
          <div className="duplicate-banner-content">
            <AlertCircle size={20} />
            <div>
              <strong>Posible libro duplicado</strong>
              <p>{status.error_msg || 'Este libro parece que ya existe en tu biblioteca.'}</p>
            </div>
          </div>
          <div className="duplicate-banner-actions">
            <button className="dup-btn-ignore" onClick={() => onTrigger(1, true)}>
              <RefreshCw size={14} /> Ignorar y analizar de todos modos
            </button>
            <button className="dup-btn-delete" onClick={onDelete}>
              <Trash2 size={14} /> Eliminar este libro
            </button>
          </div>
        </div>
      )}
      <TabPhaseBar phase={1} label="Ficha y Autor" doneProp="phase1_done" canProp={null} status={status} isProcessing={isProcessing} onTrigger={onTrigger} onCancel={onCancel} progressMsg={progressMsg} />
      {book.synopsis && (
        <div className="info-tts-controls">
          {!ttsPlaying && !ttsPaused && (
            <button className="info-tts-play-btn" onClick={() => onPlay(book)}>
              <Play size={16} /> Reproducir ficha
            </button>
          )}
          {ttsPaused && (
            <span className="tts-indicator" style={{color:'var(--mist)', fontSize:'0.85rem'}}>
              ⏸ Pausado — usa los controles de arriba para continuar
            </span>
          )}
        </div>
      )}
      {book.synopsis && <section><h3>Sinopsis</h3><p>{book.synopsis}</p></section>}
      {!book.synopsis && <p className="empty-tab">La sinopsis aún se está cargando…</p>}
    </div>
  )
}

function SummaryTab({ book, ttsPlaying, ttsPaused, onPlay, status, isProcessing, onTrigger, progressMsg }) {
  return (
    <div className="prose-content">
      <TabPhaseBar phase={4} label="Resumen Global" doneProp="has_global_summary" canProp="phase3_done" status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} />
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1.25rem',flexWrap:'wrap',gap:'0.75rem'}}>
        <h2 style={{margin:0}}>Resumen global</h2>
        {book.global_summary && (
          <div className="info-tts-controls" style={{marginBottom:0}}>
            {!ttsPlaying && !ttsPaused && (
              <button className="info-tts-play-btn" onClick={onPlay}>
                <Play size={15}/> Escuchar
              </button>
            )}
            {ttsPaused && (
              <span className="tts-indicator" style={{color:'var(--mist)', fontSize:'0.85rem'}}>
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

function ChaptersTab({ chapters, expanded, setExpanded, bookId, onChapterSummarized, ttsPlaying, ttsChapterPaused, ttsChapter, onPlayChapter, onPlayFromChapter, onResume, onStop, onPause, status, isProcessing, onTrigger, onCancel, progressMsg }) {
  const [summarizing, setSummarizing] = React.useState({})
  const handleSummarize = async (e, chapter) => {
    e.stopPropagation()
    setSummarizing(s => ({ ...s, [chapter.id]: true }))
    try {
      await chapterAPI.summarize(bookId, chapter.id)
      toast('Resumiendo capítulo...', { icon: '⏳' })
      let poll = setInterval(async () => {
        const { data } = await booksAPI.get(bookId)
        const ch = data.chapters?.find(c => c.id === chapter.id)
        if (ch?.summary_status === 'done') { clearInterval(poll); setSummarizing(s => ({ ...s, [chapter.id]: false })); onChapterSummarized?.(); toast.success('Capítulo resumido') }
      }, 3000)
    } catch { setSummarizing(s => ({ ...s, [chapter.id]: false })); toast.error('Error al resumir') }
  }

  return (
    <div className="chapters-list">
      <TabPhaseBar phase={2} label="Capítulos" doneProp="phase2_done" canProp="phase1_done" status={status} isProcessing={isProcessing} onTrigger={onTrigger} onCancel={onCancel} progressMsg={progressMsg} />
      {chapters.map((ch, i) => (
        <div key={ch.id} className={`chapter-item ${expanded === ch.id ? 'open' : ''}`}>
          <button className="chapter-header" onClick={() => setExpanded(expanded === ch.id ? null : ch.id)}>
            <span className="ch-num">{String(i + 1).padStart(2, '0')}</span>
            <span className="ch-title">{ch.title}</span>
            <div className="ch-meta">
              {ch.summary_status === 'done' ? <span className="badge badge-green">Resumido</span> : <button className="summarize-ch-btn" onClick={(e) => handleSummarize(e, ch)} disabled={summarizing[ch.id]}>{summarizing[ch.id] ? '…' : '+ Resumir'}</button>}
              {ch.summary_status === 'done' && (
                <div className="ch-tts-btns" onClick={e => e.stopPropagation()}>
                  {ttsChapter === ch.id && ttsPlaying ? <button className="ch-tts-btn pause" onClick={onPause}><Pause size={12} /></button> : <button className="ch-tts-btn play" onClick={() => onPlayChapter(ch)}><Play size={12} /></button>}
                </div>
              )}
              {expanded === ch.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </button>
          <AnimatePresence>{expanded === ch.id && (
            <motion.div className="chapter-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <div className="chapter-body-inner">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '2rem' }}>
                  <div style={{ flex: 1 }}>
                    {(!ch.summary || ch.summary.length < 50) ? (
                      <div className="empty-chapter-warning" style={{ 
                        display: 'flex', 
                        gap: '1rem', 
                        padding: '1.5rem', 
                        background: 'rgba(239, 68, 68, 0.05)', 
                        border: '1px solid rgba(239, 68, 68, 0.2)', 
                        borderRadius: '12px',
                        marginBottom: '1rem' 
                      }}>
                        <AlertCircle size={24} style={{ color: '#ef4444', flexShrink: 0 }} />
                        <div>
                          <strong style={{ display: 'block', color: '#ef4444', marginBottom: '0.25rem' }}>🤖 Capitulo sin resumen válido</strong>
                          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--mist)' }}>
                            La IA parece haber fallado al procesar este capítulo (resumen demasiado corto o vacío). 
                            Pulsa el botón de la derecha para intentar reanalizarlo.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p style={{ whiteSpace: 'pre-wrap', color: 'var(--mist)', lineHeight: '1.6' }}>
                        {ch.summary}
                      </p>
                    )}
                    {Array.isArray(ch.key_events) && ch.key_events.length > 0 && (
                      <div className="key-events" style={{ marginTop: '1.5rem' }}>
                        <strong>Eventos clave:</strong>
                        <ul style={{ marginTop: '0.5rem' }}>
                          {ch.key_events.map((e, i) => (
                            <li key={i} style={{ marginBottom: '0.4rem' }}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  
                  {/* Botón de re-análisis específico por capítulo */}
                  <button 
                    className="reanalyze-btn" 
                    style={{ flexShrink: 0, margin: 0, fontSize: '0.8rem', padding: '0.4rem 0.8rem' }} 
                    onClick={(e) => handleSummarize(e, ch)} 
                    disabled={summarizing[ch.id]}
                    title="Forzar a la IA a resumir este capítulo de nuevo"
                  >
                    <RefreshCw size={12} className={summarizing[ch.id] ? 'spin' : ''} />
                    <span>{summarizing[ch.id] ? 'Procesando…' : 'Reanalizar capítulo'}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}</AnimatePresence>
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
      setTimeout(() => { setAnalyzing(s => ({ ...s, [char.id]: false })); onDone() }, 10000)
    } catch { setAnalyzing(s => ({ ...s, [char.id]: false })); toast.error('Error') }
  }

  return (
    <div className="characters-tab">
      <TabPhaseBar phase={3} label="Personajes" doneProp="phase3_done" canProp="phase2_done" status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} />
      <div className="characters-header">
        <div className="characters-info"><h2>Personajes</h2><span className="characters-count">{characters.length} encontrados</span></div>
        <div className="characters-actions">
           {!isProcessing && characters.length > 0 && <button className="reanalyze-btn" style={{marginBottom:0}} onClick={() => onTrigger(3)}><RefreshCw size={14} /><span>Reanalizar todos</span></button>}
        </div>
      </div>
      <div className="characters-grid">
        {characters.map(char => (
          <div key={char.id} className="char-card">
            <div className="char-avatar">{char.name.charAt(0)}</div>
            <div className="char-content">
              <div className="char-header-row"><h3>{char.name}</h3><div className="char-btns"><button className="char-inline-btn" onClick={() => onPlay(char)}><Play size={14} /></button><button className="char-inline-btn" onClick={() => handleReanalyze(char)} disabled={analyzing[char.id]}><RefreshCw size={14} className={analyzing[char.id] ? 'spin' : ''}/></button></div></div>
              <p className="char-role">{char.role}</p><p className="char-desc">{char.description}</p>
              <div className="char-details-grid">
                {char.personality && <div className="char-detail-box"><strong>Personalidad</strong><p>{char.personality}</p></div>}
                {char.key_moments && char.key_moments.length > 0 && <div className="char-detail-box"><strong>Momentos clave</strong><ul className="char-list">{char.key_moments.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
                {char.arc && <div className="char-detail-box"><strong>Evolución</strong><p>{char.arc}</p></div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Box({ size, ...props }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
    </svg>
  )
}
