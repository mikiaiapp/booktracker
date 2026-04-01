/**
 * Count total unique books for an author.
 * Returns: books in app + biblio items not already in app
 * This must be consistent between AuthorsPage sidebar count and BookPage "Otras obras" section.
 */
export function countAuthorBooks(author) {
  const booksInApp = author.books || []
  const biblio = author.bibliography || []

  // Build lookup for books in app
  const appIsbns = new Set(booksInApp.map(b => b.isbn).filter(Boolean))
  const appTitles = new Set(booksInApp.map(b => (b.title || '').toLowerCase().trim()))

  let missing = 0
  biblio.forEach(item => {
    const title = typeof item === 'string' ? item : item.title
    const isbn = typeof item === 'object' ? item.isbn : null
    if (!title || !title.trim()) return
    const titleKey = title.toLowerCase().trim()
    if (isbn && appIsbns.has(isbn)) return
    if (appTitles.has(titleKey)) return
    // Check fuzzy containment
    const alreadyIn = [...appTitles].some(bt => bt === titleKey || bt.includes(titleKey) || titleKey.includes(bt))
    if (alreadyIn) return
    missing++
  })

  return booksInApp.length + missing
}

/**
 * Get all books for an author as a unified list.
 * Books in app come first (with id/status), then bibliography-only entries.
 */
export function getAuthorAllBooks(author) {
  const booksInApp = author.books || []
  const biblio = author.bibliography || []

  const appIsbns = new Set(booksInApp.map(b => b.isbn).filter(Boolean))
  const appTitles = new Set(booksInApp.map(b => (b.title || '').toLowerCase().trim()))

  const missing = []
  biblio.forEach(item => {
    const title = typeof item === 'string' ? item : item.title
    const isbn = typeof item === 'object' ? item.isbn : null
    const year = typeof item === 'object' ? item.year : null
    const cover_url = typeof item === 'object' ? item.cover_url : null
    const synopsis = typeof item === 'object' ? item.synopsis : null
    if (!title || !title.trim()) return
    const titleKey = title.toLowerCase().trim()
    if (isbn && appIsbns.has(isbn)) return
    if (appTitles.has(titleKey)) return
    const alreadyIn = [...appTitles].some(bt => bt === titleKey || bt.includes(titleKey) || titleKey.includes(bt))
    if (alreadyIn) return
    missing.push({ _bibliographyOnly: true, title, isbn, year, cover_url, synopsis })
  })

  return [
    ...booksInApp,
    ...missing
  ].sort((a, b) => (b.year || 0) - (a.year || 0))
}
