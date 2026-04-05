import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  BookOpen, User, List, Brain, Map, Mic, Star, ExternalLink,
  Play, Pause, Square, ChevronDown, ChevronUp, Loader, CheckCircle,
  ArrowLeft, Edit3, Trash2, AlertCircle, Volume2, VolumeX, PlayCircle, FileText, RefreshCw
} from 'lucide-react'
import { booksAPI, analysisAPI, chapterAPI, characterAPI, uploadToShell, reanalyzeCharacters, queueAPI } from '../utils/api'
import MindMap from '../components/MindMap'
import { coverSrc } from '../components/BookCover'
import CoverPicker from '../components/CoverPicker'
import './BookPage.css'

const TABS = [
  { id: 'info',       label: 'Ficha',          icon: BookOpen     },
  { id: 'chapters',   label: 'Capítulos',       icon: List         },
  { id: 'characters', label: 'Personajes',      icon: User         },
  { id: 'summary',    label: 'Resumen global',  icon: Brain        },
  { id: 'mindmap',    label: 'Mapa mental',     icon: Map          },
  { id: 'podcast',    label: 'Podcast',         icon: Mic          },
  { id: 'refs',       label: 'Referencias',     icon: ExternalLink },
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

  const triggerPhase = async (phase) => {
    try {
      if (phase === 1) await analysisAPI.triggerPhase1(id)
      else if (phase === 2) await analysisAPI.triggerPhase2(id)
      else if (phase === 3) await analysisAPI.triggerPhase3(id)
      else if (phase === 4) await analysisAPI.triggerPhase4(id)
      else if (phase === 5) await analysisAPI.triggerPhase5(id)
      else if (phase === 6) await analysisAPI.triggerPodcast(id)
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
      <div className="book-hero">
        <button className="back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Biblioteca
        </button>

        <div className="hero-content">
          <div className="hero-cover" style={{ cursor: 'pointer', position: 'relative' }} onClick={() => setCoverPickerOpen(true)} title="Haz clic para cambiar la portada">
            <HeroCover key={coverKey} book={book} />
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
                {(ttsPlaying || ttsInfoPlaying || ttsCharPlaying || audioPlaying) ? (  // alguno reproduciendo
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

            {status?.has_global_summary && (
              <button className="export-pdf-btn" onClick={exportToPDF} title="Exportar análisis completo">
                <FileText size={16} />
                Genera PDF del análisis
              </button>
            )}
            {book.file_path && (
              <button
                className="export-pdf-btn download-file-btn"
                title={`Descargar ${book.file_type?.toUpperCase() || 'archivo'} original`}
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
                <FileText size={16} />
                Descargar {book.file_type?.toUpperCase() || 'Libro'}
              </button>
            )}
            {/* Pipeline movido al tab Análisis */}
            {!isShell && (
              <label className="export-pdf-btn" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }} title="Reemplazar archivo PDF/EPUB del libro">
                <input type="file" accept=".pdf,.epub" style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files[0]; if (!file) return
                    if (!confirm('¿Reemplazar el archivo? El análisis se conservará.')) return
                    try {
                      toast('Subiendo archivo…', { icon: '⏳' })
                      await uploadToShell(id, file)
                      toast.success('Archivo subido. Identificando…')
                      load()
                    } catch { toast.error('Error al subir el archivo') }
                  }} />
                📎 Reemplazar archivo
              </label>
            )}
          </div>

          <button className="delete-btn" onClick={handleDelete} title="Eliminar libro">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="book-tabs">
        <div className="tabs-bar tabs-bar-desktop">
          {TABS.map(t => (
            <button key={t.id}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              disabled={isShell && t.id !== 'info'}
            >
              <t.icon size={15} strokeWidth={1.5} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="tabs-select-wrapper tabs-select-mobile">
          <select className="tabs-select" value={tab} onChange={(e) => setTab(e.target.value)}>
            {TABS.map(t => {
              const disabled = (isShell && t.id !== 'info')
              const icon = {info:'📖',chapters:'📑',characters:'👤',summary:'🧠',mindmap:'🗺️',podcast:'🎙️',refs:'🔗'}[t.id]||'•'
              return <option key={t.id} value={t.id} disabled={disabled}>{icon} {t.label}</option>
            })}
          </select>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab} className="tab-content"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

            {tab === 'info' && <InfoTab book={book} ttsPlaying={ttsInfoPlaying} ttsPaused={ttsInfoPaused} onPlay={() => playInfo(book)} onPause={pauseInfoTTS} onResume={resumeInfoTTS} onStop={() => stopInfoTTS()} status={status} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} />}

            {tab === 'chapters' && (
              <ChaptersTab chapters={chapters} expanded={expandedChapter} setExpanded={setExpandedChapter} bookId={id} onChapterSummarized={load} ttsPlaying={ttsPlaying} ttsChapterPaused={ttsChapterPaused} ttsChapter={ttsChapter} ttsQueue={ttsQueue} onResume={resumeCurrentTTS} onPlayChapter={(ch) => { stopTTS(true); const q=Object.assign([{id:ch.id,title:ch.title,text:chapterToText(ch)}],{_mode:'single'}); ttsQueueRef.current=q; ttsIndexRef.current=0; setTtsQueue(q); setTtsIndex(0); setTtsMode('single'); setTtsChapterPaused(false); ttsActiveRef.current=true; setTtsPlaying(true); setTtsChapter(ch.id); speakItem(q,0); }} onPlayFromChapter={(ch) => playFromChapter(ch, chapters)} onStop={stopTTS} onPause={pauseTTS} status={status} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} />
            )}

            {tab === 'characters' && <CharactersTab characters={characters} bookId={id} onReanalyzed={load} status={status} isProcessing={isProcessing} onTrigger={triggerPhase} ttsPlaying={ttsCharPlaying} ttsCharPaused={ttsCharPaused} ttsCharacter={ttsCharacter} onPlayCharacter={playCharacter} onPlayFromCharacter={playFromCharacter} onStop={stopCharTTS} onPause={pauseCharTTS} onResume={resumeCharTTS} progressMsg={progressMsg} />}

            {tab === 'summary' && (
              <SummaryTab
                book={book}
                ttsPlaying={ttsInfoPlaying}
                ttsPaused={ttsInfoPaused}
                onPlay={() => playSummary(book)}
                onPause={pauseInfoTTS}
                onResume={resumeInfoTTS}
                onStop={() => stopInfoTTS()}
                status={status}
                isProcessing={isProcessing}
                onTrigger={triggerPhase}
                progressMsg={progressMsg}
              />
            )}

            {tab === 'mindmap' && (
              <div>
                <TabPhaseBar phase={5} label="Mapa Mental" doneProp="has_mindmap" canProp="has_global_summary" status={status} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} />
                {book.mindmap_data
                  ? <MindMap data={book.mindmap_data} />
                  : <p className="empty-tab">Mapa mental no disponible</p>}
              </div>
            )}

            {tab === 'refs' && <RefsTab book={book} />}

            {tab === 'podcast' && (
              <PodcastTab
                book={book}
                playing={audioPlaying}
                onToggle={toggleAudio}
                status={status}
                isProcessing={isProcessing}
                onTrigger={triggerPhase}
                progressMsg={progressMsg}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      {confirmModal}
      {coverPickerOpen && (
        <CoverPicker
          book={book}
          onSelect={async (url) => {
            try {
              const res = await booksAPI.updateCover(id, url)
              setData(prev => prev ? {
                ...prev,
                book: { ...prev.book, cover_url: res.data.cover_url, cover_local: res.data.cover_local }
              } : prev)
              setCoverKey(k => k + 1)
              toast.success('Portada actualizada')
              await load()
            } catch {
              toast.error('Error al guardar la portada')
            }
            setCoverPickerOpen(false)
          }}
          onUpload={async (file) => {
            // Crear preview local ANTES de subir — evita depender del timing de nginx
            const previewUrl = URL.createObjectURL(file)
            try {
              const res = await booksAPI.uploadCover(id, file)
              setData(prev => prev ? {
                ...prev,
                book: { ...prev.book, cover_local: res.data.cover_local, cover_url: previewUrl }
              } : prev)
              setCoverKey(k => k + 1)
              toast.success('Portada actualizada')
              await load()                      // tras load(), cover_url del server reemplaza el blob
              URL.revokeObjectURL(previewUrl)   // liberar memoria
            } catch {
              URL.revokeObjectURL(previewUrl)
              toast.error('Error al subir la imagen')
            }
            setCoverPickerOpen(false)
          }}
          onClose={() => setCoverPickerOpen(false)}
        />
      )}
    </div>
  )
}

