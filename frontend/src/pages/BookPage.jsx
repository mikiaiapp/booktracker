import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  BookOpen, User, List, Brain, Map, Mic, Star,
  Play, Pause, ChevronDown, ChevronUp, Loader, CheckCircle,
  ArrowLeft, Edit3, Trash2, AlertCircle
} from 'lucide-react'
import { booksAPI, analysisAPI, chapterAPI } from '../utils/api'
import MindMap from '../components/MindMap'
import './BookPage.css'

const TABS = [
  { id: 'info', label: 'Ficha', icon: BookOpen },
  { id: 'chapters', label: 'Capítulos', icon: List },
  { id: 'characters', label: 'Personajes', icon: User },
  { id: 'summary', label: 'Resumen global', icon: Brain },
  { id: 'mindmap', label: 'Mapa mental', icon: Map },
  { id: 'podcast', label: 'Podcast', icon: Mic },
]

const PROCESSING_STATUSES = ['identifying', 'analyzing_structure', 'summarizing', 'generating_podcast']

export default function BookPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
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

  const triggerPhase = async (phase) => {
    try {
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

  const toggleAudio = () => {
    if (!audioEl) {
      const el = new Audio(analysisAPI.podcastAudioUrl(id))
      el.onended = () => setAudioPlaying(false)
      setAudioEl(el)
      el.play()
      setAudioPlaying(true)
    } else {
      if (audioPlaying) { audioEl.pause(); setAudioPlaying(false) }
      else { audioEl.play(); setAudioPlaying(true) }
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

  const book = data?.book || {}
  const chapters = data?.chapters || []
  const characters = data?.characters || []
  const isProcessing = PROCESSING_STATUSES.includes(status?.status)

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
              <img src={`/data/covers/${book.cover_local.split('/covers/')[1]}`} alt={book.title} />
            ) : (
              <div className="cover-ph-lg">
                <BookOpen size={48} strokeWidth={1} />
              </div>
            )}
          </div>

          <div className="hero-info">
            <h1>{book.title}</h1>
            {book.author && <p className="hero-author">{book.author}</p>}

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

            {/* Status pipeline */}
            {!isShell && <ProcessingPipeline status={status} isProcessing={isProcessing} onTrigger={triggerPhase} />}
            {isShell && (
              <div style={{marginTop:'0.5rem'}}>
                <span style={{fontSize:'11px',background:'#f5f0e8',color:'#8a9aaa',padding:'3px 10px',borderRadius:'20px'}}>Solo ficha — sube el PDF para analizar</span>
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
        <div className="tabs-bar">
          {TABS.map(t => (
            <button key={t.id}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              disabled={
                isShell ||
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

        <AnimatePresence mode="wait">
          <motion.div key={tab} className="tab-content"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

            {tab === 'info' && <InfoTab book={book} />}

            {tab === 'chapters' && (
              <ChaptersTab chapters={chapters} expanded={expandedChapter} setExpanded={setExpandedChapter} />
            )}

            {tab === 'characters' && <CharactersTab characters={characters} />}

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

function ProcessingPipeline({ status, isProcessing, onTrigger }) {
  if (!status) return null
  const steps = [
    { label: 'Fase 1: Identificación', done: status.phase1_done },
    { label: 'Fase 2: Estructura', done: status.phase2_done, trigger: () => onTrigger(2), canTrigger: status.phase1_done && !status.phase2_done },
    { label: 'Fase 3: Análisis IA', done: status.phase3_done, trigger: () => onTrigger(3), canTrigger: status.phase2_done && !status.phase3_done },
    { label: 'Podcast', done: !!status.podcast_audio_path, trigger: () => onTrigger('podcast'), canTrigger: status.phase3_done },
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
          <span>{s.label}</span>
          {s.canTrigger && !isProcessing && (
            <button className="trigger-btn" onClick={s.trigger}>Iniciar</button>
          )}
        </div>
      ))}
      {status.error_msg && (
        <div className="pipeline-error">
          <AlertCircle size={14} />
          <span>Error en el proceso</span>
        </div>
      )}
    </div>
  )
}

function InfoTab({ book }) {
  return (
    <div className="info-tab">
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
      {book.author_bibliography?.length > 0 && (
        <section>
          <h3>Otras obras del autor</h3>
          <ul className="biblio-list">
            {book.author_bibliography.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </section>
      )}
      {!book.synopsis && !book.author_bio && (
        <p className="empty-tab">La información del libro aún se está cargando…</p>
      )}
    </div>
  )
}

function ChaptersTab({ chapters, expanded, setExpanded, bookId, onChapterSummarized }) {
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

function CharactersTab({ characters }) {
  if (!characters.length) return <p className="empty-tab">No se encontraron personajes</p>
  const roleOrder = ['protagonist', 'antagonist', 'secondary', 'minor']
  const sorted = [...characters].sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role))

  const roleLabels = { protagonist: 'Protagonista', antagonist: 'Antagonista', secondary: 'Secundario', minor: 'Menor' }
  const roleColors = { protagonist: 'badge-gold', antagonist: 'badge-rust', secondary: 'badge-green', minor: 'badge-slate' }

  return (
    <div className="characters-grid">
      {sorted.map(c => (
        <div key={c.id} className="char-card">
          <div className="char-header">
            <div className="char-avatar">{c.name[0].toUpperCase()}</div>
            <div>
              <h3>{c.name}</h3>
              {c.role && <span className={`badge ${roleColors[c.role] || 'badge-slate'}`}>{roleLabels[c.role] || c.role}</span>}
            </div>
          </div>
          {c.description && <p className="char-desc">{c.description}</p>}
          {c.personality && (
            <details className="char-detail">
              <summary>Personalidad</summary>
              <p>{c.personality}</p>
            </details>
          )}
          {c.arc && (
            <details className="char-detail">
              <summary>Arco del personaje</summary>
              <p>{c.arc}</p>
            </details>
          )}
          {c.relationships && Object.keys(c.relationships).length > 0 && (
            <details className="char-detail">
              <summary>Relaciones</summary>
              <ul className="rel-list">
                {Object.entries(c.relationships).map(([name, rel]) => (
                  <li key={name}><strong>{name}</strong>: {rel}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  )
}

function PodcastTab({ book, playing, onToggle }) {
  const lines = book.podcast_script
    ? book.podcast_script.split('\n').filter(l => l.trim())
    : []

  return (
    <div className="podcast-tab">
      <div className="podcast-player">
        <div className="player-art">
          <Mic size={32} strokeWidth={1} />
        </div>
        <div className="player-info">
          <h3>{book.title}</h3>
          <p>Podcast generado por IA · Ana & Carlos</p>
        </div>
        {book.podcast_audio_path && (
          <button className="play-btn" onClick={onToggle}>
            {playing ? <Pause size={24} /> : <Play size={24} />}
          </button>
        )}
      </div>

      {lines.length > 0 && (
        <div className="podcast-script">
          <h3>Guión del podcast</h3>
          {lines.map((line, i) => {
            const isAna = line.startsWith('ANA:')
            const isCarlos = line.startsWith('CARLOS:')
            const speaker = isAna ? 'ANA' : isCarlos ? 'CARLOS' : null
            const text = line.replace(/^(ANA|CARLOS):\s*/i, '')
            return (
              <div key={i} className={`script-line ${isAna ? 'ana' : isCarlos ? 'carlos' : ''}`}>
                {speaker && <span className="speaker-label">{speaker}</span>}
                <p>{text}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
