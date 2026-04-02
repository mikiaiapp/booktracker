import React, { useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  Upload, FileText, CheckCircle, AlertCircle,
  Layers, X, Clock, Loader, Play, BookOpen,
  ChevronDown, ChevronUp
} from 'lucide-react'
import { booksAPI } from '../utils/api'
import './UploadPage.css'

// ── Modo único (original) ──────────────────────────────────────────────────────
function SingleUpload() {
  const [file, setFile]       = useState(null)
  const [progress, setProgress] = useState(0)
  const [state, setState]     = useState('idle') // idle | uploading | done | error
  const navigate = useNavigate()

  const onDrop = useCallback((accepted) => {
    if (accepted[0]) setFile(accepted[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'], 'application/epub+zip': ['.epub'] },
    maxFiles: 1,
    maxSize: 200 * 1024 * 1024,
  })

  const handleUpload = async () => {
    if (!file) return
    setState('uploading'); setProgress(0)
    try {
      const { data } = await booksAPI.upload(file, setProgress)
      setState('done')
      toast.success('Libro subido. La identificación ha comenzado.')
      setTimeout(() => navigate(`/book/${data.id}`), 1200)
    } catch (err) {
      setState('error')
      toast.error(err.response?.data?.detail || 'Error al subir el archivo')
    }
  }

  const fmt = (bytes) => bytes < 1024*1024
    ? `${(bytes/1024).toFixed(0)} KB`
    : `${(bytes/1024/1024).toFixed(1)} MB`

  return (
    <>
      {state === 'idle' || state === 'error' ? (
        <>
          <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''} ${file ? 'has-file' : ''}`}>
            <input {...getInputProps()} />
            <AnimatePresence mode="wait">
              {file ? (
                <motion.div key="file" className="file-preview"
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                  <FileText size={40} strokeWidth={1} />
                  <div><strong>{file.name}</strong><span>{fmt(file.size)}</span></div>
                </motion.div>
              ) : (
                <motion.div key="empty" className="dropzone-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="drop-icon"><Upload size={36} strokeWidth={1} /></div>
                  <p className="drop-title">{isDragActive ? 'Suelta aquí el archivo' : 'Arrastra tu libro aquí'}</p>
                  <p className="drop-sub">o haz clic para seleccionar</p>
                  <div className="drop-formats"><span>PDF</span><span>EPUB</span><span>Hasta 200 MB</span></div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {file && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <button className="upload-btn" onClick={handleUpload}>
                <Upload size={16} /> Subir y analizar
              </button>
              <button className="change-btn" onClick={() => setFile(null)}>Cambiar archivo</button>
            </motion.div>
          )}
        </>
      ) : state === 'uploading' ? (
        <motion.div className="upload-progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="progress-icon"><Upload size={32} strokeWidth={1} className="uploading-icon" /></div>
          <p className="progress-label">Subiendo {file.name}</p>
          <div className="progress-bar">
            <motion.div className="progress-fill" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ ease: 'linear' }} />
          </div>
          <span className="progress-pct">{progress}%</span>
        </motion.div>
      ) : (
        <motion.div className="upload-done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <CheckCircle size={48} strokeWidth={1} />
          <p>Libro subido correctamente</p>
          <p className="done-sub">Redirigiendo al análisis…</p>
        </motion.div>
      )}
    </>
  )
}

// ── Modo masivo ────────────────────────────────────────────────────────────────
const STATUS_LABEL = {
  pending:    { text: 'En cola',      color: '#8a9aaa', icon: Clock        },
  uploading:  { text: 'Subiendo…',    color: '#c9a96e', icon: Upload       },
  uploaded:   { text: 'Subido',       color: '#c9a96e', icon: CheckCircle  },
  processing: { text: 'Procesando…',  color: '#c9a96e', icon: Loader       },
  done:       { text: 'Listo',        color: '#2d5a3d', icon: CheckCircle  },
  error:      { text: 'Error',        color: '#c0392b', icon: AlertCircle  },
}

function BulkUpload() {
  const [files, setFiles]   = useState([])   // [{file, id, status, bookId, error}]
  const [running, setRunning] = useState(false)
  const [doneCount, setDoneCount] = useState(0)
  const [showDone, setShowDone]   = useState(false)
  const navigate = useNavigate()

  const onDrop = useCallback((accepted) => {
    const newFiles = accepted.map(f => ({
      file: f,
      id: Math.random().toString(36).slice(2),
      status: 'pending',
      bookId: null,
      error: null,
      progress: 0,
    }))
    setFiles(prev => {
      // Evitar duplicados por nombre
      const names = new Set(prev.map(f => f.file.name))
      return [...prev, ...newFiles.filter(f => !names.has(f.file.name))]
    })
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'], 'application/epub+zip': ['.epub'] },
    maxSize: 200 * 1024 * 1024,
    // Sin maxFiles — permitir múltiples
  })

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const updateFile = (id, patch) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }

  const pending = files.filter(f => f.status === 'pending')
  const done    = files.filter(f => f.status === 'done' || f.status === 'error')
  const active  = files.filter(f => f.status === 'uploading' || f.status === 'processing')

  const startBulk = async () => {
    if (!pending.length || running) return
    setRunning(true)

    for (const item of pending) {
      updateFile(item.id, { status: 'uploading' })
      try {
        const { data } = await booksAPI.upload(
          item.file,
          (pct) => updateFile(item.id, { progress: pct })
        )
        updateFile(item.id, { status: 'done', bookId: data.id })
        setDoneCount(n => n + 1)
      } catch (err) {
        const msg = err.response?.data?.detail || 'Error al subir'
        updateFile(item.id, { status: 'error', error: msg })
      }

      // Pausa mínima entre subidas para no saturar el backend
      // (el análisis va en background — la subida en sí no toca el modelo de IA)
      await new Promise(r => setTimeout(r, 800))
    }

    setRunning(false)
    toast.success(`${doneCount} libro${doneCount !== 1 ? 's' : ''} subido${doneCount !== 1 ? 's' : ''} correctamente`)
  }

  const fmt = (bytes) => bytes < 1024*1024
    ? `${(bytes/1024).toFixed(0)} KB`
    : `${(bytes/1024/1024).toFixed(1)} MB`

  return (
    <div className="bulk-container">
      {/* Zona de drop */}
      <div {...getRootProps()} className={`dropzone bulk-drop ${isDragActive ? 'active' : ''}`}>
        <input {...getInputProps()} />
        <div className="dropzone-content">
          <div className="drop-icon"><Layers size={32} strokeWidth={1} /></div>
          <p className="drop-title">{isDragActive ? 'Suelta los archivos' : 'Arrastra varios libros aquí'}</p>
          <p className="drop-sub">o haz clic para seleccionar múltiples archivos</p>
          <div className="drop-formats"><span>PDF</span><span>EPUB</span><span>Varios a la vez</span></div>
        </div>
      </div>

      {files.length > 0 && (
        <motion.div className="bulk-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {/* Cabecera con stats */}
          <div className="bulk-header">
            <div className="bulk-stats">
              <span className="bulk-total"><strong>{files.length}</strong> archivo{files.length !== 1 ? 's' : ''}</span>
              {doneCount > 0 && <span className="bulk-done-count">✓ {doneCount} completado{doneCount !== 1 ? 's' : ''}</span>}
              {active.length > 0 && <span className="bulk-active-count">⟳ {active.length} en curso</span>}
              {pending.length > 0 && !running && <span className="bulk-pending-count">⏳ {pending.length} en espera</span>}
            </div>
            <div className="bulk-actions">
              {pending.length > 0 && !running && (
                <button className="bulk-start-btn" onClick={startBulk}>
                  <Play size={15} /> Iniciar subida masiva
                </button>
              )}
              {running && (
                <span className="bulk-running-badge">
                  <Loader size={13} className="spin" /> Subiendo…
                </span>
              )}
              {!running && pending.length === 0 && done.length > 0 && (
                <Link to="/" className="bulk-library-btn">
                  <BookOpen size={15} /> Ver biblioteca
                </Link>
              )}
            </div>
          </div>

          {/* Lista de archivos pendientes / en curso */}
          <div className="bulk-list">
            {files.filter(f => f.status !== 'done' && f.status !== 'error').map(item => {
              const s = STATUS_LABEL[item.status]
              const Icon = s.icon
              return (
                <div key={item.id} className={`bulk-item bulk-item-${item.status}`}>
                  <div className="bulk-item-icon">
                    {item.status === 'uploading' || item.status === 'processing'
                      ? <Loader size={16} className="spin" style={{ color: s.color }} />
                      : <Icon size={16} style={{ color: s.color }} />
                    }
                  </div>
                  <div className="bulk-item-info">
                    <span className="bulk-item-name">{item.file.name}</span>
                    <span className="bulk-item-size">{fmt(item.file.size)}</span>
                  </div>
                  <div className="bulk-item-right">
                    {item.status === 'uploading' && (
                      <div className="bulk-progress-wrap">
                        <div className="bulk-progress-bar">
                          <div className="bulk-progress-fill" style={{ width: `${item.progress}%` }} />
                        </div>
                        <span className="bulk-progress-pct">{item.progress}%</span>
                      </div>
                    )}
                    {item.status === 'pending' && !running && (
                      <button className="bulk-remove-btn" onClick={() => removeFile(item.id)} title="Quitar">
                        <X size={14} />
                      </button>
                    )}
                    <span className="bulk-item-status" style={{ color: s.color }}>{s.text}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Sección colapsable de completados/errores */}
          {done.length > 0 && (
            <div className="bulk-done-section">
              <button className="bulk-done-toggle" onClick={() => setShowDone(v => !v)}>
                {showDone ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {done.length} archivo{done.length !== 1 ? 's' : ''} completado{done.length !== 1 ? 's' : ''}
              </button>
              {showDone && (
                <div className="bulk-list bulk-list-done">
                  {done.map(item => {
                    const s = STATUS_LABEL[item.status]
                    const Icon = s.icon
                    return (
                      <div key={item.id} className={`bulk-item bulk-item-${item.status}`}>
                        <div className="bulk-item-icon">
                          <Icon size={16} style={{ color: s.color }} />
                        </div>
                        <div className="bulk-item-info">
                          <span className="bulk-item-name">{item.file.name}</span>
                          {item.error && <span className="bulk-item-error">{item.error}</span>}
                        </div>
                        <div className="bulk-item-right">
                          {item.bookId && (
                            <Link to={`/book/${item.bookId}`} className="bulk-view-btn">Ver →</Link>
                          )}
                          <span className="bulk-item-status" style={{ color: s.color }}>{s.text}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Nota sobre el procesamiento en background */}
          <div className="bulk-note">
            <Clock size={13} />
            <span>
              Los libros se analizan en background uno a uno.
              Con <strong>GPT-4o</strong> (tier prepago): <strong>3 s entre capítulos</strong> — límite 500 RPM, más que suficiente.
              Con <strong>Gemini gratuito</strong>: <strong>25 s entre capítulos</strong> — límite 15 RPM.
            </span>
          </div>
        </motion.div>
      )}
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function UploadPage() {
  const [mode, setMode] = useState('single') // 'single' | 'bulk'

  return (
    <div className="upload-page">
      <div className="upload-header">
        <h1>Añadir libro{mode === 'bulk' ? 's' : ''}</h1>
        <p>{mode === 'single'
          ? 'Sube un archivo PDF o EPUB para comenzar el análisis con IA'
          : 'Sube varios archivos a la vez — se procesarán secuencialmente'
        }</p>
      </div>

      {/* Toggle modo */}
      <div className="upload-mode-toggle">
        <button
          className={`mode-btn ${mode === 'single' ? 'active' : ''}`}
          onClick={() => setMode('single')}
        >
          <Upload size={15} /> Un libro
        </button>
        <button
          className={`mode-btn ${mode === 'bulk' ? 'active' : ''}`}
          onClick={() => setMode('bulk')}
        >
          <Layers size={15} /> Subida masiva
        </button>
      </div>

      <div className="upload-card">
        <AnimatePresence mode="wait">
          {mode === 'single' ? (
            <motion.div key="single" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <SingleUpload />
            </motion.div>
          ) : (
            <motion.div key="bulk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <BulkUpload />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {mode === 'single' && (
        <div className="upload-steps">
          <h2>¿Qué ocurrirá a continuación?</h2>
          <div className="steps-grid">
            {[
              { n: '01', title: 'Identificación', desc: 'Extraemos título, autor, ISBN, portada, sinopsis y datos del autor desde la web.' },
              { n: '02', title: 'Estructura',     desc: 'Detectamos partes y capítulos del libro para organizar el análisis.' },
              { n: '03', title: 'Análisis IA',    desc: 'Resumen detallado capítulo a capítulo, perfiles de personajes, mapa mental y podcast.' },
            ].map((s, i) => (
              <motion.div key={s.n} className="step-card"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}>
                <span className="step-num">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {mode === 'bulk' && (
        <div className="upload-steps">
          <h2>Cómo funciona la subida masiva</h2>
          <div className="steps-grid">
            {[
              { n: '01', title: 'Selección', desc: 'Arrastra todos los PDFs/EPUBs de una carpeta o selecciónalos con el selector de archivos.' },
              { n: '02', title: 'Cola de subida', desc: 'Los archivos se suben secuencialmente con 3 s de pausa entre cada uno.' },
              { n: '03', title: 'Análisis automático', desc: 'Cada libro se analiza en background. GPT-4o (prepago): 3 s entre capítulos. Gemini gratuito: 25 s entre capítulos.' },
            ].map((s, i) => (
              <motion.div key={s.n} className="step-card"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}>
                <span className="step-num">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