// ── Sub-components del original ────────────────────────────────────────────────

// Barra de acción por fase — se muestra al pie de cada tab
function TabPhaseBar({ phase, label, doneProp, canProp, status, isProcessing, onTrigger, progressMsg }) {
  if (!status) return null
  const isDone     = status[doneProp]
  const canTrigger = canProp ? !!status[canProp] : true
  return (
    <div className="tab-phase-bar">
      {isProcessing ? (
        <span className="tab-phase-processing">
          <Loader size={14} className="spin-icon" />
          {progressMsg || 'Procesando…'}
        </span>
      ) : (
        <button
          className={`tab-phase-btn ${isDone ? 'done' : 'pending'}`}
          onClick={() => onTrigger(phase)}
          disabled={!canTrigger}
          title={!canTrigger ? 'Completa la fase anterior primero' : undefined}
        >
          <RefreshCw size={13} />
          {isDone ? `Repetir ${label}` : `Iniciar ${label}`}
        </button>
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
          const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${book.isbn}&maxResults=1`)
          const d = await r.json()
          const links = d.items?.[0]?.volumeInfo?.imageLinks
          if (links) {
            const url = (links.extraLarge || links.large || links.thumbnail || '')
              .replace('zoom=2', 'zoom=1').replace('zoom=3', 'zoom=1').replace('http://', 'https://')
            if (url && !cancelled) { setFallback(url); return }
          }
        } catch {}
      }
      if (book.title) {
        try {
          const q = encodeURIComponent(`${book.title} ${book.author || ''}`.trim())
          const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`)
          const d = await r.json()
          const links = d.items?.[0]?.volumeInfo?.imageLinks
          if (links) {
            const url = (links.extraLarge || links.large || links.thumbnail || '')
              .replace('zoom=2', 'zoom=1').replace('zoom=3', 'zoom=1').replace('http://', 'https://')
            if (url && !cancelled) { setFallback(url); return }
          }
        } catch {}
      }
      if (book.isbn && !cancelled) setFallback(`https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`)
    }
    go()
    return () => { cancelled = true }
  }, [src, srcError, fetchKey])

  const imgSrc = (src && !srcError) ? src : (fallback || null)

  if (imgSrc) return (
    <img src={imgSrc} alt={book.title}
      onError={() => {
        if (src && !srcError) setSrcError(true)
        else setFallback(null)
      }}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
  )
  return (
    <div className="cover-ph-lg">
      <BookOpen size={48} strokeWidth={1} />
    </div>
  )
}


