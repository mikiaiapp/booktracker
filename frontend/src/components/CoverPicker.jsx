/**
 * CoverPicker — modal para elegir portada alternativa.
 * Busca en Google Books y Open Library, muestra miniaturas,
 * y al elegir una llama a onSelect(url).
 */
import React, { useState, useEffect } from 'react'
import { X, Search, Loader } from 'lucide-react'
import './CoverPicker.css'

async function searchCovers(title, author, isbn) {
  const results = []
  const seen = new Set()

  const addCover = (url) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    results.push(url)
  }

  // 1. Google Books por ISBN
  if (isbn) {
    try {
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=5`)
      const d = await r.json()
      for (const item of d.items || []) {
        const links = item.volumeInfo?.imageLinks || {}
        for (const key of ['extraLarge','large','medium','thumbnail','smallThumbnail']) {
          if (links[key]) {
            addCover(links[key].replace('zoom=1','zoom=3').replace('http://','https://'))
            break
          }
        }
      }
    } catch {}
  }

  // 2. Google Books por título + autor
  if (title) {
    try {
      const q = encodeURIComponent(author ? `${title} ${author}` : title)
      const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=10`)
      const d = await r.json()
      for (const item of d.items || []) {
        const links = item.volumeInfo?.imageLinks || {}
        for (const key of ['extraLarge','large','medium','thumbnail','smallThumbnail']) {
          if (links[key]) {
            addCover(links[key].replace('zoom=1','zoom=3').replace('http://','https://'))
            break
          }
        }
      }
    } catch {}
  }

  // 3. Open Library por ISBN
  if (isbn) {
    const sizes = ['L','M']
    for (const s of sizes) {
      addCover(`https://covers.openlibrary.org/b/isbn/${isbn}-${s}.jpg`)
    }
  }

  // 4. Open Library por título
  if (title) {
    try {
      const q = encodeURIComponent(author ? `${title} ${author}` : title)
      const r = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=5`)
      const d = await r.json()
      for (const doc of d.docs || []) {
        if (doc.cover_i) {
          addCover(`https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`)
        }
      }
    } catch {}
  }

  return results
}

export default function CoverPicker({ book, onSelect, onClose }) {
  const [covers, setCovers] = useState([])
  const [loading, setLoading] = useState(true)
  const [customUrl, setCustomUrl] = useState('')
  const [selecting, setSelecting] = useState(null)

  useEffect(() => {
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

        {loading ? (
          <div className="cp-loading"><Loader size={24} className="spin" /> Buscando portadas…</div>
        ) : covers.length === 0 ? (
          <p className="cp-empty">No se encontraron portadas. Prueba con una URL personalizada.</p>
        ) : (
          <div className="cp-grid">
            {covers.map((url, i) => (
              <button
                key={i}
                className={`cp-thumb ${selecting === url ? 'loading' : ''}`}
                onClick={() => handleSelect(url)}
                disabled={!!selecting}
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
        )}

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
              disabled={!customUrl.trim() || !!selecting}
            >
              <Search size={14} /> Usar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
