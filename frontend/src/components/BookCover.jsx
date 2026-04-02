/**
 * BookCover — componente reutilizable para portadas de libros.
 * Si no hay src, intenta buscar la portada client-side:
 *   1. Google Books por ISBN
 *   2. Google Books por título
 *   3. Open Library por ISBN
 *
 * Uso: <BookCover src={ob.cover_url} isbn={ob.isbn} title={ob.title} alt={ob.title} />
 */
import React from 'react'
import { BookOpen } from 'lucide-react'

export default function BookCover({ src, alt, size = 60, title, isbn }) {
  const [imgSrc, setImgSrc] = React.useState(src || null)
  const [tried, setTried] = React.useState(false)
  const h = Math.round(size * 1.42)

  React.useEffect(() => {
    if (imgSrc || tried) return
    setTried(true)
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
      // 2. Google Books por título
      if (title) {
        try {
          const q = encodeURIComponent(title)
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
  }, [])

  if (imgSrc) return (
    <img src={imgSrc} alt={alt}
      onError={() => setImgSrc(null)}
      style={{ width: size, height: h, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
  )
  return (
    <div style={{ width: size, height: h, background: '#e8e4dc', borderRadius: 4,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <BookOpen size={size * 0.4} strokeWidth={1} color="#aaa" />
    </div>
  )
}