function InfoTab({ book, ttsPlaying, ttsPaused, onPlay, onPause, onResume, onStop, status, isProcessing, onTrigger, progressMsg }) {
  return (
    <div className="info-tab">
      <TabPhaseBar phase={1} label="Ficha y Autor" doneProp="phase1_done" canProp={null} status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} />
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
      {!book.synopsis && (
        <p className="empty-tab">La sinopsis aún se está cargando…</p>
      )}
    </div>
  )
}

// ── SummaryTab ─────────────────────────────────────────────────────────────────
function SummaryTab({ book, ttsPlaying, ttsPaused, onPlay, onPause, onResume, onStop, status, isProcessing, onTrigger, progressMsg }) {
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


function ChaptersTab({ chapters, expanded, setExpanded, bookId, onChapterSummarized, ttsPlaying, ttsChapterPaused, ttsChapter, ttsQueue, onPlayChapter, onPlayFromChapter, onResume, onStop, onPause, status, isProcessing, onTrigger, progressMsg }) {
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
      <TabPhaseBar phase={2} label="Capítulos" doneProp="phase2_done" canProp="phase1_done" status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} />
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
                : ch.summary_status === 'error'
                  ? (
                    <button
                      className="summarize-ch-btn summarize-ch-btn--error"
                      onClick={(e) => handleSummarize(e, ch)}
                      disabled={summarizing[ch.id]}
                      title="Error al resumir. Haz clic para reintentar"
                    >
                      {summarizing[ch.id] ? '…' : '⚠️ Reintentar'}
                    </button>
                  )
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
                  {/* Botón play/pausa/continuar del capítulo */}
                  {ttsPlaying && ttsChapter === ch.id ? (
                    <button className="ch-tts-btn pause" onClick={onPause} title="Pausar">
                      <Pause size={12} />
                    </button>
                  ) : ttsChapterPaused && ttsChapter === ch.id ? (
                    <button className="ch-tts-btn play" onClick={onResume} title="Continuar">
                      <Play size={12} />
                    </button>
                  ) : (
                    <button className="ch-tts-btn play" onClick={() => onPlayChapter(ch)} title="Reproducir solo este capítulo">
                      <Play size={12} />
                    </button>
                  )}
                  {/* Stop — solo visible si este capítulo está activo (playing o paused) */}
                  {(ttsChapter === ch.id && (ttsPlaying || ttsChapterPaused)) && (
                    <button className="ch-tts-btn stop" onClick={onStop} title="Parar reproducción">
                      <Square size={12} />
                    </button>
                  )}
                  {/* Leer desde aquí — solo si no hay nada activo en este capítulo */}
                  {!(ttsChapter === ch.id && (ttsPlaying || ttsChapterPaused)) && (
                    <button className="ch-tts-btn play-from" onClick={() => onPlayFromChapter(ch)} title="Leer desde aquí hasta el final">
                      <Volume2 size={12} />
                    </button>
                  )}
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

function CharactersTab({ characters, bookId, onReanalyzed, status, isProcessing, onTrigger, ttsPlaying, ttsCharPaused, ttsCharacter, onPlayCharacter, onPlayFromCharacter, onStop, onPause, onResume, progressMsg }) {
  const [reanalyzing, setReanalyzing] = React.useState(false)
  const [analyzingChar, setAnalyzingChar] = React.useState({}) // { [charId]: true }

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

  const handleAnalyzeSingle = async (char) => {
    setAnalyzingChar(s => ({ ...s, [char.id]: true }))
    try {
      await characterAPI.reanalyze(bookId, char.id)
      toast(`Analizando ${char.name}…`, { icon: '⏳' })
      // Poll hasta que los datos cambien (máx 2 min)
      const startDesc = char.description
      const poll = setInterval(async () => {
        try {
          const { data } = await booksAPI.get(bookId)
          const updated = data.characters?.find(c => c.id === char.id)
          if (updated && updated.description !== startDesc) {
            clearInterval(poll)
            setAnalyzingChar(s => ({ ...s, [char.id]: false }))
            onReanalyzed?.()
            toast.success(`${char.name} actualizado`)
          }
        } catch { /* ignorar errores de polling */ }
      }, 4000)
      setTimeout(() => {
        clearInterval(poll)
        setAnalyzingChar(s => ({ ...s, [char.id]: false }))
      }, 120000)
    } catch {
      setAnalyzingChar(s => ({ ...s, [char.id]: false }))
      toast.error(`Error al analizar ${char.name}`)
    }
  }

  return (
    <div className="characters-tab">
      <TabPhaseBar phase={3} label="Personajes" doneProp="phase3_done" canProp="phase2_done" status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} />
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
          {ttsCharPaused && (
            <span className="tts-indicator" style={{color:'var(--mist)'}}>
              ⏸ Pausado — {ttsCharacter}
            </span>
          )}
        </div>
        <div className="characters-actions">
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
                        <button
                          className="char-tts-btn"
                          onClick={() => handleAnalyzeSingle(char)}
                          disabled={!!analyzingChar[char.id]}
                          title="Reanalizar este personaje individualmente"
                          style={{ opacity: analyzingChar[char.id] ? 0.6 : 1 }}
                        >
                          {analyzingChar[char.id]
                            ? <Loader size={14} className="spin-icon" />
                            : <RefreshCw size={14} />}
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
            <a href={refs.wikipedia} target="_blank" rel="noopener noreferrer" className="ref-link"><ExternalLink size={16} /><span>Wikipedia</span></a>
            <a href={refs.goodreads} target="_blank" rel="noopener noreferrer" className="ref-link"><Star size={16} /><span>Goodreads</span></a>
            <a href={refs.youtube} target="_blank" rel="noopener noreferrer" className="ref-link"><Play size={16} /><span>YouTube</span></a>
            <a href={refs.amazon} target="_blank" rel="noopener noreferrer" className="ref-link"><ExternalLink size={16} /><span>Amazon</span></a>
            <a href={refs.googleBooks} target="_blank" rel="noopener noreferrer" className="ref-link"><BookOpen size={16} /><span>Google Books</span></a>
            <a href={refs.library} target="_blank" rel="noopener noreferrer" className="ref-link"><BookOpen size={16} /><span>WorldCat</span></a>
          </div>
        </div>
        {book.author && (
          <div className="refs-section">
            <h4><User size={18} />Sobre el autor</h4>
            <div className="refs-links">
              <a href={refs.authorWikipedia} target="_blank" rel="noopener noreferrer" className="ref-link"><ExternalLink size={16} /><span>Wikipedia (autor)</span></a>
              <a href={refs.authorGoodreads} target="_blank" rel="noopener noreferrer" className="ref-link"><Star size={16} /><span>Goodreads (autor)</span></a>
              <a href={refs.authorYoutube} target="_blank" rel="noopener noreferrer" className="ref-link"><Play size={16} /><span>Entrevistas YouTube</span></a>
              <a href={refs.authorX} target="_blank" rel="noopener noreferrer" className="ref-link"><ExternalLink size={16} /><span>X / Twitter</span></a>
              <a href={refs.authorInstagram} target="_blank" rel="noopener noreferrer" className="ref-link"><ExternalLink size={16} /><span>Instagram</span></a>
            </div>
          </div>
        )}
      </div>
      <p className="refs-note">💡 Estos enlaces se generan automáticamente.</p>
    </div>
  )
}

