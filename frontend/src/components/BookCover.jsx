/**
 * BookCover — portada de libro con fallback progresivo.
 *
 * Exporta también `coverSrc(book)` como helper para construir
 * la URL de cover_local de forma consistente en toda la app.
 *
 * Prioridad: src (cover_local / cover_url del libro) →
 *            Google Books (ISBN) → Google Books (título+autor) →
 *            Open Library (ISBN) → placeholder
 *
 * Correcciones respecto a la versión anterior:
 * - Eliminada la race condition entre el reset de src y el flag `fetching`.
 *   El estado `fetching` causaba que, si el padre recargaba datos y src
 *   llegaba ya con valor, el componente se quedaba bloqueado sin mostrar la
 *   imagen hasta recargar la página.
 * - El fallback externo ahora se guarda separado de src, de modo que cuando
 *   src llega (p.ej. tras el polling de la biblioteca), tiene prioridad
 *   inmediata sin necesidad de resetear nada.
 * - Se añade `cancelled` flag para evitar setState en componentes desmontados.
 */
import React from 'react'
import { BookOpen } from 'lucide-react'

/** Convierte la ruta absoluta del servidor en URL servible por nginx.
 *  Las blob: o data: URLs son previsualizaciones temporales — tienen prioridad máxima. */
export function coverSrc(book) {
  if (!book) return null
  // Blob/data URLs = previsualización local inmediata tras subida; usar con prioridad absoluta
  if (book.cover_url &&
      (book.cover_url.startsWith('blob:') || book.cover_url.startsWith('data:'))) {
    return book.cover_url
  }
  if (book.cover_local) {
    const parts = book.cover_local.split('/covers/')
    if (parts.length >= 2) return `/data/covers/${parts[parts.length - 1]}`
  }
  return book.cover_url || null
}

export default function BookCover({ src, alt, size = 60, title, isbn, author, fill = false }) {
  // fallback: portada obtenida externamente cuando src no existe o falla
  const [fallback, setFallback] = React.useState(null)
  // fetchedKey: identifica la combinación isbn+title ya buscada, evita peticiones duplicadas
  const [fetchedKey, setFetchedKey] = React.useState(null)
  // srcError: true cuando la imagen de src falla al cargar (404, timeout, etc.)
  const [srcError, setSrcError] = React.useState(false)
  const h = Math.round(size * 1.42)

  // Cuando src cambia (el padre refresca), resetear el error para intentarla de nuevo
  React.useEffect(() => {
    setSrcError(false)
  }, [src])

  // Buscar portada externamente SOLO cuando no hay src válida
  const fetchKey = `${isbn || ''}|${title || ''}`
  React.useEffect(() => {
    const needsFallback = !src || srcError
    if (!needsFallback) return
    if (!isbn && !title) return
    // No repetir la misma búsqueda si ya la hicimos y tenemos resultado
    if (fetchedKey === fetchKey && fallback) return

    let cancelled = false
    setFallback(null)
    setFetchedKey(fetchKey)

    const fetchCover = async () => {
      // 1. Google Books por ISBN
      if (isbn) {
        try {
          const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`)
          const data = await r.json()
          const links = data.items?.[0]?.volumeInfo?.imageLinks
          if (links) {
            const url = (links.thumbnail || links.smallThumbnail || '')
              .replace('zoom=2', 'zoom=1').replace('zoom=3', 'zoom=1').replace('http://', 'https://')
            if (url && !cancelled) { setFallback(url); return }
          }
        } catch {}
      }
      // 2. Google Books por título + autor
      if (title) {
        try {
          const q = encodeURIComponent(author ? `${title} ${author}` : title)
          const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`)
          const data = await r.json()
          const links = data.items?.[0]?.volumeInfo?.imageLinks
          if (links) {
            const url = (links.thumbnail || links.smallThumbnail || '')
              .replace('zoom=2', 'zoom=1').replace('zoom=3', 'zoom=1').replace('http://', 'https://')
            if (url && !cancelled) { setFallback(url); return }
          }
        } catch {}
      }
      // 3. Open Library por ISBN como último recurso
      if (isbn && !cancelled) {
        setFallback(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`)
      }
    }
    fetchCover()
    return () => { cancelled = true }
  }, [src, srcError, fetchKey])

  // src tiene prioridad; si falla, usar fallback externo
  const imgSrc = (src && !srcError) ? src : (fallback || null)

  if (imgSrc) return (
    <img
      src={imgSrc}
      alt={alt}
      onError={() => {
        if (src && !srcError) {
          // La imagen de src falló — marcar error para activar búsqueda de fallback
          setSrcError(true)
        } else {
          // El fallback también falló — limpiar para mostrar placeholder
          setFallback(null)
        }
      }}
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
