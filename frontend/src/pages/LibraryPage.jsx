import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { booksAPI } from '../utils/api'
import { BookOpen, Star, Clock, CheckCircle, Search, Filter } from 'lucide-react'
import BookCover, { coverSrc } from '../components/BookCover'
import CoverPicker from '../components/CoverPicker'
import './LibraryPage.css'

const STATUS_LABELS = {
  uploaded: { label: 'Subido', cls: 'badge-slate' },
  identifying: { label: 'Identificando…', cls: 'badge-gold' },
  identified: { label: 'Identificado', cls: 'badge-green' },
  analyzing_structure: { label: 'Analizando…', cls: 'badge-gold' },
  structured: { label: 'Estructurado', cls: 'badge-green' },
  summarizing: { label: 'Resumiendo…', cls: 'badge-gold' },
  analyzed: { label: 'Analizado', cls: 'badge-green' },
  generating_podcast: { label: 'Podcast…', cls: 'badge-gold' },
  complete: { label: 'Completo', cls: 'badge-green' },
  error: { label: 'Error', cls: 'badge-rust' },
}

const READ_FILTERS = ['all', 'to_read', 'reading', 'read']
const READ_LABELS = { all: 'Todos', to_read: 'Por leer', reading: 'Leyendo', read: 'Leídos' }

export default function LibraryPage() {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [coverPickerBook, setCoverPickerBook] = useState(null)

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
      // Refresh if any book is being processed
      setBooks(prev => {
        const processing = prev.some(b =>
          ['uploading','identifying','analyzing_structure','summarizing','generating_podcast'].includes(b.status)
        )
        if (processing) load()
        return prev
      })
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  const filtered = books
    .filter(b => b.status !== 'shell' && b.status !== 'shell_error') // excluir fichas sin PDF
    .filter(b => filter === 'all' || b.read_status === filter)
    .filter(b => !search || b.title.toLowerCase().includes(search.toLowerCase()) ||
      b.author?.toLowerCase().includes(search.toLowerCase()))

  return (
    <>
    <div className="library-page">
      <div className="library-header">
        <div>
          <h1>Mi Biblioteca</h1>
          <p className="library-sub">{books.filter(b => b.status !== 'shell' && b.status !== 'shell_error').length} {books.filter(b => b.status !== 'shell' && b.status !== 'shell_error').length === 1 ? 'libro' : 'libros'}</p>
        </div>
        <Link to="/upload" className="btn-upload">
          + Añadir libro
        </Link>
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
                  {/* Botón cambiar portada */}
                  <button
                    className="cover-change-btn"
                    onClick={e => { e.preventDefault(); setCoverPickerBook(book) }}
                    title="Cambiar portada"
                  >✏</button>
                  {/* Overlay con estado del análisis */}
                  <div className="cover-status">
                    {book.status === 'complete' || book.phase3_done ? (
                      <span className="cover-badge analyzed">✦ Analizado</span>
                    ) : book.status === 'shell' || book.status === 'shell_error' ? (
                      <span className="cover-badge shell">Solo ficha</span>
                    ) : ['summarizing','analyzing_structure','identifying'].includes(book.status) ? (
                      <span className="cover-badge processing">Procesando…</span>
                    ) : book.phase1_done ? (
                      <span className="cover-badge identified">Identificado</span>
                    ) : null}
                  </div>
                  {/* Overlay semitransparente para libros shell */}
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
    {coverPickerBook && (
      <CoverPicker
        book={coverPickerBook}
        onSelect={async (url) => {
          try {
            await booksAPI.updateCover(coverPickerBook.id, url)
            toast.success('Portada actualizada')
            load()
          } catch {
            toast.error('Error al guardar la portada')
          }
          setCoverPickerBook(null)
        }}
        onUpload={async (file) => {
          try {
            await booksAPI.uploadCover(coverPickerBook.id, file)
            toast.success('Portada actualizada')
            load()
          } catch {
            toast.error('Error al subir la imagen')
          }
          setCoverPickerBook(null)
        }}
        onClose={() => setCoverPickerBook(null)}
      />
    )}
    </>
  )
}