function PodcastTab({ book, playing, onToggle, status, isProcessing, onTrigger, progressMsg }) {
  const hasScript = book?.podcast_script
  const hasAudio  = book?.podcast_audio_path

  // Parsea el guión en líneas ANA / CARLOS
  const parseDialogue = (script) => {
    if (!script) return []
    return script
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .reduce((acc, line) => {
        const m = line.match(/^(ANA|CARLOS)[:\s]+(.+)/i)
        if (m) {
          acc.push({ speaker: m[1].toUpperCase(), text: m[2].trim() })
        } else if (acc.length && line && !line.match(/^[A-Z]{2,}:/)) {
          // continuación de la línea anterior
          acc[acc.length - 1].text += ' ' + line
        }
        return acc
      }, [])
  }

  const lines = parseDialogue(hasScript ? book.podcast_script : '')

  return (
    <div className="podcast-tab">
      <TabPhaseBar phase={6} label="Podcast" doneProp="podcast_done" canProp="has_mindmap" status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} />

      {/* ── Player ── */}
      {hasAudio && (
        <div className="podcast-player">
          <button className="podcast-play-btn" onClick={onToggle}>
            {playing ? <Pause size={22} /> : <Play size={22} />}
            <span>{playing ? 'Pausar' : 'Reproducir podcast'}</span>
          </button>
          <span className="podcast-duration-hint">~ 5 min · ANA & CARLOS</span>
        </div>
      )}

      {/* ── Guión conversación ── */}
      {lines.length > 0 && (
        <div className="podcast-script">
          <h3 className="podcast-script-title">
            <Volume2 size={16} /> Guión de la conversación
          </h3>

          <div className="podcast-hosts">
            <span className="podcast-host ana">🎙 ANA</span>
            <span className="podcast-host carlos">CARLOS 🎙</span>
          </div>

          <div className="podcast-dialogue">
            {lines.map((line, i) => (
              <div
                key={i}
                className={`pd-bubble ${line.speaker === 'ANA' ? 'pd-ana' : 'pd-carlos'}`}
              >
                <span className="pd-speaker">{line.speaker}</span>
                <p className="pd-text">{line.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasScript && !hasAudio && (
        <div className="empty-tab">
          <Mic size={48} strokeWidth={1} />
          <p>El podcast aún no se ha generado.</p>
        </div>
      )}
    </div>
  )
}

// ── AnalysisTab ────────────────────────────────────────────────────────────────
function AnalysisTab({ status, isProcessing, isShell, book, bookId, onTrigger, onCancel, onUpload }) {
  const uploadHandler = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      toast('Subiendo archivo…', { icon: '⏳' })
      await uploadToShell(bookId, file)
      toast.success('Archivo subido. Identificando…')
      onUpload()
    } catch {
      toast.error('Error al subir el archivo')
    }
  }

  return (
    <div className="analysis-tab">
      {/* Subir / reemplazar archivo */}
      <div className="analysis-upload">
        {isShell ? (
          <div className="shell-upload-area" style={{marginBottom:'1.5rem'}}>
            <span className="shell-label">Solo ficha — sube el PDF/EPUB para analizar</span>
            <label className="shell-upload-btn">
              <input type="file" accept=".pdf,.epub" style={{display:'none'}} onChange={uploadHandler} />
              📎 Subir PDF/EPUB
            </label>
          </div>
        ) : (
          <label className="attach-file-btn" style={{marginBottom:'1.5rem',display:'inline-flex'}}>
            <input type="file" accept=".pdf,.epub" style={{display:'none'}}
              onChange={async (e) => {
                const file = e.target.files[0]; if (!file) return
                if (!confirm('¿Reemplazar el archivo? El análisis se conservará.')) return
                await uploadHandler(e)
              }} />
            📎 Reemplazar archivo PDF/EPUB
          </label>
        )}
      </div>

      {/* Pipeline de fases */}
      {!isShell && status && (
        <ProcessingPipeline
          status={status}
          isProcessing={isProcessing}
          onTrigger={onTrigger}
          onCancel={onCancel}
          book={book}
        />
      )}
      {!status && <p className="empty-tab">Cargando estado del análisis…</p>}
    </div>
  )
}

