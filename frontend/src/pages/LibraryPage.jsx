import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { booksAPI, queueAPI } from '../utils/api'
import { BookOpen, Star, Search, Layers, X, Pause, Play, Trash2, ChevronDown } from 'lucide-react'
import BookCover, { coverSrc } from '../components/BookCover'
import CoverPicker from '../components/CoverPicker'
import './LibraryPage.css'

const STATUS_LABELS = {
  queued:              { label: 'En cola',      cls: 'badge-slate' },
  uploaded:            { label: 'Subido',       cls: 'badge-slate' },
  identifying:         { label: 'Identificando…', cls: 'badge-gold' },
  identified:          { label: 'Identificado', cls: 'badge-green' },
  analyzing_structure: { label: 'Analizando…', cls: 'badge-gold' },
  structured:          { label: 'Estructurado', cls: 'badge-green' },
  summarizing:         { label: 'Resumiendo…', cls: 'badge-gold' },
  analyzed:            { label: 'Analizado',   cls: 'badge-green' },
  generating_podcast:  { label: 'Podcast…',    cls: 'badge-gold' },
  complete:            { label: 'Completo',    cls: 'badge-green' },
  error:               { label: 'Error',       cls: 'badge-rust' },
}

const PHASE_LABELS = {
  queued:   'En cola',
  starting: 'Iniciando…',
  phase1:   'Identificando',
  phase2:   'Estructura',
  phase3:   'Resumiendo',
  phase3b:  'Análisis final',
  podcast:  'Podcast',
}

const READ_FILTERS = ['all', 'to_read', 'reading', 'read']
const READ_LABELS  = { all: 'Todos', to_read: 'Por leer', reading: 'Leyendo', read: 'Leídos' }

const ANALYSIS_FILTERS = ['all', 'analyzed', 'processing', 'pending']
const ANALYSIS_LABELS  = { all: 'Todos', analyzed: 'Analizados', processing: 'Procesando', pending: 'Sin procesar' }
const ANALYZED_STATUSES    = ['complete', 'analyzed']
const PROC_STATUSES        = ['queued', 'identifying', 'analyzed_structure', 'analyzing_structure', 'summarizing', 'generating_podcast', 'uploaded', 'identified', 'structured']

// ── Componente barra de progreso compacta ─────────────────────
function MiniProgress({ pct, phase }) {
  return (
    <div className="mini-progress-wrap">
      <div className="mini-progress-bar" style={{ width: `${pct}%` }} />
      <span className="mini-progress-label">{PHASE_LABELS[phase] || phase}</span>
    </div>
  )
}

