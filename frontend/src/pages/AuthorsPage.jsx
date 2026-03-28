import React, { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { authorsAPI, shellAPI } from '../utils/api'
import { BookOpen, User, Clock, ExternalLink } from 'lucide-react'
import './AuthorsPage.css'

export default function AuthorsPage() {
  const [authors, setAuthors] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [autoCreating, setAutoCreating] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(() =>
    authorsAPI.list().then(r => {
      setAuthors(r.data)
      if (selected) {
        const updated = r.data.find(a => a.name === selected.name)
        if (updated) setSelected(updated)
      }
    }).finally(() => setLoading(false))
  , [selected])

  useEffect(() => { load() }, [])

  // Al seleccionar un autor, crea automáticamente fichas para todos los libros
  // de su bibliografía que aún no estén en la app
  const handleSelectAuthor = async (author) => {
    setSelected(author)

    const missing = (author.bibliography || []).filter(item => {
      const title = item.title || item
      const isbn = item.isbn
      // Comprobar por ISBN primero, luego por título
      if (isbn && author.books.some(b => b.isbn === isbn)) return false
      const normalized = title.toLowerCase().trim()
      return !author.books.some(b => b.title.toLowerCase().trim() === normalized)
    })

    if (missing.length === 0) return

    setAutoCreating(true)
    let created = 0
    for (const item of missing) {
      const title = item.title || item
      const isbn = item.isbn || null
      try {
        await shellAPI.create(title, author.name, isbn)
        created++
      } catch {
        // Ya existe o error — ignorar silenciosamente
      }
    }
    setAutoCreating(false)

    if (created > 0) {
      toast(`${created} ficha${created > 1 ? 's' : ''} creada${created > 1 ? 's' : ''} automáticamente`)
      await load()
    }
  }

  if (loading) return (
    <div className="authors-page">
      <div className="page-header"><h1>Autores</h1></div>
      <div className="authors-grid">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="author-card skeleton" style={{ height: 120 }} />
        ))}
      </div>
    </div>
  )

  return (
    <div className="authors-page">
      <div className="page-header">
        <div>
          <h1>Autores</h1>
          <p className="page-sub">
            {authors.length} {authors.length === 1 ? 'autor' : 'autores'} en tu biblioteca
          </p>
        </div>
      </div>

      <div className="authors-layout">
        {/* Lista lateral */}
        <div className="authors-list">
          {authors.length === 0 ? (
            <div className="empty-state">
              <User size={40} strokeWidth={1} />
              <p>Añade libros para ver sus autores aquí</p>
            </div>
          ) : (
            authors.map((author, i) => (
              <motion.div
                key={author.name}
                className={`author-item ${selected?.name === author.name ? 'active' : ''}`}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => handleSelectAuthor(author)}
              >
                <div className="author-avatar-sm">
                  {author.name[0].toUpperCase()}
                </div>
                <div className="author-item-info">
                  <span className="author-item-name">{author.name}</span>
                  <span className="author-item-count">
                    {author.books.length} {author.books.length === 1 ? 'libro' : 'libros'}
                  </span>
                </div>
              </motion.div>
            ))
          )}
        </div>

        {/* Detalle */}
        {selected ? (
          <motion.div
            className="author-detail"
            key={selected.name}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="author-detail-header">
              <div className="author-avatar-lg">
                {selected.name[0].toUpperCase()}
              </div>
              <div>
                <h2>{selected.name}</h2>
                {autoCreating && (
                  <p className="auto-creating">
                    <Clock size={12} className="spin" /> Creando fichas automáticamente…
                  </p>
                )}
              </div>
            </div>

            {selected.bio && (
              <div className="author-section">
                <h3>Biografía</h3>
                <p>{selected.bio}</p>
              </div>
            )}

            {/* Referencias externas del autor */}
            {selected.name && (
              <div className="author-section">
                <h3>Sobre el autor en internet</h3>
                <div className="author-refs-grid">
                  {[
                    { name: 'Wikipedia', icon: '📖', url: `https://es.wikipedia.org/wiki/${encodeURIComponent(selected.name).replace(/%20/g, '_')}` },
                    { name: 'Goodreads', icon: '📚', url: `https://www.goodreads.com/search?q=${encodeURIComponent(selected.name)}&search_type=author` },
                    { name: 'YouTube', icon: '▶️', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(selected.name)}+escritor+entrevista` },
                    { name: 'Twitter/X', icon: '🐦', url: `https://x.com/search?q=${encodeURIComponent(selected.name)}&f=user` },
                    { name: 'Instagram', icon: '📷', url: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(selected.name)}` },
                    { name: 'Google', icon: '🔍', url: `https://www.google.com/search?q=${encodeURIComponent(selected.name)}+escritor` },
                  ].map(link => (
                    <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="author-ref-chip">
                      <span>{link.icon}</span>
                      <span>{link.name}</span>
                      <ExternalLink size={11} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Bibliografía completa como grid de portadas */}
            {selected.books?.length > 0 && (
              <div className="author-section">
                <h3>Bibliografía completa</h3>
                <div className="biblio-covers-grid">
                  {selected.books.map(book => {
                    const isAnalyzed = book.status === 'complete' || book.phase3_done
                    const isShell = book.status === 'shell' || book.status === 'shell_error'
                    const isProcessing = ['summarizing', 'analyzing_structure', 'identifying'].includes(book.status)

                    return (
                      <Link
                        key={book.id}
                        to={`/book/${book.id}`}
                        className={`biblio-cover-card ${isShell ? 'is-shell' : ''} ${isAnalyzed ? 'is-analyzed' : ''}`}
                        title={book.title}
                      >
                        <div className="biblio-cover-img">
                          {book.cover_local ? (
                            <img
                              src={`/data/covers/${book.cover_local.split('/covers/')[1]}`}
                              alt={book.title}
                            />
                          ) : (
                            <div className="biblio-cover-ph">
                              <BookOpen size={18} strokeWidth={1} />
                            </div>
                          )}
                          {isShell && <div className="biblio-shell-overlay" />}
                          <div className="biblio-cover-badge-wrap">
                            {isAnalyzed && <span className="biblio-status-badge analyzed">✦ Analizado</span>}
                            {isShell && <span className="biblio-status-badge shell">Ficha</span>}
                            {isProcessing && <span className="biblio-status-badge processing">Procesando</span>}
                          </div>
                        </div>
                        <span className="biblio-cover-title">{book.title}</span>
                        {book.year && <span className="biblio-cover-year">{book.year}</span>}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          <div className="author-placeholder">
            <User size={48} strokeWidth={1} />
            <p>Selecciona un autor para ver su bibliografía</p>
          </div>
        )}
      </div>
    </div>
  )
}
