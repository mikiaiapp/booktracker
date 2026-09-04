import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  BookOpen, User, List, Brain, Map, Mic, Star, ExternalLink,
  Play, Pause, Square, ChevronDown, ChevronUp, Loader, CheckCircle,
  ArrowLeft, Edit3, Trash2, AlertCircle, Volume2, VolumeX, PlayCircle, FileText, RefreshCw, X, MessageSquare, Download, Share2, GitBranch, Layout
} from 'lucide-react'
import { booksAPI, analysisAPI, chapterAPI, characterAPI, uploadToShell, reanalyzeCharacters, queueAPI, socialAPI } from '../utils/api'
import { useAuthStore } from '../store/authStore'
import MindMap from '../components/MindMap'
import LiteraryDialogue from '../components/LiteraryDialogue'
import CharacterNetwork from '../components/CharacterNetwork'
import InteractiveTimeline from '../components/InteractiveTimeline'
import { coverSrc } from '../components/BookCover'
import CoverPicker from '../components/CoverPicker'
import './BookPage.css'



const SILENCE_URL = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

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

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Tab Crash:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="error-boundary-fallback" style={{ textAlign: 'center', padding: '4rem', background: 'rgba(255,0,0,0.05)', borderRadius: '16px', border: '1px solid rgba(255,0,0,0.1)' }}>
          <AlertCircle size={48} color="#ef4444" style={{ marginBottom: '1rem' }} />
          <h2 style={{ color: 'var(--ink)' }}>Algo salió mal en esta sección</h2>
          <p style={{ color: 'var(--mist)', marginBottom: '2rem' }}>{this.state.error?.toString()}</p>
          <button className="reanalyze-btn" onClick={() => window.location.reload()} style={{ margin: '0 auto' }}>
            <RefreshCw size={14} /> Recargar Aplicación
          </button>
        </div>
      );
    }
    return this.props.children;
  }
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
  const [showShareModal, setShowShareModal] = useState(false)

  const user = useAuthStore(s => s.user)
  const ttsSpeed = parseFloat(user?.tts_speed || '1.0') || 1.0

  const activeData = data || prevData
  const book = activeData?.book || {}
  const statusInfo = status || {}
  const chapters = activeData?.chapters || []
  const characters = activeData?.characters || []
  const isProcessing = PROCESSING_STATUSES.includes(statusInfo.status)


  const [ttsPlaying,       setTtsPlaying]       = useState(false)
  const [ttsChapterPaused, setTtsChapterPaused] = useState(false)
  const [ttsChapter,       setTtsChapter]       = useState(null)
  const storageKey        = `tts_pos_${id}`

  const [ttsCharPlaying, setTtsCharPlaying] = useState(false)
  const [ttsCharPaused,  setTtsCharPaused]  = useState(false)
  const [ttsCharacter, setTtsCharacter] = useState(null)
  const charStorageKey = `tts_char_pos_${id}`

  const [ttsInfoPlaying, setTtsInfoPlaying] = useState(false)
  const [ttsInfoPaused,  setTtsInfoPaused]  = useState(false)
  const infoStorageKey = `tts_info_pos_${id}`
  const podcastStorageKey = `podcast_pos_${id}`
  const audioRef = React.useRef(null)
  const ttsAudioRef = React.useRef(null)

  const initTtsAudio = (type, chapterId = null, characterId = null, seekTime = null) => {
    const el = ttsAudioRef.current
    if (!el) return null

    // Detener podcast si está sonando
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause()
      setAudioPlaying(false)
      setAudioPaused(true)
    }

    const token = localStorage.getItem('bt_token')
    let url = `${analysisAPI.ttsAudioUrl(id)}?type=${type}&token=${encodeURIComponent(token)}`
    if (chapterId) url += `&chapter_id=${chapterId}`
    if (characterId) url += `&character_id=${characterId}`

    const absUrl = new URL(url, window.location.origin).href

    // Determinar punto de lectura objetivo si no se especificó directamente
    let targetTime = seekTime
    if (targetTime === null || targetTime === undefined) {
      if (type === 'chapter') {
        const saved = localStorage.getItem(storageKey)
        if (saved) {
          try {
            const p = JSON.parse(saved)
            if (p.chapterId === chapterId) targetTime = p.currentTime || 0
          } catch {}
        }
      } else if (type === 'character') {
        const saved = localStorage.getItem(charStorageKey)
        if (saved) {
          try {
            const p = JSON.parse(saved)
            if (p.characterId === characterId) targetTime = p.currentTime || 0
          } catch {}
        }
      } else if (type === 'synopsis' || type === 'global_summary') {
        const saved = localStorage.getItem(infoStorageKey)
        if (saved) {
          try {
            const p = JSON.parse(saved)
            if (p.type === type) targetTime = p.currentTime || 0
          } catch {}
        }
      }
    }

    if (el.src !== absUrl) {
      el.pause()
      el._pendingSeekTime = targetTime || 0
      el._isRestoring = Boolean(targetTime && targetTime > 0)
      el.src = absUrl
      el.load()
    } else {
      if (targetTime !== null && targetTime !== undefined && Math.abs(el.currentTime - targetTime) > 0.5) {
        el.currentTime = targetTime
      }
    }

    if (!el._hasListeners) {
      el._hasListeners = true
      
      el.addEventListener('play', () => {
        toast.dismiss('tts-load')
        el.playbackRate = ttsSpeed
        const params = new URLSearchParams(el.src.split('?')[1])
        const t = params.get('type')

        if (t === 'chapter') {
          setTtsPlaying(true)
          setTtsChapterPaused(false)
        } else if (t === 'character') {
          setTtsCharPlaying(true)
          setTtsCharPaused(false)
        } else if (t === 'synopsis' || t === 'global_summary') {
          setTtsInfoPlaying(true)
          setTtsInfoPaused(false)
        }

        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing'
        }
      })

      el.addEventListener('pause', () => {
        const params = new URLSearchParams(el.src.split('?')[1])
        const t = params.get('type')

        if (t === 'chapter') {
          setTtsPlaying(false)
          setTtsChapterPaused(true)
        } else if (t === 'character') {
          setTtsCharPlaying(false)
          setTtsCharPaused(true)
        } else if (t === 'synopsis' || t === 'global_summary') {
          setTtsInfoPlaying(false)
          setTtsInfoPaused(true)
        }

        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused'
        }
        syncPlaybackToDB(true)
      })

      el.addEventListener('ended', () => {
        const params = new URLSearchParams(el.src.split('?')[1])
        const t = params.get('type')
        const chId = params.get('chapter_id')

        // Comportamiento de lista de reproducción para capítulos
        if (t === 'chapter') {
          const currentIndex = chapters.findIndex(c => c.id === chId)
          if (currentIndex !== -1 && currentIndex < chapters.length - 1) {
            const nextChapter = chapters[currentIndex + 1]
            setTtsChapter(nextChapter.id)
            const nextEl = initTtsAudio('chapter', nextChapter.id)
            if (nextEl) {
              nextEl.play().catch(err => console.warn(err))
              return
            }
          }
        }

        setTtsPlaying(false)
        setTtsChapterPaused(false)
        setTtsChapter(null)

        setTtsCharPlaying(false)
        setTtsCharPaused(false)
        setTtsCharacter(null)

        setTtsInfoPlaying(false)
        setTtsInfoPaused(false)

        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'none'
          navigator.mediaSession.metadata = null
        }

        if (t === 'chapter') {
          localStorage.removeItem(storageKey)
        } else if (t === 'character') {
          localStorage.removeItem(charStorageKey)
        } else if (t === 'synopsis' || t === 'global_summary') {
          localStorage.removeItem(infoStorageKey)
          localStorage.removeItem(infoStorageKey + '_type')
        }
        syncPlaybackToDB(true)
      })

      el.addEventListener('timeupdate', () => {
        if (el._isRestoring) return
        if (el.currentTime <= 0.1 && el._pendingSeekTime > 0) return

        const params = new URLSearchParams(el.src.split('?')[1])
        const t = params.get('type')
        const chId = params.get('chapter_id')
        const charId = params.get('character_id')

        if (t === 'chapter') {
          const progress = { chapterId: chId, currentTime: el.currentTime }
          localStorage.setItem(storageKey, JSON.stringify(progress))
        } else if (t === 'character') {
          const progress = { characterId: charId, currentTime: el.currentTime }
          localStorage.setItem(charStorageKey, JSON.stringify(progress))
        } else if (t === 'synopsis' || t === 'global_summary') {
          const progress = { type: t, currentTime: el.currentTime }
          localStorage.setItem(infoStorageKey, JSON.stringify(progress))
        }
        syncPlaybackToDB(false)
      })

      el.addEventListener('loadedmetadata', () => {
        el.playbackRate = ttsSpeed
        const params = new URLSearchParams(el.src.split('?')[1])
        const t = params.get('type')
        const chId = params.get('chapter_id')
        const charId = params.get('character_id')

        let savedTime = el._pendingSeekTime
        if (savedTime === undefined || savedTime === null) {
          if (t === 'chapter') {
            const saved = localStorage.getItem(storageKey)
            if (saved) {
              const parsed = JSON.parse(saved)
              if (parsed.chapterId === chId) savedTime = parsed.currentTime || 0
            }
          } else if (t === 'character') {
            const saved = localStorage.getItem(charStorageKey)
            if (saved) {
              const parsed = JSON.parse(saved)
              if (parsed.characterId === charId) savedTime = parsed.currentTime || 0
            }
          } else if (t === 'synopsis' || t === 'global_summary') {
            const saved = localStorage.getItem(infoStorageKey)
            if (saved) {
              const parsed = JSON.parse(saved)
              if (parsed.type === t) savedTime = parsed.currentTime || 0
            }
          }
        }

        if (savedTime > 0 && isFinite(el.duration) && savedTime < el.duration) {
          el.currentTime = savedTime
        }
        el._pendingSeekTime = null
        el._isRestoring = false
        updateTtsMediaSession(t, chId, charId)
      })

      el.addEventListener('error', () => {
        toast.dismiss('tts-load')
        if (!el.src || el.src === '' || el.src === window.location.href) return
        console.warn("TTS audio element error:", el.error)
        const params = new URLSearchParams(el.src.split('?')[1] || '')
        const t = params.get('type')
        const chId = params.get('chapter_id')
        const charId = params.get('character_id')

        let fallbackText = ''
        if (t === 'chapter') {
          const ch = chapters.find(c => c.id === chId)
          if (ch) fallbackText = `${ch.title}. ${ch.summary || ''}`
        } else if (t === 'character') {
          const char = characters.find(c => c.id === charId)
          if (char) fallbackText = `Personaje: ${char.name}. ${char.role || ''}. ${char.description || ''}.`
        } else if (t === 'synopsis') {
          fallbackText = book?.synopsis || ''
        } else if (t === 'global_summary') {
          fallbackText = book?.global_summary || ''
        }

        toast.error("No se pudo cargar el audio del servidor. Comprueba la configuración de OpenAI.", { id: 'tts-error' })
        if (t === 'chapter') {
          setTtsPlaying(false)
          setTtsChapter(null)
          setTtsChapterPaused(false)
        } else if (t === 'character') {
          setTtsCharPlaying(false)
          setTtsCharacter(null)
          setTtsCharPaused(false)
        } else {
          setTtsInfoPlaying(false)
          setTtsInfoPaused(false)
        }
      })
    }

    return el
  }

  const updateTtsMediaSession = (type, chapterId = null, characterId = null) => {
    if (!('mediaSession' in navigator)) return

    let title = 'Lectura'
    let artist = book?.author || 'BookTracker'
    
    if (type === 'chapter') {
      const ch = chapters.find(c => c.id === chapterId)
      title = ch ? ch.title : 'Lectura de Capítulo'
    } else if (type === 'character') {
      const char = characters.find(c => c.id === characterId)
      title = `Personaje: ${char ? char.name : 'Estudio'}`
    } else if (type === 'synopsis') {
      title = 'Sinopsis'
    } else if (type === 'global_summary') {
      title = 'Resumen Global'
    }

    const relativeSrc = coverSrc(book) || '/default-cover.png'
    const absoluteCoverUrl = relativeSrc.startsWith('http')
      ? relativeSrc
      : `${window.location.origin}${relativeSrc}`

    navigator.mediaSession.metadata = new MediaMetadata({
      title: title,
      artist: artist,
      album: book?.title || 'Lectura de Libro',
      artwork: [
        { src: absoluteCoverUrl, sizes: '192x192', type: 'image/png' },
        { src: absoluteCoverUrl, sizes: '512x512', type: 'image/png' }
      ]
    })

    navigator.mediaSession.setActionHandler('play', () => {
      if (ttsAudioRef.current) ttsAudioRef.current.play().catch(() => {})
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      if (ttsAudioRef.current) ttsAudioRef.current.pause()
    })
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const el = ttsAudioRef.current
      if (el) {
        const offset = details.seekOffset || 10
        el.currentTime = Math.max(el.currentTime - offset, 0)
      }
    })
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const el = ttsAudioRef.current
      if (el) {
        const offset = details.seekOffset || 10
        el.currentTime = Math.min(el.currentTime + offset, el.duration || 0)
      }
    })
    try {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        const el = ttsAudioRef.current
        if (el) {
          if (details.fastSeek && 'fastSeek' in el) {
            el.fastSeek(details.seekTime)
          } else {
            el.currentTime = details.seekTime
          }
        }
      })
    } catch (e) {
      console.warn('seekto not supported', e)
    }
  }

  const speakBrowserFallback = (text, onEnd) => {
    if (!window.speechSynthesis) {
      toast.error('Tu navegador no soporta lectura en voz alta nativa.')
      return false
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'es-ES'
    utterance.rate = parseFloat(ttsSpeed) || 1.0

    const voices = window.speechSynthesis.getVoices()
    if (voices && voices.length > 0) {
      const esVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('es'))
      if (esVoice) utterance.voice = esVoice
    }
    utterance.onend = () => {
      onEnd?.()
    }
    utterance.onerror = (e) => {
      console.warn("SpeechSynthesis error:", e)
      onEnd?.()
    }
    window.speechSynthesis.speak(utterance)
    return true
  }

  const pauseTTS = () => {
    if (ttsAudioRef.current) ttsAudioRef.current.pause()
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause()
    }
  }

  const resumeCurrentTTS = () => {
    if (window.speechSynthesis && window.speechSynthesis.paused) {
      window.speechSynthesis.resume()
      setTtsPlaying(true)
      setTtsChapterPaused(false)
      return
    }
    const el = ttsAudioRef.current
    if (el) {
      const saved = localStorage.getItem(storageKey)
      let savedTime = 0
      let targetChapterId = ttsChapter
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed?.chapterId) {
            targetChapterId = parsed.chapterId
            savedTime = parsed.currentTime || 0
          }
        } catch {}
      }
      if (!targetChapterId && chapters.length > 0) {
        targetChapterId = chapters[0].id
      }
      if (targetChapterId) {
        setTtsChapter(targetChapterId)
        initTtsAudio('chapter', targetChapterId, null, savedTime)
      }
      el.play().catch(() => {})
    }
  }

  const stopAnyTTSWithoutConfirm = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause()
    }
    setTtsPlaying(false)
    setTtsChapterPaused(false)
    setTtsChapter(null)
    setTtsCharPlaying(false)
    setTtsCharPaused(false)
    setTtsCharacter(null)
    setTtsInfoPlaying(false)
    setTtsInfoPaused(false)
  }

  const stopTTS = async (skipConfirm = false) => {
    if (!skipConfirm && (ttsPlaying || ttsChapter || ttsChapterPaused)) {
      if (!await confirm('¿Seguro que quieres parar la reproducción? Se perderá el grado de avance guardado para este libro.')) return
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause()
      ttsAudioRef.current.currentTime = 0
      if (!skipConfirm) {
        ttsAudioRef.current.src = ''
      }
    }
    setTtsPlaying(false); setTtsChapter(null); setTtsChapterPaused(false)
    localStorage.removeItem(storageKey)
    syncPlaybackToDB(true)
  }

  const playFromBeginning = (book, chapters) => {
    stopAnyTTSWithoutConfirm()
    if (chapters.length > 0) {
      const firstChapter = chapters[0]
      playFromChapter(firstChapter, chapters)
    }
  }

  const playFromChapter = (chapter, chapters) => {
    if (ttsChapter === chapter.id && ttsChapterPaused) {
      resumeCurrentTTS()
      return
    }
    stopAnyTTSWithoutConfirm()
    setTtsChapter(chapter.id)
    toast.loading('Cargando lectura...', { id: 'tts-load' })
    const el = initTtsAudio('chapter', chapter.id)
    if (el) {
      el.play().catch(e => {
        toast.dismiss('tts-load')
        console.warn("Audio play failed, using browser speech fallback:", e)
        const textToRead = `${chapter.title}. ${chapter.summary || ''}`
        if (textToRead.trim()) {
          setTtsPlaying(true)
          setTtsChapterPaused(false)
          speakBrowserFallback(textToRead, () => {
            setTtsPlaying(false)
            setTtsChapter(null)
          })
        } else {
          setTtsPlaying(false)
          setTtsChapter(null)
          toast.error("No se pudo reproducir el audio del capítulo")
        }
      })
    }
  }

  const pauseCharTTS = () => {
    if (ttsAudioRef.current) ttsAudioRef.current.pause()
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause()
    }
  }

  const resumeCharTTS = () => {
    if (window.speechSynthesis && window.speechSynthesis.paused) {
      window.speechSynthesis.resume()
      setTtsCharPlaying(true)
      setTtsCharPaused(false)
      return
    }
    const el = ttsAudioRef.current
    if (el) {
      const saved = localStorage.getItem(charStorageKey)
      let savedTime = 0
      let targetCharId = null
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed?.characterId) {
            targetCharId = parsed.characterId
            savedTime = parsed.currentTime || 0
          }
        } catch {}
      }
      const char = characters.find(c => c.id === targetCharId || c.name === ttsCharacter)
      if (char) {
        setTtsCharacter(char.name)
        initTtsAudio('character', null, char.id, savedTime)
      }
      el.play().catch(() => {})
    }
  }

  const stopCharTTS = async (skipConfirm = false) => {
    if (!skipConfirm && (ttsCharPlaying || ttsCharPaused || ttsCharacter)) {
      if (!await confirm('¿Parar lectura de personajes? Se perderá el grado de avance guardado.')) return
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause()
      ttsAudioRef.current.currentTime = 0
      if (!skipConfirm) {
        ttsAudioRef.current.src = ''
      }
    }
    setTtsCharPlaying(false); setTtsCharPaused(false); setTtsCharacter(null)
    localStorage.removeItem(charStorageKey)
    syncPlaybackToDB(true)
  }

  const playCharacter = (char) => {
    if ((ttsCharacter === char.name || ttsCharacter === char.id) && ttsCharPaused) {
      resumeCharTTS()
      return
    }
    stopAnyTTSWithoutConfirm()
    setTtsCharacter(char.name)
    toast.loading('Cargando lectura...', { id: 'tts-load' })
    const el = initTtsAudio('character', null, char.id)
    if (el) {
      el.play().catch(e => {
        toast.dismiss('tts-load')
        console.warn("Audio play failed, using browser speech fallback:", e)
        const textToRead = `Personaje: ${char.name}. ${char.role || ''}. ${char.description || ''}. ${char.personality ? 'Personalidad: ' + char.personality : ''}`
        if (textToRead.trim()) {
          setTtsCharPlaying(true)
          setTtsCharPaused(false)
          speakBrowserFallback(textToRead, () => {
            setTtsCharPlaying(false)
            setTtsCharacter(null)
          })
        } else {
          setTtsCharPlaying(false)
          setTtsCharacter(null)
          toast.error("No se pudo reproducir el audio del personaje")
        }
      })
    }
  }

  const playInfo = (book) => {
    if (ttsInfoPaused && localStorage.getItem(infoStorageKey + '_type') === 'synopsis') {
      resumeInfoTTS()
      return
    }
    stopAnyTTSWithoutConfirm()
    toast.loading('Cargando lectura...', { id: 'tts-load' })
    localStorage.setItem(infoStorageKey + '_type', 'synopsis')
    const el = initTtsAudio('synopsis')
    if (el) {
      el.play().catch(e => {
        toast.dismiss('tts-load')
        console.warn("Audio play failed, using browser speech fallback:", e)
        if (book?.synopsis) {
          setTtsInfoPlaying(true)
          speakBrowserFallback(book.synopsis, () => {
            setTtsInfoPlaying(false)
          })
        }
      })
    }
  }

  const playSummary = (book) => {
    if (ttsInfoPaused && localStorage.getItem(infoStorageKey + '_type') === 'global_summary') {
      resumeInfoTTS()
      return
    }
    stopAnyTTSWithoutConfirm()
    toast.loading('Cargando lectura...', { id: 'tts-load' })
    localStorage.setItem(infoStorageKey + '_type', 'global_summary')
    const el = initTtsAudio('global_summary')
    if (el) {
      el.play().catch(e => {
        toast.dismiss('tts-load')
        console.warn("Audio play failed, using browser speech fallback:", e)
        if (book?.global_summary) {
          setTtsInfoPlaying(true)
          speakBrowserFallback(book.global_summary, () => {
            setTtsInfoPlaying(false)
          })
        }
      })
    }
  }

  const pauseInfoTTS = () => {
    if (ttsAudioRef.current) ttsAudioRef.current.pause()
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause()
    }
  }

  const resumeInfoTTS = () => {
    const el = ttsAudioRef.current
    if (el) {
      const type = localStorage.getItem(infoStorageKey + '_type') || 'synopsis'
      const saved = localStorage.getItem(infoStorageKey)
      let savedTime = 0
      if (saved) {
        try {
          const p = JSON.parse(saved)
          savedTime = p.currentTime || 0
        } catch {}
      }
      initTtsAudio(type, null, null, savedTime)
      el.play().catch(() => {})
    }
  }

  const stopInfoTTS = async (skipConfirm = false) => {
    if (!skipConfirm && (ttsInfoPlaying || ttsInfoPaused)) {
      if (!await confirm('¿Parar reproducción? Se perderá el grado de avance guardado.')) return
    }
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause()
      ttsAudioRef.current.currentTime = 0
      if (!skipConfirm) {
        ttsAudioRef.current.src = ''
      }
    }
    setTtsInfoPlaying(false); setTtsInfoPaused(false)
    localStorage.removeItem(infoStorageKey)
    localStorage.removeItem(infoStorageKey + '_type')
    syncPlaybackToDB(true)
  }

  const syncTimerRef = React.useRef(null)
  const syncPlaybackToDB = (immediate = false) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    const doSync = async () => {
      try {
        const state = {
          chapters: JSON.parse(localStorage.getItem(storageKey) || 'null'),
          characters: JSON.parse(localStorage.getItem(charStorageKey) || 'null'),
          info: {
            pos: JSON.parse(localStorage.getItem(infoStorageKey) || 'null'),
            type: localStorage.getItem(infoStorageKey + '_type')
          },
          podcast: JSON.parse(localStorage.getItem(podcastStorageKey) || 'null')
        }
        await booksAPI.update(id, { playback_state: state })
      } catch (err) {
        console.warn('syncPlaybackToDB error:', err)
      }
    }
    if (immediate) {
      doSync()
    } else {
      syncTimerRef.current = setTimeout(doSync, 2000)
    }
  }

  // Restore states from localStorage on mount
  useEffect(() => {
    const savedChapter = localStorage.getItem(storageKey)
    if (savedChapter) {
      try {
        const parsed = JSON.parse(savedChapter)
        if (parsed?.chapterId) {
          setTtsChapter(parsed.chapterId)
          setTtsChapterPaused(true)
          setTtsPlaying(false)
        }
      } catch {}
    }

    const savedChar = localStorage.getItem(charStorageKey)
    if (savedChar) {
      try {
        const parsed = JSON.parse(savedChar)
        if (parsed?.characterId) {
          setTtsCharacter(parsed.characterId)
          setTtsCharPaused(true)
          setTtsCharPlaying(false)
        }
      } catch {}
    }

    const savedInfo = localStorage.getItem(infoStorageKey)
    if (savedInfo) {
      setTtsInfoPaused(true)
      setTtsInfoPlaying(false)
    }

    const savedPodcast = localStorage.getItem(podcastStorageKey)
    if (savedPodcast) {
      try {
        const { currentTime, duration } = JSON.parse(savedPodcast)
        setAudioCurrentTime(currentTime || 0)
        setAudioDuration(duration || 0)
        setAudioPaused(true)
        setAudioPlaying(false)
      } catch {}
    } else {
      setAudioCurrentTime(0)
      setAudioDuration(0)
    }
  }, [id])

  const anyTtsPlaying = ttsPlaying || ttsCharPlaying || ttsInfoPlaying
  const anyTtsPaused = ttsChapterPaused || ttsCharPaused || ttsInfoPaused

  const resumeAnyTTS = () => {
    if (ttsChapterPaused) resumeCurrentTTS()
    else if (ttsCharPaused) resumeCharTTS()
    else if (ttsInfoPaused) resumeInfoTTS()
  }

  const pauseAnyTTS = () => {
    if (ttsPlaying) pauseTTS()
    else if (ttsCharPlaying) pauseCharTTS()
    else if (ttsInfoPlaying) pauseInfoTTS()
  }

  const stopAnyTTS = (skipConfirm = false) => {
    if (ttsPlaying || ttsChapterPaused) stopTTS(skipConfirm)
    else if (ttsCharPlaying || ttsCharPaused) stopCharTTS(skipConfirm)
    else if (ttsInfoPlaying || ttsInfoPaused) stopInfoTTS(skipConfirm)
  }

  const [searchParams, setSearchParams] = useSearchParams()
  const currentTab = searchParams.get('tab') || 'info'
  const [tab, setTab] = useState(currentTab)

  const handleTabChange = (newTab) => {
    if (newTab === tab) return
    setSearchParams({ tab: newTab })
    setTab(newTab)
  }

  // Sincronizar si cambia la URL directamente
  useEffect(() => {
    if (currentTab !== tab && tab !== null) setTab(currentTab)
  }, [currentTab])
  const [mindmapView, setMindmapView] = useState('list')
  const [showNetworkModal, setShowNetworkModal] = useState(false)
  const [chaptersView, setChaptersView] = useState('timeline')
  const [expandedChapter, setExpandedChapter] = useState(null)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [coverKey, setCoverKey] = useState(0)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [audioPaused, setAudioPaused] = useState(false)
  const [audioEl, setAudioEl] = useState(null)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [rating, setRating] = useState(0)

  const load = async (isFirst = false) => {
    try {
      if (isFirst) setLoading(true)
      const bookRes = await booksAPI.get(id)
      setData(bookRes.data)

      try {
        const statusRes = await analysisAPI.status(id)
        setStatus(statusRes.data)
      } catch (stErr) {
        console.warn("Could not fetch book status, using fallback:", stErr)
        const b = bookRes.data?.book || {}
        setStatus({
          status: b.status || 'complete',
          phase1_done: b.phase1_done ?? true,
          phase2_done: b.phase2_done ?? true,
          phase3_done: b.phase3_done ?? true,
          phase4_done: b.phase4_done ?? true,
          phase5_done: b.phase5_done ?? true,
          phase6_done: b.phase6_done ?? true,
          chapters_summarized: true,
          has_global_summary: Boolean(b.global_summary),
          has_mindmap: Boolean(b.mindmap_data),
          podcast_done: Boolean(b.podcast_audio_path || b.podcast_script),
          podcast_audio_path: b.podcast_audio_path,
          podcast_script: b.podcast_script,
          podcast_duration: b.podcast_duration || 0,
          jobs: []
        })
      }

      // Restore playback state from DB if present
      if (bookRes.data.book?.playback_state) {
        const ps = bookRes.data.book.playback_state
        if (ps.chapters) {
          localStorage.setItem(storageKey, JSON.stringify(ps.chapters))
          if (ps.chapters.chapterId) {
            setTtsChapter(ps.chapters.chapterId)
            setTtsChapterPaused(true)
            setTtsPlaying(false)
          }
        } else {
          localStorage.removeItem(storageKey)
        }

        if (ps.characters) {
          localStorage.setItem(charStorageKey, JSON.stringify(ps.characters))
          if (ps.characters.characterId) {
            setTtsCharacter(ps.characters.characterId)
            setTtsCharPaused(true)
            setTtsCharPlaying(false)
          }
        } else {
          localStorage.removeItem(charStorageKey)
        }

        if (ps.info?.pos) {
          localStorage.setItem(infoStorageKey, JSON.stringify(ps.info.pos))
          localStorage.setItem(infoStorageKey + '_type', ps.info.type)
          setTtsInfoPaused(true)
          setTtsInfoPlaying(false)
        } else {
          localStorage.removeItem(infoStorageKey)
          localStorage.removeItem(infoStorageKey + '_type')
        }

        if (ps.podcast) {
          localStorage.setItem(podcastStorageKey, JSON.stringify(ps.podcast))
          setAudioCurrentTime(ps.podcast.currentTime || 0)
          setAudioDuration(ps.podcast.duration || 0)
          setAudioPaused(true)
          setAudioPlaying(false)
        } else {
          localStorage.removeItem(podcastStorageKey)
          setAudioCurrentTime(0)
          setAudioDuration(0)
        }
      }

      setRating(bookRes.data.book?.rating || 0)
      try {
        const { data: qState } = await queueAPI.get()
        const info = qState?.infos?.[id]
        setProgressMsg(info?.msg || '')
      } catch {}
    } catch (err) {
      toast.error(`Error al cargar: ${err.response?.data?.detail || err.message}`)
    } finally {
      if (isFirst) setLoading(false)
    }
  }

  useEffect(() => { load(true) }, [id])

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        try { audioRef.current.load() } catch (e) {}
      }
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause()
        ttsAudioRef.current.src = ''
        try { ttsAudioRef.current.load() } catch (e) {}
      }
      setAudioPlaying(false)
      setAudioPaused(false)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null
        navigator.mediaSession.setActionHandler('play', null)
        navigator.mediaSession.setActionHandler('pause', null)
        navigator.mediaSession.setActionHandler('seekbackward', null)
        navigator.mediaSession.setActionHandler('seekforward', null)
        if ('seekto' in navigator.mediaSession) {
          navigator.mediaSession.setActionHandler('seekto', null)
        }
      }
    }
  }, [id])

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

  const startSilentAudioForTts = () => {
    const el = audioRef.current
    if (el) {
      if (audioPlaying) {
        el.pause()
        setAudioPlaying(false)
        setAudioPaused(true)
      }
      if (el.src !== SILENCE_URL) {
        el.src = SILENCE_URL
        el.loop = true
      }
      el.play().catch(e => console.warn('Silence play blocked', e))
    }
  }

  const updateMediaSession = (el) => {
    if ('mediaSession' in navigator) {
      const relativeSrc = coverSrc(book) || '/default-cover.png'
      const absoluteCoverUrl = relativeSrc.startsWith('http')
        ? relativeSrc
        : `${window.location.origin}${relativeSrc}`

      navigator.mediaSession.metadata = new MediaMetadata({
        title: book.title || 'Podcast',
        artist: book.author || 'BookTracker',
        album: 'Análisis de BookTracker',
        artwork: [
          { src: absoluteCoverUrl, sizes: '192x192', type: 'image/png' },
          { src: absoluteCoverUrl, sizes: '512x512', type: 'image/png' }
        ]
      })

      navigator.mediaSession.setActionHandler('play', () => {
        el.play().catch(() => {})
      })
      navigator.mediaSession.setActionHandler('pause', () => {
        el.pause()
      })
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const offset = details.seekOffset || 10
        el.currentTime = Math.max(el.currentTime - offset, 0)
      })
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const offset = details.seekOffset || 10
        el.currentTime = Math.min(el.currentTime + offset, el.duration || 0)
      })
      try {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.fastSeek && 'fastSeek' in el) {
            el.fastSeek(details.seekTime)
          } else {
            el.currentTime = details.seekTime
          }
        })
      } catch (e) {
        console.warn('seekto not supported', e)
      }
    }
  }

  const updateMediaSessionPosition = (el) => {
    if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
      if (el.duration && isFinite(el.duration) && !isNaN(el.duration) && el.duration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: el.duration,
            playbackRate: el.playbackRate || 1.0,
            position: el.currentTime
          })
        } catch (e) {
          console.warn('Error setting position state', e)
        }
      }
    }
  }

  const initAudio = () => {
    const el = audioRef.current
    if (!el) return null

    if (el._hasListeners) {
      const token = localStorage.getItem('bt_token')
      const url = `${analysisAPI.podcastAudioUrl(id)}?token=${encodeURIComponent(token)}`
      if (el.src !== url) {
        el.src = url
        el.load()
        updateMediaSession(el)
      }
      return el
    }

    el._hasListeners = true
    const token = localStorage.getItem('bt_token')
    const url = `${analysisAPI.podcastAudioUrl(id)}?token=${encodeURIComponent(token)}`
    el.src = url
    el.load()
    setAudioEl(el)

    // Registrar inmediatamente los metadatos de reproducción antes de iniciar
    updateMediaSession(el)

    el.addEventListener('play', () => {
      if (el.src === SILENCE_URL || el.src.startsWith('data:')) return
      el.playbackRate = ttsSpeed
      setAudioPlaying(true)
      setAudioPaused(false)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
      updateMediaSession(el)
      stopAnyTTSWithoutConfirm()
    })

    el.addEventListener('pause', () => {
      if (el.src === SILENCE_URL || el.src.startsWith('data:')) return
      setAudioPlaying(false)
      setAudioPaused(true)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
      }
    })

    el.addEventListener('ended', () => {
      if (el.src === SILENCE_URL || el.src.startsWith('data:')) return
      setAudioPlaying(false)
      setAudioPaused(false)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none'
      }
      localStorage.removeItem(podcastStorageKey)
      syncPlaybackToDB()
    })

    el.addEventListener('timeupdate', () => {
      if (el.src === SILENCE_URL || el.src.startsWith('data:')) return
      setAudioCurrentTime(el.currentTime)
      const progress = {
        currentTime: el.currentTime,
        duration: el.duration
      }
      localStorage.setItem(podcastStorageKey, JSON.stringify(progress))
      syncPlaybackToDB()
      updateMediaSessionPosition(el)
    })

    el.addEventListener('durationchange', () => {
      if (el.src === SILENCE_URL || el.src.startsWith('data:')) return
      if (el.duration && isFinite(el.duration)) {
        setAudioDuration(el.duration)
      }
    })

    el.addEventListener('loadedmetadata', () => {
      if (el.src === SILENCE_URL || el.src.startsWith('data:')) return
      el.playbackRate = ttsSpeed
      if (el.duration && isFinite(el.duration)) {
        setAudioDuration(el.duration)
      }
      updateMediaSession(el)
      updateMediaSessionPosition(el)
      
      const saved = localStorage.getItem(podcastStorageKey)
      if (saved) {
        const { currentTime } = JSON.parse(saved)
        if (currentTime > 0 && currentTime < el.duration) {
          el.currentTime = currentTime
        }
      }
    })

    return el
  }

  const toggleAudio = async () => {
    const el = initAudio()
    if (audioPlaying) {
      el.pause()
    } else {
      el.play().catch(err => {
        toast.error('Error al reproducir audio')
        console.error(err)
      })
    }
  }

  const handleDownloadAudio = async () => {
    try {
      const token = localStorage.getItem('bt_token')
      const resp = await fetch(`${analysisAPI.podcastAudioUrl(id)}?token=${encodeURIComponent(token)}`)
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

  const handleDelete = async () => {
    const msg = book.is_shared
      ? `¿Quitar "${book.title}" de tu biblioteca? El análisis original de ${book.owner_username} no se modificará.`
      : `¿Eliminar "${book.title}"? Esta acción borrará el libro, su análisis, y se quitará de la biblioteca de los amigos con quienes lo compartiste.`
    if (await confirm(msg)) {
      await booksAPI.delete(id)
      navigate('/')
    }
  }


  if (loading) return <div className="book-loading"><Loader size={28} className="spin" /><p>Cargando...</p></div>
  if (!book.id) return <div className="book-loading"><button onClick={() => navigate("/")}>Volver</button></div>

  const formatDuration = (s) => { const m = Math.floor(s/60); const sc = Math.floor(s%60); return `${m}:${sc.toString().padStart(2,'0')}` }

  return (
    <div className="book-page">
      <div className="book-hero">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <button className="back-btn" onClick={() => navigate('/')}><ArrowLeft size={16} /> Biblioteca</button>
          <button className="sync-btn-small" onClick={() => load(true)} title="Sincronizar estado"><RefreshCw size={16} className={loading ? 'spinning' : ''} /></button>
        </div>
        <div className="hero-content">
          <div className="hero-cover" onClick={() => setCoverPickerOpen(true)}><HeroCover book={book} /></div>
          <div className="hero-info">
            <div className="hero-title-wrap" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '0.5rem' }}>
              <h1>{book.title || 'Sin Título'}</h1>
              {(anyTtsPlaying || anyTtsPaused) && (
                <div className="hero-playback-controls">
                  <button className="playback-btn-premium pause-blue" onClick={anyTtsPaused ? resumeAnyTTS : pauseAnyTTS} title={anyTtsPaused ? 'Reanudar' : 'Pausar'}>
                    {anyTtsPaused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
                  </button>
                  <button className="playback-btn-premium stop-red" onClick={stopAnyTTS} title="Parar reproducción">
                    <Square size={20} fill="currentColor" />
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <Link to={`/author/${encodeURIComponent(book.author || '')}`} className="hero-author-link">
                {book.author}
              </Link>
              {book.is_shared && (
                <span className="shared-owner-badge-label" style={{ background: 'rgba(201, 169, 110, 0.15)', color: 'var(--gold)', fontSize: '0.8rem', padding: '0.2rem 0.6rem', borderRadius: '4px', border: '1px solid rgba(201, 169, 110, 0.25)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  👥 Compartido por <b>{book.owner_username}</b>
                </span>
              )}
            </div>
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

              {!book.is_shared && statusInfo?.has_global_summary && (
                <button className="hero-action-btn share-btn" onClick={() => setShowShareModal(true)} title="Compartir este análisis con amigos" style={{ background: 'var(--ink)', color: 'var(--gold)', border: '1px solid rgba(201, 169, 110, 0.3)' }}>
                  <Share2 size={16} />
                  <span>Compartir</span>
                </button>
              )}

              {book.has_file && (
                <button
                  className="hero-action-btn epub-btn"
                  title="Descargar archivo original"
                  onClick={async () => {
                    try {
                      const token = localStorage.getItem('bt_token')
                      const url = `${analysisAPI.downloadUrl(id)}`
                      const resp = await fetch(url, {
                        headers: { Authorization: `Bearer ${token}` }
                      })
                      if (!resp.ok) { toast.error('No se pudo descargar el archivo'); return }
                      const blob = await resp.blob()
                      const objUrl = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = objUrl
                      a.download = `${book.title}.${book.file_type || 'pdf'}`
                      a.click()
                      setTimeout(() => URL.revokeObjectURL(objUrl), 5000)
                    } catch { toast.error('Error al descargar el archivo') }
                  }}
                >
                  <BookOpen size={16} />
                  <span>Descarga Original</span>
                </button>
              )}

              {!book.is_shared && (
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
              )}
              

            </div>
          </div>
          <button className="delete-btn" onClick={handleDelete} title={book.is_shared ? "Quitar de mi biblioteca" : "Eliminar libro"}><Trash2 size={20} /></button>
        </div>
      </div>

      <div className="book-tabs">
        <div className="tabs-bar tabs-bar-desktop">
          {TABS.map(t => {
            const isDone = statusInfo?.[t.statusKey]
            const isTabProcessing = isProcessing && progressMsg && (t.label.toLowerCase().includes(progressMsg.toLowerCase()) || (t.id === 'summary' && progressMsg.toLowerCase().includes('global')))
            
            return (
              <button 
                key={t.id} 
                onClick={() => handleTabChange(t.id)} 
                className={`tab-btn ${tab === t.id ? 'active' : ''} ${isTabProcessing ? 'processing' : ''}`}
              >
                <t.icon size={18} />
                <span className="tab-btn-text">{t.label}</span>
                {isDone && <div className="tab-status-dot" title="Completado" />}
                {isTabProcessing && <Loader size={12} className="spin" style={{marginLeft:'auto'}} />}
              </button>
            )
          })}
          <span style={{ fontSize: '0.6rem', opacity: 0.2, alignSelf: 'center', marginLeft: 'auto', paddingRight: '1rem' }}>v2.11.10</span>
        </div>

        <div className="tabs-select-mobile">
          <div className="tabs-select-wrapper">
            <select 
              className="tabs-select" 
              value={tab} 
              onChange={(e) => handleTabChange(e.target.value)}
            >
              {TABS.map(t => (
                <option key={t.id} value={t.id}>
                  {t.label} {statusInfo?.[t.statusKey] ? '🟢' : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={18} className="tabs-select-arrow" />
          </div>
        </div>

        <AnimatePresence mode="wait">
          {tab && (
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.2 }}
              className="tab-content"
              style={{ minHeight: '500px' }}
            >
              <ErrorBoundary key={tab}>
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
                    isShared={book.is_shared}
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
                    onOpenNetwork={() => setShowNetworkModal(true)}
                    isShared={book.is_shared}
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
                    <TabPhaseBar phase={5} label="Mapa Mental" doneProp="has_mindmap" canProp="has_global_summary" status={statusInfo} isProcessing={isProcessing} onTrigger={triggerPhase} progressMsg={progressMsg} isShared={book.is_shared} />
                    {statusInfo.has_mindmap ? <MindMap data={book.mindmap_data} /> : <p className="empty-tab">Generando el mapa mental...</p>}
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
                    audioCurrentTime={audioCurrentTime}
                    audioDuration={audioDuration}
                    onSeek={(time) => {
                      const el = initAudio()
                      el.currentTime = time
                      setAudioCurrentTime(time)
                    }}
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
              </ErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showNetworkModal && (
          <motion.div 
            className="network-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="network-modal-content">
              <div className="network-modal-header">
                <h2>Red de Relaciones de Personajes</h2>
                <button className="close-modal-btn" onClick={() => setShowNetworkModal(false)}>
                  <X size={24} />
                  <span>Cerrar</span>
                </button>
              </div>
              <div className="network-modal-body">
                <ErrorBoundary>
                  <CharacterNetwork characters={characters} />
                </ErrorBoundary>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showShareModal && (
          <ShareModal bookId={id} onClose={() => setShowShareModal(false)} />
        )}
      </AnimatePresence>

      {confirmModal}
      {coverPickerOpen && <CoverPicker book={book} onClose={() => setCoverPickerOpen(false)} onSelect={async (url) => { await booksAPI.update(id, { cover_url: url }); setCoverKey(k => k+1); setCoverPickerOpen(false); load() }} />}
      
      {/* Elemento audio oculto en el DOM para reproducir en segundo plano en móviles */}
      <audio ref={audioRef} style={{ display: 'none' }} preload="metadata" />
      <audio ref={ttsAudioRef} style={{ display: 'none' }} preload="metadata" />
    </div>
  )
}

function ShareModal({ bookId, onClose }) {
  const [friends, setFriends] = useState([])
  const [loading, setLoading] = useState(true)

  const loadShares = async () => {
    try {
      setLoading(true)
      const { data } = await socialAPI.getBookShares(bookId)
      setFriends(data || [])
    } catch {
      toast.error('Error al cargar la lista de compartidos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadShares()
  }, [bookId])

  const toggleShare = async (friend) => {
    try {
      if (friend.is_shared) {
        await socialAPI.unshareBook(bookId, friend.id)
        toast.success(`Ya no compartes este libro con ${friend.username}`)
      } else {
        await socialAPI.shareBook(bookId, friend.id)
        toast.success(`Libro compartido con ${friend.username}`)
      }
      loadShares()
    } catch (e) {
      toast.error('Error al cambiar estado de compartición')
    }
  }

  return (
    <motion.div 
      className="share-modal-overlay" 
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div 
        className="share-modal-content" 
        onClick={e => e.stopPropagation()}
        initial={{ y: 20, scale: 0.95 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 20, scale: 0.95 }}
      >
        <div className="share-modal-header">
          <h3>👥 Compartir análisis</h3>
          <button className="share-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="share-modal-desc">Selecciona con qué amigos deseas compartir este análisis literario completo.</p>
        
        {loading ? (
          <div className="share-modal-loading">
            <Loader size={20} className="spin" />
            <span>Cargando amigos...</span>
          </div>
        ) : friends.length === 0 ? (
          <div className="share-modal-empty">
            <p>No tienes amigos aceptados para poder compartirles análisis.</p>
            <Link to="/friends" className="btn-go-friends" onClick={onClose}>Gestionar Amigos</Link>
          </div>
        ) : (
          <div className="share-friends-list">
            {friends.map(f => (
              <div key={f.id} className="share-friend-item">
                <div className="user-avatar" style={{ background: f.avatar_color || '#6366f1', width: '32px', height: '32px', fontSize: '0.8rem' }}>
                  {f.username[0].toUpperCase()}
                </div>
                <div className="share-friend-info">
                  <span className="share-friend-name">{f.username}</span>
                  <span className="share-friend-email">{f.email}</span>
                </div>
                <label className="switch-premium">
                  <input
                    type="checkbox"
                    checked={f.is_shared}
                    onChange={() => toggleShare(f)}
                  />
                  <span className="slider-round"></span>
                </label>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

function HeroCover({ book }) { const src = coverSrc(book); return src ? <img src={src} alt={book.title} /> : <div className="cover-ph-lg"><BookOpen size={48} /></div> }

function TabPhaseBar({ phase, label, doneProp, canProp, status, isProcessing, onTrigger, progressMsg, isShared = false }) {
  const isDone = status[doneProp]
  const showProcessing = isProcessing && (!isDone || (progressMsg?.toLowerCase().includes(label.toLowerCase())))
  
  return (
    <div className="tab-phase-bar" style={{display:'flex', justifyContent:'space-between', marginBottom:'2rem'}}>
      <div style={{display:'flex', alignItems:'center', gap:'1rem'}}>
        {isDone ? <CheckCircle size={20} color="#10b981" /> : <div className="phase-dot">{phase}</div>}
        <div>
          <strong>Fase {phase}: {label}</strong>
          {showProcessing && (
            <div style={{fontSize:'0.8rem', color:'var(--gold)'}}>
              {progressMsg || 'Procesando...'}
            </div>
          )}
        </div>
      </div>
      {!isShared && status[canProp || 'phase1_done'] && !isProcessing && (
        <button className="reanalyze-btn" onClick={() => onTrigger(phase, isDone)}>
          <RefreshCw size={14} /> {isDone ? 'Rehacer' : 'Iniciar'}
        </button>
      )}
    </div>
  )
}

const PodcastTab = React.memo(({ book, status, isProcessing, onTrigger, progressMsg, audioUrl, audioPlaying, audioPaused, onToggleAudio, onDownload, audioCurrentTime, audioDuration, onSeek }) => {
  const formatDuration = (s) => {
    if (s === undefined || s === null) return '--:--'
    const totalSeconds = Math.max(0, Math.floor(s))
    const m = Math.floor(totalSeconds / 60)
    const sc = totalSeconds % 60
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
      <TabPhaseBar phase={6} label="Podcast" doneProp="podcast_done" canProp="has_mindmap" status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} isShared={book.is_shared} />
      
      {status.podcast_done ? (
        <div className="podcast-container">
          <div className="podcast-player-card">
            <div className="podcast-visual-wrap">
              <div className={`podcast-visual ${audioPlaying ? 'playing' : ''}`}>
                <Mic size={48} />
              </div>
            </div>
            <div className="podcast-info">
              <div className="podcast-info-header">
                <h3>Podcast Literario</h3>
                <span className="podcast-duration-badge">{formatDuration(book.podcast_duration)}</span>
              </div>
              <p className="podcast-subtitle">Análisis en formato de audio generado por IA</p>
              
              {status.podcast_done && (
                <div className="podcast-progress-container">
                  <div className="podcast-time-labels">
                    <span>{formatDuration(audioCurrentTime)}</span>
                    <span>{formatDuration(audioDuration || book.podcast_duration)}</span>
                  </div>
                  <input 
                    type="range" 
                    className="podcast-progress-slider"
                    min={0}
                    max={audioDuration || book.podcast_duration || 100}
                    value={audioCurrentTime}
                    onChange={(e) => onSeek(parseFloat(e.target.value))}
                  />
                </div>
              )}

              <div className="podcast-controls" style={{ marginTop: '1rem' }}>
                <button className="podcast-play-btn" onClick={onToggleAudio}>
                  {audioPlaying ? <Pause size={20} /> : <Play size={20} />}
                  <span>{audioPlaying ? 'Pausar' : 'Escuchar Podcast'}</span>
                </button>
                <div className="podcast-secondary-actions">
                  <a
                    className="podcast-download-btn-premium"
                    href={`${analysisAPI.podcastAudioUrl(book.id)}?token=${encodeURIComponent(localStorage.getItem('bt_token'))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir en el reproductor nativo del sistema"
                    style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.6rem' }}
                  >
                    <ExternalLink size={18} />
                    <span className="btn-text">Abrir en Sistema</span>
                  </a>
                  <button className="podcast-download-btn-premium" onClick={onDownload} title="Descargar MP3">
                    <Download size={18} />
                    <span className="btn-text">MP3</span>
                  </button>
                  {!book.is_shared && (
                    <button className="podcast-reanalyze-btn" title="Rehacer análisis del podcast" onClick={() => onTrigger(6, true)}>
                      <RefreshCw size={18} />
                      <span className="btn-text">Rehacer</span>
                    </button>
                  )}
                </div>
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
      <TabPhaseBar phase={7} label="Referencias" doneProp="phase1_done" status={status} isProcessing={isProcessing} onTrigger={onTrigger} progressMsg={progressMsg} isShared={book.is_shared} />
      
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
      <TabPhaseBar phase={1} label="Ficha y Autor" doneProp="phase1_done" status={status} isProcessing={isProcessing} onTrigger={onTrigger} isShared={book.is_shared} />
      <div className="tab-section-header">
        <h3>Sinopsis</h3>
        <div className="tab-header-actions">
          {book.synopsis && (isPlaying || isPaused) ? (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className={`tts-btn ${isPlaying ? 'active' : 'paused'}`} onClick={isPaused ? onResume : onPause} title={isPaused ? "Reanudar lectura" : "Pausar lectura"}>
                {isPaused ? <Play size={14} /> : <Pause size={14} />}
                <span>{isPaused ? 'Reanudar' : 'Pausar'}</span>
              </button>
              <button className="tts-btn stop" onClick={() => onStop()} title="Detener lectura">
                <Square size={14} />
                <span>Parar</span>
              </button>
            </div>
          ) : book.synopsis ? (
            <button className="tts-btn" onClick={() => onPlay(book)}>
              <Volume2 size={14} />
              <span>Escuchar Sinopsis</span>
            </button>
          ) : null}
        </div>
      </div>
      <p>{book.synopsis || 'Analizando...'}</p>
    </div>
  )
})

const SummaryTab = React.memo(({ book, status, isProcessing, onTrigger, onPlay, onStop, isPlaying, isPaused, onResume, onPause }) => {
  return (
    <div className="prose-content">
      <TabPhaseBar phase={4} label="Resumen Global" doneProp="has_global_summary" status={status} isProcessing={isProcessing} onTrigger={onTrigger} isShared={book.is_shared} />
      <div className="tab-section-header">
        <h2>Resumen</h2>
        <div className="tab-header-actions">
          {book.global_summary && (isPlaying || isPaused) ? (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className={`tts-btn ${isPlaying ? 'active' : 'paused'}`} onClick={isPaused ? onResume : onPause} title={isPaused ? "Reanudar lectura" : "Pausar lectura"}>
                {isPaused ? <Play size={14} /> : <Pause size={14} />}
                <span>{isPaused ? 'Reanudar' : 'Pausar'}</span>
              </button>
              <button className="tts-btn stop" onClick={() => onStop()} title="Detener lectura">
                <Square size={14} />
                <span>Parar</span>
              </button>
            </div>
          ) : book.global_summary ? (
            <button className="tts-btn" onClick={() => onPlay(book)}>
              <Volume2 size={14} />
              <span>Escuchar Resumen</span>
            </button>
          ) : null}
        </div>
      </div>
      <p>{book.global_summary || 'No disponible'}</p>
    </div>
  )
})

const ChaptersTab = React.memo(({ chapters = [], expanded, setExpanded, bookId, onChapterSummarized, view, setView, status, isProcessing, onTrigger, onPlay, onStop, currentTtsId, isPlaying, isPaused, onResume, onPause, isShared = false }) => {
  // Logic to check if all chapters are done
  const safeChapters = Array.isArray(chapters) ? chapters : []
  const allDone = safeChapters.length > 0 && safeChapters.every(c => c?.summary_status === 'done')
  
  return (
    <div className="chapters-list">
      <TabPhaseBar 
        phase={2} 
        label="Capítulos" 
        doneProp="phase2_done" 
        status={{...status, phase2_done: status?.phase2_done || allDone}} 
        isProcessing={isProcessing} 
        onTrigger={onTrigger} 
        isShared={isShared}
      />
      
      <div className="chapters-controls">
        <div className="view-toggle-wrap">
          <button className={`view-toggle-btn ${view === 'timeline' ? 'active' : ''}`} onClick={() => setView('timeline')}><GitBranch size={14} /> Breve</button>
          <button className={`view-toggle-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}><List size={14} /> Detallado</button>
        </div>
      </div>

      {view === 'list' ? (
        <div className="chapters-grid-view">
          {safeChapters.map((ch, i) => {
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
                    {hasSummary && !isChPlaying && (
                      <button className="ch-action-btn tts" title="Escuchar este capítulo"
                        onClick={() => onPlay(ch, chapters)}>
                        <Volume2 size={12} />
                      </button>
                    )}
                    {isChPlaying && (
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <button className={`ch-action-btn ${isPlaying ? 'active' : 'paused'}`} title={isPaused ? "Reanudar lectura" : "Pausar lectura"}
                          onClick={() => isPaused ? onResume() : onPause()}>
                          {isPaused ? <Play size={12} /> : <Pause size={12} />}
                        </button>
                        <button className="ch-action-btn stop" title="Parar lectura de este capítulo"
                          onClick={() => onStop()}>
                          <Square size={12} />
                        </button>
                      </div>
                    )}
                    {!isShared && (
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
                    )}
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
                        {!hasSummary && !isShared && (
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
      ) : <InteractiveTimeline chapters={safeChapters} />}
    </div>
  )
})

const CharactersTab = React.memo(({ characters = [], bookId, status, isProcessing, onTrigger, onPlay, onStop, currentTtsId, isPlaying, isPaused, onResume, onPause, onRefresh, onOpenNetwork, isShared = false }) => {
  const safeChars = Array.isArray(characters) ? characters : []
  return (
    <div className="characters-tab">
      <TabPhaseBar phase={3} label="Personajes" doneProp="phase3_done" status={status} isProcessing={isProcessing} onTrigger={onTrigger} isShared={isShared} />
      
      <div className="chapters-controls" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--ink)' }}>Estudio Detallado</h3>
        {status.has_mindmap && (
          <button className="network-trigger-btn" onClick={onOpenNetwork}>
            <Share2 size={16} />
            <span>Explorar Red de Relaciones</span>
          </button>
        )}
      </div>

      <div className="characters-grid">
        {safeChars.map(char => {
          const isCharPlaying = currentTtsId === char.name || currentTtsId === char.id
          return (
            <div key={char.id} className="char-card">
              <div className="char-avatar">{char.name.charAt(0)}</div>
              <div className="char-content">
                <div className="char-card-header">
                  <h3>{char.name}</h3>
                  {char.description && <span className="status-badge-done sm">Analizado</span>}
                  <div className="char-card-actions">
                    {char.description && !isCharPlaying && (
                      <button className="char-action-btn tts" title="Escuchar estudio"
                        onClick={() => onPlay(char)}>
                        <Volume2 size={12} />
                      </button>
                    )}
                    {isCharPlaying && (
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <button className={`char-action-btn ${isPlaying ? 'active' : 'paused'}`} title={isPaused ? "Reanudar lectura" : "Pausar lectura"}
                          onClick={() => isPaused ? onResume() : onPause()}>
                          {isPaused ? <Play size={12} /> : <Pause size={12} />}
                        </button>
                        <button className="char-action-btn stop" title="Parar lectura del personaje"
                          onClick={() => onStop()}>
                          <Square size={12} />
                        </button>
                      </div>
                    )}
                    {!isShared && (
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
                    )}
                  </div>
                </div>
                <span className="char-role">{char.role || 'Personaje'}</span>
                <p className="char-desc">{char.description}</p>
                
                {char.personality && (
                  <div className="char-info-block">
                    <strong>Personalidad</strong>
                    <p>{char.personality}</p>
                  </div>
                )}
                {char.relationships && Object.keys(char.relationships).length > 0 && (
                  <div className="char-info-block">
                    <strong>Relaciones</strong>
                    <div className="char-rel-pills">
                      {Object.entries(char.relationships).map(([name, rel], i) => (
                        <span key={i} className="char-rel-pill"><b>{name}:</b> {rel}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
