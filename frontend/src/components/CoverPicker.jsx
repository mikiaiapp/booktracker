/**
 * CoverPicker — modal para elegir portada alternativa.
 * Opciones: elegir de resultados web, pegar URL, o subir archivo local.
 */
import React, { useState, useEffect, useRef } from 'react'
import { X, Search, Loader, Upload } from 'lucide-react'
import './CoverPicker.css'

/** Extrae la mejor URL de imageLinks de Google Books */
function gbBestCover(links) {
  for (const key of ['extraLarge', 'large', 'medium', 'small', 'thumbnail', 'smallThumbnail']) {
    if (links[key]) return links[key].replace(/zoom=\d/, 'zoom=3').replace('http://', 'https://')
  }
  return null
}

async function searchCovers(title, author, isbn) {
  const seen = new Set()
  const buckets = [] // array de arrays, para intercalar resultados de fuentes distintas

  const collect = async (fn) => {
    try { return await fn() } catch { return [] }
  }

  // ── Todas las búsquedas en paralelo ──────────────────────────────────────
  const [
    gbIsbn,
    gbTitleAuthor,
    gbTitleOnly,
    gbAuthorOnly,
    gbTitleEs,
    olIsbnL, olIsbnM,
    olTitleAuthor,
    olTitleOnly,
    olAuthorOnly,
  ] = await Promise.all([

    // 1. Google Books — ISBN (máxima precisión)
    collect(async () => {
      if (!isbn) return []
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=10`)
      const d = await r.json()
      return (d.items || []).map(i => gbBestCover(i.volumeInfo?.imageLinks || {})).filter(Boolean)
    }),

    // 2. Google Books — título + autor
    collect(async () => {
      if (!title) return []
      const q = encodeURIComponent(author ? `intitle:${title} inauthor:${author}` : `intitle:${title}`)
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=20`)
      const d = await r.json()
      return (d.items || []).map(i => gbBestCover(i.volumeInfo?.imageLinks || {})).filter(Boolean)
    }),

    // 3. Google Books — solo título (captura ediciones sin autor bien catalogado)
    collect(async () => {
      if (!title) return []
      const q = encodeURIComponent(`intitle:${title}`)
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=20`)
      const d = await r.json()
      return (d.items || []).map(i => gbBestCover(i.volumeInfo?.imageLinks || {})).filter(Boolean)
    }),

    // 4. Google Books — solo autor (trae toda su bibliografía con portadas)
    collect(async () => {
      if (!author) return []
      const q = encodeURIComponent(`inauthor:${author} intitle:${title || ''}`)
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=20`)
      const d = await r.json()
      return (d.items || []).map(i => gbBestCover(i.volumeInfo?.imageLinks || {})).filter(Boolean)
    }),

    // 5. Google Books — búsqueda libre en español (langRestrict)
    collect(async () => {
      if (!title) return []
      const q = encodeURIComponent(`${title} ${author || ''}`.trim())
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&langRestrict=es&maxResults=20`)
      const d = await r.json()
      return (d.items || []).map(i => gbBestCover(i.volumeInfo?.imageLinks || {})).filter(Boolean)
    }),

    // 6. Open Library — ISBN tamaño L
    collect(async () => {
      if (!isbn) return []
      return [`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`]
    }),

    // 7. Open Library — ISBN tamaño M (distinta URL, puede funcionar cuando L falla)
    collect(async () => {
      if (!isbn) return []
      return [`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`]
    }),

    // 8. Open Library — búsqueda título + autor, extrae cover_i y work_id
    collect(async () => {
      if (!title) return []
      const q = encodeURIComponent(`${title} ${author || ''}`.trim())
      const r = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=15&fields=cover_i,key`)
      const d = await r.json()
      const urls = []
      for (const doc of d.docs || []) {
        if (doc.cover_i) {
          urls.push(`https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`)
        }
        // Work covers (distintos de edition covers)
        if (doc.key) {
          const workId = doc.key.replace('/works/', '')
          urls.push(`https://covers.openlibrary.org/b/works/${workId}-L.jpg`)
        }
      }
      return urls
    }),

    // 9. Open Library — solo título
    collect(async () => {
      if (!title) return []
      const q = encodeURIComponent(title)
      const r = await fetch(`https://openlibrary.org/search.json?title=${q}&limit=10&fields=cover_i`)
      const d = await r.json()
      return (d.docs || []).filter(doc => doc.cover_i)
        .map(doc => `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`)
    }),

    // 10. Open Library — solo autor
    collect(async () => {
      if (!author) return []
      const q = encodeURIComponent(author)
      const r = await fetch(`https://openlibrary.org/search.json?author=${q}&q=${encodeURIComponent(title || '')}&limit=10&fields=cover_i`)
      const d = await r.json()
      return (d.docs || []).filter(doc => doc.cover_i)
        .map(doc => `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`)
    }),
  ])

  // Intercalar resultados de todas las fuentes para mostrar variedad desde el inicio
  buckets.push(gbIsbn, gbTitleAuthor, gbTitleEs, gbTitleOnly, gbAuthorOnly,
               olIsbnL, olIsbnM, olTitleAuthor, olTitleOnly, olAuthorOnly)

  const results = []
  const maxLen = Math.max(...buckets.map(b => b.length))
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of buckets) {
      const url = bucket[i]
      if (url && !seen.has(url)) {
        seen.add(url)
        results.push(url)
      }
    }
  }

  return results
}

