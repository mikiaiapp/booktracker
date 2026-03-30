import React, { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { authorsAPI, shellAPI } from '../utils/api'
import { BookOpen, User, ExternalLink, Plus } from 'lucide-react'
import './AuthorsPage.css'

export default function AuthorsPage() {
  const [authors, setAuthors] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [creating, setCreating] = useState({})
  const [reidentifying, setReidentifying] = useState(false)
  const [refreshingBook, setRefreshingBook] = useState({})
  const navigate = useNavigate()
  const location = useLocation()

  const load = useCallback(() =>
    authorsAPI.list().then(r => {
      setAuthors(r.data)
      if (selected) {
        const updated = r.data.find(a => a.name === selected.name)
        if (updated) setSelected(updated)
      }
    }).finally(() => setLoading(false))
  , [selected])

  useEffect(() => {
    authorsAPI.list().then(r => {
      setAuthors(r.data)
      setLoading(false)
      // Si venimos desde la ficha de un libro, seleccionar el autor automáticamente
      const targetAuthor = location.state?.author
      if (targetAuthor) {
        const found = r.data.find(a => a.name === targetAuthor)
        if (found) setSelected(found)
      }
    }).catch(() => setLoading(false))
  }, [])

  // Al seleccionar un autor, crea automáticamente fichas para todos los libros
  // de su bibliografía que aún no estén en la app
  const handleSelectAuthor = (author) => {
    setSelected(author)
  }

  const handleReidentifyAuthor = async (authorName) => {
    setReidentifying(true)
    try {
      await authorsAPI.reidentify(authorName)
      toast('Reidentificando autor y creando fichas…', { icon: '⏳' })
      // Poll hasta que termine (aprox 10-30 segundos)
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        await load()
        if (attempts > 20) clearInterval(poll)
      }, 3000)
      setTimeout(() => {
        clearInterval(poll)
        setReidentifying(false)
        toast.success('Autor actualizado')
        load()
      }, 30000)
    } catch {
      toast.error('Error al reidentificar el autor')
      setReidentifying(false)
    }
  }

  const handleRefreshBook = async (bookId) => {
    setRefreshingBook(r => ({ ...r, [bookId]: true }))
    try {
      await authorsAPI.reidentifyBook(bookId)
      toast('Actualizando información del libro…', { icon: '🔄' })
      // Poll hasta que termine
      setTimeout(async () => {
        await load()
        setRefreshingBook(r => ({ ...r, [bookId]: false }))
      }, 8000)
    } catch {
      toast.error('Error al actualizar el libro')
      setRefreshingBook(r => ({ ...r, [bookId]: false }))
    }
  }

  const handleAddShell = async (item, authorName) => {
    const title = typeof item === 'string' ? item : item.title
    const isbn = typeof item === 'string' ? null : (item.isbn || null)
    const key = isbn || title
    setCreating(c => ({ ...c, [key]: true }))
    try {
      const { data } = await shellAPI.create(title, authorName, isbn)
      toast.success(`"${title}" añadida`)
      await load()
      navigate(`/book/${data.id}`)
    } catch (err) {
      if (err.response?.status === 400) {
        toast('Este libro ya está en tu biblioteca')
      } else {
        toast.error('Error al crear la ficha')
      }
    } finally {
      setCreating(c => ({ ...c, [key]: false }))
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
              <div style={{flex:1}}>
                <h2>{selected.name}</h2>
              </div>
              <button
                className="reidentify-author-btn"
                onClick={() => handleReidentifyAuthor(selected.name)}
                disabled={reidentifying}
                title="Actualizar bio, bibliografía y crear fichas completas con portada y sinopsis"
              >
                {reidentifying ? '⏳ Actualizando…' : '↻ Repetir'}
              </button>
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
            {(selected.books?.length > 0 || selected.bibliography?.length > 0) && (
              <div className="author-section">
                <h3>Bibliografía completa</h3>
                <div className="biblio-covers-grid">
                  {/* Libros ya en la app */}
                  {selected.books.map(book => {
                    const isAnalyzed = book.status === 'complete' || book.phase3_done
                    const isShell = book.status === 'shell' || book.status === 'shell_error'
                    const isProcessing = ['summarizing', 'analyzing_structure', 'identifying', 'structured', 'identified'].includes(book.status)
                    const hasFile = !isShell
                    return (
                      <Link
                        key={book.id}
                        to={`/book/${book.id}`}
                        className={`biblio-cover-card ${isShell ? 'is-shell' : ''} ${isAnalyzed ? 'is-analyzed' : ''} ${hasFile && !isAnalyzed ? 'has-file' : ''}`}
                        title={book.title}
                      >
                        <div className="biblio-cover-img">
                          {book.cover_local ? (
                            <img src={`/data/covers/${book.cover_local.split('/covers/')[1]}`} alt={book.title} />
                          ) : (
                            <div className="biblio-cover-ph"><BookOpen size={18} strokeWidth={1} /></div>
                          )}
                          {isShell && <div className="biblio-shell-overlay" />}
                          <div className="biblio-cover-badge-wrap">
                            {isAnalyzed
                              ? <span className="biblio-status-badge analyzed">✦ Analizado</span>
                              : isProcessing
                              ? <span className="biblio-status-badge processing">Procesando…</span>
                              : isShell
                              ? <span className="biblio-status-badge shell">Solo ficha</span>
                              : <span className="biblio-status-badge has-file">Sin analizar</span>
                            }
                          </div>
                        </div>
                        <span className="biblio-cover-title">{book.title}</span>
                        {book.year && <span className="biblio-cover-year">{book.year}</span>}
                        <button
                          className="biblio-refresh-btn"
                          onClick={e => { e.preventDefault(); handleRefreshBook(book.id) }}
                          disabled={refreshingBook[book.id]}
                          title="Actualizar portada, sinopsis e ISBN"
                        >
                          {refreshingBook[book.id] ? '⏳' : '↻'}
                        </button>
                      </Link>
                    )
                  })}

                  {/* Libros de la bibliografía que NO están en la app */}
                  {(selected.bibliography || []).filter(item => {
                    const title = typeof item === 'string' ? item : item.title
                    const isbn = typeof item === 'string' ? null : item.isbn
                    if (!title || title.trim() === '') return false
                    // Comprobar por ISBN
                    if (isbn && selected.books.some(b => b.isbn && b.isbn === isbn)) return false
                    // Comprobar por título (normalizado)
                    const norm = title.toLowerCase().trim()
                    return !selected.books.some(b => {
                      const bt = (b.title || '').toLowerCase().trim()
                      return bt === norm || bt.includes(norm) || norm.includes(bt)
                    })
                  }).map((item, i) => {
                    const title = typeof item === 'string' ? item : item.title
                    const isbn = typeof item === 'string' ? null : item.isbn
                    const key = isbn || title
                    const isCreating = creating[key]
                    return (
                      <div key={i} className="biblio-cover-card is-missing" title={title}>
                        <div className="biblio-cover-img">
                          <div className="biblio-cover-ph">
                            <BookOpen size={18} strokeWidth={1} />
                          </div>
                          <button
                            className="biblio-add-btn"
                            onClick={() => handleAddShell(item, selected.name)}
                            disabled={isCreating}
                            title="Añadir ficha"
                          >
                            {isCreating ? '…' : <Plus size={16} />}
                          </button>
                        </div>
                        <span className="biblio-cover-title">{title}</span>
                      </div>
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
