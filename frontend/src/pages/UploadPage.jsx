import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react'
import { booksAPI } from '../utils/api'
import './UploadPage.css'

export default function UploadPage() {
  const [file, setFile] = useState(null)
  const [progress, setProgress] = useState(0)
  const [state, setState] = useState('idle') // idle | uploading | done | error
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
    setState('uploading')
    setProgress(0)
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

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div className="upload-page">
      <div className="upload-header">
        <h1>Añadir libro</h1>
        <p>Sube un archivo PDF o EPUB para comenzar el análisis con IA</p>
      </div>

      <div className="upload-card">
        {state === 'idle' || state === 'error' ? (
          <>
            <div
              {...getRootProps()}
              className={`dropzone ${isDragActive ? 'active' : ''} ${file ? 'has-file' : ''}`}
            >
              <input {...getInputProps()} />
              <AnimatePresence mode="wait">
                {file ? (
                  <motion.div key="file" className="file-preview"
                    initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                    <FileText size={40} strokeWidth={1} />
                    <div>
                      <strong>{file.name}</strong>
                      <span>{formatSize(file.size)}</span>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="empty" className="dropzone-content"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <div className="drop-icon">
                      <Upload size={36} strokeWidth={1} />
                    </div>
                    <p className="drop-title">
                      {isDragActive ? 'Suelta aquí el archivo' : 'Arrastra tu libro aquí'}
                    </p>
                    <p className="drop-sub">o haz clic para seleccionar</p>
                    <div className="drop-formats">
                      <span>PDF</span>
                      <span>EPUB</span>
                      <span>Hasta 200 MB</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {file && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <button className="upload-btn" onClick={handleUpload} disabled={state === 'uploading'}>
                  <Upload size={16} />
                  Subir y analizar
                </button>
                <button className="change-btn" onClick={() => setFile(null)}>
                  Cambiar archivo
                </button>
              </motion.div>
            )}
          </>
        ) : state === 'uploading' ? (
          <motion.div className="upload-progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="progress-icon">
              <Upload size={32} strokeWidth={1} className="uploading-icon" />
            </div>
            <p className="progress-label">Subiendo {file.name}</p>
            <div className="progress-bar">
              <motion.div
                className="progress-fill"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ ease: 'linear' }}
              />
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
      </div>

      <div className="upload-steps">
        <h2>¿Qué ocurrirá a continuación?</h2>
        <div className="steps-grid">
          {[
            { n: '01', title: 'Identificación', desc: 'Extraemos título, autor, ISBN, portada, sinopsis y datos del autor desde la web.' },
            { n: '02', title: 'Estructura', desc: 'Detectamos partes y capítulos del libro para organizar el análisis.' },
            { n: '03', title: 'Análisis IA', desc: 'Resumen detallado capítulo a capítulo, perfiles de personajes, mapa mental y podcast.' },
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
    </div>
  )
}