export default function CoverPicker({ book, onSelect, onUpload, onClose }) {
  const [covers, setCovers] = useState([])
  const [loading, setLoading] = useState(true)
  const [customUrl, setCustomUrl] = useState('')
  const [selecting, setSelecting] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    setCovers([])
    searchCovers(book.title, book.author, book.isbn).then(r => {
      setCovers(r)
      setLoading(false)
    })
  }, [book.id])

  const handleSelect = async (url) => {
    setSelecting(url)
    await onSelect(url)
    setSelecting(null)
  }

  const handleFileUpload = async (file) => {
    if (!file) return
    const isImage = file.type.startsWith('image/') ||
      /\.(avif|webp|heic|heif|tiff?|bmp|ico|jfif|pjpeg|pjp|svg)$/i.test(file.name)
    if (!isImage) return
    setUploading(true)
    try {
      await onUpload(file)
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-modal" onClick={e => e.stopPropagation()}>
        <div className="cp-header">
          <div>
            <h3 className="cp-title">Elegir portada</h3>
            <p className="cp-sub">{book.title}</p>
          </div>
          <button className="cp-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Sección de subida de archivo */}
        <div className="cp-upload-section">
          <div
            className={`cp-dropzone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading
              ? <><Loader size={20} className="spin" /> Subiendo imagen…</>
              : <><Upload size={18} /> Sube desde tu equipo — arrastra o haz clic<br/><small style={{opacity:0.6,fontSize:'0.7rem'}}>JPG · PNG · WebP · AVIF · HEIC · BMP · TIFF · GIF y más</small></>
            }
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.avif,.webp,.heic,.heif,.tiff,.tif,.bmp,.ico,.svg,.jfif,.pjpeg,.pjp"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }}
          />
        </div>

        {/* Resultados de búsqueda */}
        {loading ? (
          <div className="cp-loading"><Loader size={24} className="spin" /> Buscando portadas…</div>
        ) : covers.length === 0 ? (
          <p className="cp-empty">No se encontraron portadas en internet.</p>
        ) : (
          <>
            <p className="cp-count">{covers.length} portadas encontradas</p>
            <div className="cp-grid">
              {covers.map((url, i) => (
                <button
                  key={i}
                  className={`cp-thumb ${selecting === url ? 'loading' : ''}`}
                  onClick={() => handleSelect(url)}
                  disabled={!!selecting || uploading}
                >
                  <img
                    src={url}
                    alt={`Portada ${i + 1}`}
                    onError={e => { e.target.closest('.cp-thumb').style.display = 'none' }}
                  />
                  {selecting === url && <div className="cp-thumb-overlay"><Loader size={16} className="spin" /></div>}
                </button>
              ))}
            </div>
          </>
        )}

        {/* URL personalizada */}
        <div className="cp-custom">
          <p className="cp-custom-label">O introduce una URL de imagen:</p>
          <div className="cp-custom-row">
            <input
              type="text"
              placeholder="https://..."
              value={customUrl}
              onChange={e => setCustomUrl(e.target.value)}
              className="cp-custom-input"
            />
            <button
              className="cp-custom-btn"
              onClick={() => customUrl.trim() && handleSelect(customUrl.trim())}
              disabled={!customUrl.trim() || !!selecting || uploading}
            >
              <Search size={14} /> Usar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
