/**
 * BookCover — portada de libro con fallback progresivo.
 *
 * Exporta también `coverSrc(book)` como helper para construir
 * la URL de cover_local de forma consistente en toda la app.
 *
 * Fallback: cover_local → cover_url → Google Books (ISBN) →
 *           Google Books (título) → Open Library (ISBN) → placeholder
 */
import React from 'react'
import { BookOpen } from 'lucide-react'

/** Convierte la ruta absoluta del servidor en URL servible por nginx */
export function coverSrc(book) {
  if (!book) return null
  if (book.cover_local) {
    const parts = book.cover_local.split('/covers/')
    if (parts.length >= 2) return `/data/covers/${parts[parts.length - 1]}`
  }
  return book.cover_url || null
}

export default function BookCover({ src, alt, size = 60, title, isbn, author, fill = false }) {
  const [imgSrc, setImgSrc] = React.useState(src || null)
  const [fetching, setFetching] = React.useState(false)
  const h = Math.round(size * 1.42)

  // Resetear cuando cambia src (p.ej. el padre recarga datos)
  React.useEffect(() => {
    setImgSrc(src || null)
    setFetching(false)
  }, [src])

  // Buscar portada externamente solo si no tenemos src
  React.useEffect(() => {
    if (imgSrc || fetching) return
    if (!isbn && !title) return
    setFetching(true)

    const fetchCover = async () => {
      // 1. Google Books por ISBN
      if (isbn) {
        try {
          const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`)
          const data = await r.json()
          const links = data.items?.[0]?.volumeInfo?.imageLinks
          if (links) {
            const url = (links.thumbnail || links.smallThumbnail || '')
              .replace('zoom=1', 'zoom=2').replace('http://', 'https://')
            if (url) { setImgSrc(url); return }
          }
        } catch {}
      }
      // 2. Google Books por título + autor (más preciso que solo título)
      if (title) {
        try {
          const q = encodeURIComponent(author ? `${title} ${author}` : title)
          const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`)
          const data = await r.json()
          const links = data.items?.[0]?.volumeInfo?.imageLinks
          if (links) {
            const url = (links.thumbnail || links.smallThumbnail || '')
              .replace('zoom=1', 'zoom=2').replace('http://', 'https://')
            if (url) { setImgSrc(url); return }
          }
        } catch {}
      }
      // 3. Open Library por ISBN
      if (isbn) {
        setImgSrc(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`)
      }
    }
    fetchCover()
  }, [imgSrc, fetching, isbn, title, author])

  if (imgSrc) return (
    <img
      src={imgSrc}
      alt={alt}
      onError={() => setImgSrc(null)}
      style={fill
        ? { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
        : { width: size, height: h, objectFit: 'cover', borderRadius: 4, display: 'block' }
      }
    />
  )

  return (
    <div style={fill
      ? { width: '100%', height: '100%', background: '#e8e4dc', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '0.5rem' }
      : { width: size, height: h, background: '#e8e4dc', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }
    }>
      <BookOpen size={fill ? 32 : size * 0.4} strokeWidth={1} color="#aaa" />
      {fill && <span style={{ fontSize: '0.65rem', letterSpacing: '0.1em', fontWeight: 500, color: '#aaa' }}>FICHA</span>}
    </div>
  )
}
