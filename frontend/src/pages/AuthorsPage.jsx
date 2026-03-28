import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { authorsAPI, shellAPI } from '../utils/api'
import { BookOpen, User, Plus, ExternalLink } from 'lucide-react'
import './AuthorsPage.css'

export default function AuthorsPage() {
  const [authors, setAuthors] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [creating, setCreating] = useState({})
  const navigate = useNavigate()

  const load = () =>
    authorsAPI.list()
      .then(r => {
        setAuthors(r.data)
        // Refrescar el autor seleccionado
        if (selected) {
          const updated = r.data.find(a => a.name === selected.name)
          if (updated) setSelected(updated)
        }
      })
      .finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const handleAddShell = async (title, author) => {
    const key = `${title}__${author}`
    setCreating(c => ({ ...c, [key]: true }))
    try {
      const { data } = await shellAPI.create(title, author)
      toast.success(`"${title}" añadida a tu biblioteca`)
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
        {/* Lista lateral de autores */}
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
                onClick={() => setSelected(author)}
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

        {/* Detalle del autor seleccionado */}
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
              <h2>{selected.name}</h2>
            </div>

            {selected.bio && (
              <div className="author-section">
                <h3>Biografía</h3>
                <p>{selected.bio}</p>
              </div>
            )}

            {/* Libros en la app */}
            <div className="author-section">
              <h3>En tu biblioteca</h3>
              <div className="author-books-grid">
                {selected.books.map(book => (
                  <Link key={book.id} to={`/book/${book.id}`} className="author-book-card">
                    <div className="author-book-cover">
                      {book.cover_local ? (
                        <img
                          src={`/data/covers/${book.cover_local.split('/covers/')[1]}`}
                          alt={book.title}
                        />
                      ) : (
                        <BookOpen size={20} strokeWidth={1} />
                      )}
                    </div>
                    <span className="author-book-title">{book.title}</span>
                    {book.year && <span className="author-book-year">{book.year}</span>}
                    {book.status === 'shell' && (
                      <span className="shell-badge">Solo ficha</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>

            {/* Bibliografía completa */}
            {selected.bibliography?.length > 0 && (
              <div className="author-section">
                <h3>Bibliografía completa</h3>
                <ul className="biblio-list">
                  {selected.bibliography.map((title, i) => {
                    const appBook = selected.books.find(
                      b => b.title.toLowerCase().trim() === title.toLowerCase().trim()
                    )
                    const key = `${title}__${selected.name}`
                    const isCreating = creating[key]

                    return (
                      <li key={i} className="biblio-item">
                        {appBook ? (
                          // Ya en la biblioteca → link a la ficha
                          <Link to={`/book/${appBook.id}`} className="biblio-link">
                            <ExternalLink size={13} />
                            <span>{title}</span>
                            <span className={`biblio-badge ${appBook.status === 'shell' ? 'shell' : 'analyzed'}`}>
                              {appBook.status === 'shell' ? 'Solo ficha' : 'Analizado'}
                            </span>
                          </Link>
                        ) : (
                          // No está → mostrar título + botón añadir ficha
                          <div className="biblio-item-row">
                            <span className="biblio-title">{title}</span>
                            <button
                              className="add-shell-btn"
                              onClick={() => handleAddShell(title, selected.name)}
                              disabled={isCreating}
                              title="Añadir ficha básica sin análisis"
                            >
                              {isCreating
                                ? '…'
                                : <><Plus size={12} /> Añadir ficha</>
                              }
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </motion.div>
        ) : (
          <div className="author-placeholder">
            <User size={48} strokeWidth={1} />
            <p>Selecciona un autor para ver su ficha</p>
          </div>
        )}
      </div>
    </div>
  )
}
