import React, { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { authorsAPI, shellAPI, booksAPI } from '../utils/api'
import { BookOpen, User, ExternalLink, Plus } from 'lucide-react'
import BookCover, { coverSrc } from '../components/BookCover'
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

  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSelected, setMergeSelected] = useState([]) // max 2
  const [merging, setMerging] = useState(false)
  const [mergeDialog, setMergeDialog] = useState(null) // { a, b } → elegir cuál es canónico
  const [biblioFilter, setBiblioFilter] = useState('all') // 'all' | 'analyzed' | 'unanalyzed'
  const [deletingBook, setDeletingBook] = useState({})

  const toggleMergeSelect = (author) => {
    setMergeSelected(prev => {
      const exists = prev.find(a => a.name === author.name)
      if (exists) return prev.filter(a => a.name !== author.name)
      if (prev.length >= 2) return prev // máximo 2
      return [...prev, author]
    })
  }

  const handleMergeClick = () => {
    if (mergeSelected.length === 2) {
      setMergeDialog({ a: mergeSelected[0], b: mergeSelected[1] })
    }
  }

  const handleMergeConfirm = async (canonical, redundant) => {
    setMergeDialog(null)
    setMerging(true)
    try {
      await authorsAPI.merge(redundant.name, canonical.name)
      toast.success(`"${redundant.name}" fusionado en "${canonical.name}"`)
      setMergeMode(false)
      setMergeSelected([])
      await load()
    } catch {
      toast.error('Error al fusionar autores')
    } finally {
      setMerging(false)
    }
  }

  const cancelMerge = () => {
    setMergeMode(false)
    setMergeSelected([])
    setMergeDialog(null)
  }

  const handleDeleteBook = async (book) => {
    if (book.phase3_done || book.status === 'complete') {
      toast('No se puede borrar un libro analizado', { icon: '⚠️' })
      return
    }
    if (!window.confirm(`¿Borrar "${book.title}"? Esta acción no se puede deshacer.`)) return
    setDeletingBook(d => ({ ...d, [book.id]: true }))
    try {
      await booksAPI.delete(book.id)
      toast.success(`"${book.title}" eliminado`)
      await load()
    } catch {
      toast.error('Error al eliminar el libro')
    } finally {
      setDeletingBook(d => ({ ...d, [book.id]: false }))
    }
  }

  const handleAddShell = async (item, authorName) => {
    const title = typeof item === 'string' ? item : item.title
    const isbn = typeof item === 'string' ? null : (item.isbn || null)
    const year = typeof item === 'string' ? null : (item.year || null)
    const cover_url = typeof item === 'string' ? null : (item.cover_url || null)
    const synopsis = typeof item === 'string' ? null : (item.synopsis || null)
    const key = isbn || title
    setCreating(c => ({ ...c, [key]: true }))
    try {
      const { data } = await shellAPI.create(title, authorName, isbn, year, cover_url, synopsis)
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
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {mergeMode ? (
            <>
              <span style={{ fontSize: '0.85rem', color: 'var(--mist)' }}>
                {mergeSelected.length === 0 ? 'Selecciona dos autores' :
                 mergeSelected.length === 1 ? 'Selecciona un segundo autor' :
                 `${mergeSelected[0].name} + ${mergeSelected[1].name}`}
              </span>
              <button
                className="merge-confirm-btn"
                onClick={handleMergeClick}
                disabled={mergeSelected.length !== 2 || merging}
              >
                🔀 Fusionar
              </button>
              <button className="merge-cancel-btn" onClick={cancelMerge}>Cancelar</button>
            </>
          ) : (
            <button className="merge-mode-btn" onClick={() => setMergeMode(true)}>
              🔀 Fusionar autores
            </button>
          )}
        </div>
      </div>

      {/* Diálogo: elegir cuál es el nombre canónico */}
      {mergeDialog && (
        <div className="merge-overlay" onClick={() => setMergeDialog(null)}>
          <div className="merge-dialog" onClick={e => e.stopPropagation()}>
            <h3>¿Cuál es el nombre correcto?</h3>
            <p style={{ color: 'var(--mist)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              El nombre elegido será el que quede. Los libros del otro se moverán a este.
            </p>
            <div className="merge-options">
              <button className="merge-option-btn" onClick={() => handleMergeConfirm(mergeDialog.a, mergeDialog.b)}>
                <strong>{mergeDialog.a.name}</strong>
                <span>{mergeDialog.a.books.length} libro{mergeDialog.a.books.length !== 1 ? 's' : ''} en la app</span>
              </button>
              <button className="merge-option-btn" onClick={() => handleMergeConfirm(mergeDialog.b, mergeDialog.a)}>
                <strong>{mergeDialog.b.name}</strong>
                <span>{mergeDialog.b.books.length} libro{mergeDialog.b.books.length !== 1 ? 's' : ''} en la app</span>
              </button>
            </div>
            <button className="merge-cancel-btn" style={{ marginTop: '1rem' }} onClick={() => setMergeDialog(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

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
                className={`author-item ${
                  mergeMode
                    ? mergeSelected.find(a => a.name === author.name) ? 'merge-selected' : ''
                    : selected?.name === author.name ? 'active' : ''
                }`}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => mergeMode ? toggleMergeSelect(author) : handleSelectAuthor(author)}
              >
                <div className="author-avatar-sm">
                  {author.name[0].toUpperCase()}
                </div>
                <div className="author-item-info">
                  <span className="author-item-name">{author.name}</span>
                  <span className="author-item-count">
                    {(() => {
                      // Calcular total de libros únicos en bibliografía
                      const booksInApp = author.books.length
                      const booksInBiblio = (author.bibliography || []).filter(item => {
                        const title = typeof item === 'string' ? item : item.title
                        const isbn = typeof item === 'string' ? null : item.isbn
                        if (!title || title.trim() === '') return false
                        // Comprobar por ISBN
                        if (isbn && author.books.some(b => b.isbn && b.isbn === isbn)) return false
                        // Comprobar por título
                        const norm = title.toLowerCase().trim()
                        return !author.books.some(b => {
                          const bt = (b.title || '').toLowerCase().trim()
                          return bt === norm || bt.includes(norm) || norm.includes(bt)
                        })
                      }).length
                      const total = booksInApp + booksInBiblio
                      return `${total} ${total === 1 ? 'libro' : 'libros'}`
                    })()}
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

            {/* Bibliografía completa en formato Referencias */}
            {(selected.books?.length > 0 || selected.bibliography?.length > 0) && (
              <div className="author-section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h3 style={{ margin: 0 }}>Bibliografía completa</h3>
                  <div className="biblio-filter-tabs">
                    {[['all','Todos'],['analyzed','Analizados'],['unanalyzed','Sin analizar']].map(([val, label]) => (
                      <button
                        key={val}
                        className={`biblio-filter-tab ${biblioFilter === val ? 'active' : ''}`}
                        onClick={() => setBiblioFilter(val)}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                <div className="refs-grid">
                  {/* Libros ya en la app */}
                  {selected.books.filter(book => {
                    const isAnalyzed = book.status === 'complete' || book.phase3_done
                    if (biblioFilter === 'analyzed') return isAnalyzed
                    if (biblioFilter === 'unanalyzed') return !isAnalyzed
                    return true
                  }).map(book => {
                    const isAnalyzed = book.status === 'complete' || book.phase3_done
                    const isShell = book.status === 'shell' || book.status === 'shell_error'
                    const isProcessing = ['summarizing', 'analyzing_structure', 'identifying', 'structured', 'identified'].includes(book.status)
                    const canDelete = !isAnalyzed
                    return (
                      <Link
                        key={book.id}
                        to={`/book/${book.id}`}
                        className="ref-item"
                        style={{ textDecoration: 'none', position: 'relative' }}
                      >
                        <div className="ref-cover">
                          <BookCover
                            src={coverSrc(book)}
                            isbn={book.isbn}
                            title={book.title}
                            alt={book.title}
                            size={60}
                          />
                        </div>
                        <div className="ref-info">
                          <h4 className="ref-title">{book.title}</h4>
                          {book.year && <span className="ref-year">{book.year}</span>}
                          {isAnalyzed && <span className="ref-badge" style={{ fontSize: '0.75rem', color: 'var(--gold)', fontWeight: '500' }}>✦ Analizado</span>}
                          {isProcessing && <span className="ref-badge" style={{ fontSize: '0.75rem', color: '#f39c12' }}>Procesando…</span>}
                          {isShell && <span className="ref-badge" style={{ fontSize: '0.75rem', color: 'var(--mist)' }}>Solo ficha</span>}
                          {!isShell && !isAnalyzed && !isProcessing && <span className="ref-badge" style={{ fontSize: '0.75rem', color: '#3498db' }}>Sin analizar</span>}
                        </div>
                        <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', display: 'flex', gap: '4px' }}>
                          <button
                            className="ref-refresh-btn"
                            onClick={e => { e.preventDefault(); handleRefreshBook(book.id) }}
                            disabled={refreshingBook[book.id]}
                            title="Actualizar portada, sinopsis e ISBN"
                            style={{ background: 'white', border: '1.5px solid #ddd', borderRadius: '4px', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.9rem' }}
                          >
                            {refreshingBook[book.id] ? '⏳' : '↻'}
                          </button>
                          {canDelete && (
                            <button
                              onClick={e => { e.preventDefault(); handleDeleteBook(book) }}
                              disabled={deletingBook[book.id]}
                              title="Eliminar libro"
                              style={{ background: 'white', border: '1.5px solid #e74c3c', borderRadius: '4px', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.85rem', color: '#e74c3c' }}
                            >
                              {deletingBook[book.id] ? '⏳' : '×'}
                            </button>
                          )}
                        </div>
                      </Link>
                    )
                  })}

                  {/* Libros de la bibliografía que NO están en la app */}
                  {biblioFilter !== 'analyzed' && (selected.bibliography || []).filter(item => {
                    const title = typeof item === 'string' ? item : item.title
                    const isbn = typeof item === 'string' ? null : item.isbn
                    if (!title || title.trim() === '') return false
                    if (isbn && selected.books.some(b => b.isbn && b.isbn === isbn)) return false
                    const norm = title.toLowerCase().trim()
                    return !selected.books.some(b => {
                      const bt = (b.title || '').toLowerCase().trim()
                      return bt === norm || bt.includes(norm) || norm.includes(bt)
                    })
                  }).map((item, i) => {
                    const title = typeof item === 'string' ? item : item.title
                    const isbn = typeof item === 'string' ? null : item.isbn
                    const year = typeof item === 'string' ? null : item.year
                    const cover_url = typeof item === 'string' ? null : item.cover_url
                    const key = isbn || title
                    const isCreating = creating[key]
                    return (
                      <div key={i} className="ref-item" style={{ position: 'relative', opacity: 0.8 }}>
                        <div className="ref-cover">
                          <BookCover
                            src={cover_url || null}
                            isbn={isbn}
                            title={title}
                            alt={title}
                            size={60}
                          />
                        </div>
                        <div className="ref-info">
                          <h4 className="ref-title">{title}</h4>
                          {year && <span className="ref-year">{year}</span>}
                          <span className="ref-badge" style={{ fontSize: '0.75rem', color: '#95a5a6' }}>No añadido</span>
                        </div>
                        <button
                          className="ref-add-btn"
                          onClick={() => handleAddShell(item, selected.name)}
                          disabled={isCreating}
                          title="Añadir ficha"
                          style={{
                            position: 'absolute',
                            top: '0.5rem',
                            right: '0.5rem',
                            background: 'var(--gold)',
                            border: 'none',
                            borderRadius: '50%',
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: 'var(--ink)'
                          }}
                        >
                          {isCreating ? '…' : <Plus size={16} />}
                        </button>
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