// ── Panel lateral de cola ─────────────────────────────────────
function QueuePanel({ onClose, books }) {
  const [state, setState]       = useState(null)
  const [loading, setLoading]   = useState(false)
  const intervalRef             = useRef(null)

  const refresh = useCallback(async () => {
    try {
      const { data } = await queueAPI.get()
      setState(data)
    } catch { /* silencioso */ }
  }, [])

  useEffect(() => {
    refresh()
    intervalRef.current = setInterval(refresh, 2000)
    return () => clearInterval(intervalRef.current)
  }, [refresh])

  const handlePause = async () => {
    setLoading(true)
    try {
      if (state?.paused) {
        await queueAPI.resume()
        toast('Cola reanudada', { icon: '▶️' })
      } else {
        await queueAPI.pause()
        toast('Cola pausada', { icon: '⏸' })
      }
      await refresh()
    } finally { setLoading(false) }
  }

  const handleClearAll = async () => {
    if (!window.confirm('¿Parar todos los procesos en curso? Los libros quedarán en su último estado guardado.')) return
    setLoading(true)
    try {
      // 1. Limpiar cola Redis (nuevo sistema)
      await queueAPI.clear().catch(() => {})
      // 2. Resetear estado de libros legacy en BD
      const legacyBooks = books.filter(b =>
        PROCESSING_STATUSES.includes(b.status) &&
        b.id !== state?.active &&
        !(state?.queue || []).some(e => e.book_id === b.id)
      )
      await Promise.all(legacyBooks.map(b =>
        import('../utils/api').then(({ analysisAPI }) =>
          analysisAPI.cancel(b.id).catch(() => {})
        )
      ))
      toast.success('Procesos detenidos. Recarga la página en unos segundos.')
      await refresh()
    } catch { toast.error('Error al parar los procesos') }
    finally { setLoading(false) }
  }

  const handleCancel = async (bookId, title) => {
    try {
      await queueAPI.cancel(bookId)
      toast(`«${title}» eliminado de la cola`, { icon: '✕' })
      await refresh()
    } catch { toast.error('Error al cancelar') }
  }

  // Construir lista unificada: activo primero, luego cola
  const getTitle = (bookId) => {
    const info = state?.infos?.[bookId]
    if (info?.title) return info.title
    const book = books.find(b => b.id === bookId)
    return book?.title || bookId
  }

  const activeId  = state?.active
  const queueList = state?.queue || []

  // Libros procesando en BD fuera de la cola Redis (sistema legacy)
  const legacyCount = books.filter(b =>
    PROCESSING_STATUSES.includes(b.status) &&
    b.id !== activeId &&
    !queueList.some(e => e.book_id === b.id)
  ).length

  const totalCount = (activeId ? 1 : 0) + queueList.length + legacyCount
  const isEmpty = totalCount === 0

  return (
    <motion.div
      className="queue-panel"
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* Cabecera */}
      <div className="queue-header">
        <div className="queue-header-left">
          <Layers size={16} />
          <span>Cola de análisis</span>
          {!isEmpty && (
            <span className="queue-count-badge">{totalCount}</span>
          )}
        </div>
        <div className="queue-header-actions">
          {!isEmpty && (
            <>
              {/* Pausar/reanudar solo aplica a la cola Redis */}
              {(activeId || queueList.length > 0) && (
                <button
                  className={`queue-action-btn ${state?.paused ? 'resume' : 'pause'}`}
                  onClick={handlePause}
                  disabled={loading}
                  title={state?.paused ? 'Reanudar cola' : 'Pausar cola'}
                >
                  {state?.paused ? <Play size={14} /> : <Pause size={14} />}
                  {state?.paused ? 'Reanudar' : 'Pausar'}
                </button>
              )}
              <button
                className="queue-action-btn danger"
                onClick={handleClearAll}
                disabled={loading}
                title="Parar y vaciar todos los procesos"
              >
                <Trash2 size={14} />
                Parar todo
              </button>
            </>
          )}
          <button className="queue-close-btn" onClick={onClose} title="Cerrar">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Estado pausa */}
      {state?.paused && (
        <div className="queue-paused-banner">
          ⏸ Cola pausada — el libro activo termina; el siguiente esperará
        </div>
      )}

      {/* Contenido */}
      <div className="queue-body">
        {(() => {
          // Libros procesando en BD pero no en cola Redis (sistema antiguo o recién arrancados)
          const legacyBooks = books.filter(b =>
            PROCESSING_STATUSES.includes(b.status) &&
            b.id !== activeId &&
            !queueList.some(e => e.book_id === b.id)
          )
          const totalVisible = (activeId ? 1 : 0) + queueList.length + legacyBooks.length

          if (totalVisible === 0) return (
            <div className="queue-empty">
              <Layers size={32} strokeWidth={1} />
              <p>La cola está vacía</p>
              <p className="queue-empty-sub">Los libros que subas se analizarán de uno en uno</p>
            </div>
          )

          return (
            <div className="queue-list">
              {/* Libro activo (nuevo sistema) */}
              {activeId && (() => {
                const info  = state?.infos?.[activeId] || {}
                const title = getTitle(activeId)
                const pct   = parseInt(info.pct || 0)
                const phase = info.phase || 'starting'
                const msg   = info.msg || ''
                return (
                  <div key={activeId} className="queue-item active">
                    <div className="queue-item-header">
                      <div className="queue-item-status-dot active" />
                      <span className="queue-item-label">Procesando</span>
                      <div className="queue-item-spinner" />
                    </div>
                    <div className="queue-item-title">{title}</div>
                    <MiniProgress pct={pct} phase={phase} />
                    <div className="queue-item-msg">{msg}</div>
                  </div>
                )
              })()}

              {/* Libros legacy procesando (sistema anterior al queue manager) */}
              {legacyBooks.map(book => (
                <div key={book.id} className="queue-item active legacy">
                  <div className="queue-item-header">
                    <div className="queue-item-status-dot active" />
                    <span className="queue-item-label">En proceso</span>
                    <div className="queue-item-spinner" />
                  </div>
                  <div className="queue-item-title">{book.title}</div>
                  <div className="queue-item-msg">
                    {STATUS_LABELS[book.status]?.label || book.status}
                    {' · '}
                    <span style={{opacity:0.6}}>Para parar: reinicia el worker</span>
                  </div>
                </div>
              ))}

              {/* Cola pendiente (nuevo sistema) */}
              {queueList.map((entry, idx) => {
                const title = getTitle(entry.book_id)
                return (
                  <div key={entry.book_id} className="queue-item pending">
                    <div className="queue-item-header">
                      <div className="queue-item-status-dot pending" />
                      <span className="queue-item-label">#{idx + 1} en cola</span>
                      <button
                        className="queue-item-cancel"
                        onClick={() => handleCancel(entry.book_id, title)}
                        title="Quitar de la cola"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="queue-item-title">{title}</div>
                    <div className="queue-item-msg" style={{ color: 'var(--mist)', fontSize: '0.75rem' }}>
                      Esperando turno…
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
    </motion.div>
  )
}

const PROCESSING_STATUSES = ['queued','identifying','analyzing_structure','summarizing','generating_podcast','uploaded']

// ── Página principal ──────────────────────────────────────────
export default function LibraryPage() {
  const [books, setBooks]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [filter, setFilter]             = useState('all')
  const [coverPickerBook, setCoverPickerBook] = useState(null)
  const [queueOpen, setQueueOpen]       = useState(false)
  const [analysisFilter, setAnalysisFilter] = useState('all')
  const [queueState, setQueueState]     = useState(null)
  const queueIntervalRef                = useRef(null)

  const refreshQueue = useCallback(async () => {
    try {
      const { data } = await queueAPI.get()
      setQueueState(data)
    } catch { /* silencioso */ }
  }, [])

  useEffect(() => {
    refreshQueue()
    queueIntervalRef.current = setInterval(refreshQueue, 3000)
    return () => clearInterval(queueIntervalRef.current)
  }, [refreshQueue])

  const queueTotal       = (queueState?.active ? 1 : 0) + (queueState?.queue?.length || 0)
  const legacyProcessing = books.filter(b => PROCESSING_STATUSES.includes(b.status))
  const queueCount       = Math.max(queueTotal, legacyProcessing.length)
  const queueIsActive    = !!queueState?.active || legacyProcessing.length > 0
  const queueIsPaused    = queueState?.paused

  const load = async () => {
    try {
      const { data } = await booksAPI.list()
      setBooks(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(() => {
      setBooks(prev => {
        const processing = prev.some(b =>
          ['queued','uploading','identifying','analyzing_structure',
           'summarizing','generating_podcast'].includes(b.status)
        )
        if (processing) load()
        return prev
      })
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  const nonShellBooks = books.filter(b => b.status !== 'shell' && b.status !== 'shell_error')

  // ¿Hay algún libro que no esté completamente analizado? → mostrar filtro de análisis
  const hasNonAnalyzed = nonShellBooks.some(b => !ANALYZED_STATUSES.includes(b.status))

  const filtered = nonShellBooks
    .filter(b => filter === 'all' || b.read_status === filter)
    .filter(b => {
      if (analysisFilter === 'all') return true
      if (analysisFilter === 'analyzed')  return ANALYZED_STATUSES.includes(b.status)
      if (analysisFilter === 'processing') return PROC_STATUSES.includes(b.status)
      if (analysisFilter === 'pending')   return !ANALYZED_STATUSES.includes(b.status) && !PROC_STATUSES.includes(b.status)
      return true
    })
    .filter(b => !search ||
      b.title.toLowerCase().includes(search.toLowerCase()) ||
      b.author?.toLowerCase().includes(search.toLowerCase()))

  const totalReal = nonShellBooks.length

  return (
    <>
    <div className="library-page">
      <div className="library-header">
        <div>
          <h1>Mi Biblioteca</h1>
          <p className="library-sub">
            {totalReal} {totalReal === 1 ? 'libro' : 'libros'}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
          {queueCount > 0 && (
            <button
              className={`queue-header-btn ${queueIsActive && !queueIsPaused ? 'processing' : ''} ${queueIsPaused ? 'paused' : ''}`}
              onClick={() => setQueueOpen(true)}
              title="Ver cola de análisis"
            >
              <Layers size={14} />
              <span>{queueIsPaused ? 'Pausado' : queueIsActive ? 'Analizando…' : 'En cola'}</span>
              <span className="queue-header-btn-count">{queueCount}</span>
            </button>
          )}
          <Link to="/upload" className="btn-upload">+ Añadir libro</Link>
        </div>
      </div>

      <div className="library-controls">
        <div className="search-wrap">
          <Search size={16} />
          <input
            type="text" placeholder="Buscar por título o autor…"
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-tabs">
          {READ_FILTERS.map(f => (
            <button key={f} className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}>
              {READ_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Segunda fila: filtro de estado de análisis — solo si hay libros sin analizar */}
      {hasNonAnalyzed && (
        <div className="analysis-filter-row">
          <span className="analysis-filter-label">Análisis</span>
          <div className="filter-tabs analysis-tabs">
            {ANALYSIS_FILTERS.map(f => {
              // Contar cuántos libros hay en cada estado para el badge
              const count = f === 'all' ? nonShellBooks.length
                : f === 'analyzed'   ? nonShellBooks.filter(b => ANALYZED_STATUSES.includes(b.status)).length
                : f === 'processing' ? nonShellBooks.filter(b => PROC_STATUSES.includes(b.status)).length
                : nonShellBooks.filter(b => !ANALYZED_STATUSES.includes(b.status) && !PROC_STATUSES.includes(b.status)).length
              if (f !== 'all' && count === 0) return null
              return (
                <button
                  key={f}
                  className={`filter-tab ${analysisFilter === f ? 'active' : ''} analysis-tab-${f}`}
                  onClick={() => setAnalysisFilter(f)}
                >
                  {ANALYSIS_LABELS[f]}
                  <span className="analysis-tab-count">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="books-grid">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="book-card-skeleton">
              <div className="skeleton" style={{ height: 200 }} />
              <div className="skeleton" style={{ height: 16, marginTop: 12, width: '70%' }} />
              <div className="skeleton" style={{ height: 12, marginTop: 8, width: '50%' }} />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={48} strokeWidth={1} />
          <h3>No hay libros aquí</h3>
          <p>{search ? 'No se encontraron resultados' : 'Empieza subiendo tu primer libro'}</p>
          {!search && <Link to="/upload" className="btn-upload">Añadir libro</Link>}
        </div>
      ) : (
        <div className="books-grid">
          {filtered.map((book, i) => (
            <motion.div
              key={book.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Link to={`/book/${book.id}`} className="book-card">
                <div className={`book-cover ${book.status === 'shell' || book.status === 'shell_error' ? 'is-shell' : ''}`}>
                  <BookCover
                    src={coverSrc(book)}
                    isbn={book.isbn}
                    title={book.title}
                    author={book.author}
                    alt={book.title}
                    fill
                  />
                  <button
                    className="cover-change-btn"
                    onClick={e => { e.preventDefault(); setCoverPickerBook(book) }}
                    title="Cambiar portada"
                  >✏</button>
                  <div className="cover-status">
                    {book.status === 'complete' || book.phase3_done ? (
                      <span className="cover-badge analyzed">✦ Analizado</span>
                    ) : book.status === 'queued' ? (
                      <span className="cover-badge queued">En cola</span>
                    ) : book.status === 'shell' || book.status === 'shell_error' ? (
                      <span className="cover-badge shell">Solo ficha</span>
                    ) : ['summarizing','analyzing_structure','identifying'].includes(book.status) ? (
                      <span className="cover-badge processing">Procesando…</span>
                    ) : book.phase1_done ? (
                      <span className="cover-badge identified">Identificado</span>
                    ) : null}
                  </div>
                  {(book.status === 'shell' || book.status === 'shell_error') && (
                    <div className="shell-overlay" />
                  )}
                </div>
                <div className="book-info">
                  <h3 className="book-title">{book.title}</h3>
                  {book.author && <p className="book-author">{book.author}</p>}
                  <div className="book-meta">
                    {book.rating && (
                      <span className="book-rating">
                        <Star size={12} fill="currentColor" />
                        {book.rating.toFixed(1)}
                      </span>
                    )}
                    <span className={`read-dot ${book.read_status}`} title={READ_LABELS[book.read_status]} />
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>

    {/* Panel lateral de cola */}
    <AnimatePresence>
      {queueOpen && (
        <>
          <motion.div
            className="queue-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setQueueOpen(false)}
          />
          <QueuePanel onClose={() => setQueueOpen(false)} books={books} />
        </>
      )}
    </AnimatePresence>

    {/* CoverPicker */}
    {coverPickerBook && (
      <CoverPicker
        book={coverPickerBook}
        onSelect={async (url) => {
          try {
            const res = await booksAPI.updateCover(coverPickerBook.id, url)
            setBooks(prev => prev.map(b =>
              b.id === coverPickerBook.id
                ? { ...b, cover_url: res.data.cover_url, cover_local: res.data.cover_local }
                : b
            ))
            toast.success('Portada actualizada')
            load()
          } catch { toast.error('Error al guardar la portada') }
          setCoverPickerBook(null)
        }}
        onUpload={async (file) => {
          try {
            const res = await booksAPI.uploadCover(coverPickerBook.id, file)
            setBooks(prev => prev.map(b =>
              b.id === coverPickerBook.id
                ? { ...b, cover_local: res.data.cover_local, cover_url: null }
                : b
            ))
            toast.success('Portada actualizada')
            load()
          } catch { toast.error('Error al subir la imagen') }
          setCoverPickerBook(null)
        }}
        onClose={() => setCoverPickerBook(null)}
      />
    )}
    </>
  )
}
