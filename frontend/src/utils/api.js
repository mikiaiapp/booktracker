import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || '/api'

export const api = axios.create({ baseURL: BASE })

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('bt_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('bt_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// Auth
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  verify2fa: (data) => api.post('/auth/verify-2fa', data),
  me: () => api.get('/auth/me'),
}

// Books
export const booksAPI = {
  list: () => api.get('/books/'),
  get: (id) => api.get(`/books/${id}`),
  upload: (file, onProgress) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/books/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: e => onProgress?.(Math.round((e.loaded * 100) / e.total)),
    })
  },
  update: (id, data) => api.patch(`/books/${id}`, data),
  updateCover: (id, cover_url) => api.patch(`/books/${id}/cover`, { cover_url }),
  uploadCover: (id, file) => {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/books/${id}/cover/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  delete: (id) => api.delete(`/books/${id}`),
}

// Analysis
export const analysisAPI = {
  status: (bookId) => api.get(`/analysis/${bookId}/status`),
  triggerPhase1: (bookId) => api.post(`/analysis/${bookId}/phase1`),
  triggerPhase2: (bookId) => api.post(`/analysis/${bookId}/phase2`),
  triggerPhase3: (bookId) => api.post(`/analysis/${bookId}/phase3`),
  triggerPhase3b: (bookId) => api.post(`/analysis/${bookId}/phase3b`),
  cancel: (bookId) => api.post(`/analysis/${bookId}/cancel`),
  triggerPodcast: (bookId) => api.post(`/analysis/${bookId}/podcast`),
  podcastAudioUrl: (bookId) => `${BASE}/analysis/${bookId}/podcast/audio`,
  downloadUrl: (bookId) => `${BASE}/analysis/${bookId}/download`,
}

// Authors
export const authorsAPI = {
  list: () => api.get('/analysis/authors/list'),
  reidentify: (author) => api.post('/analysis/authors/reidentify', { author }),
  reidentifyBook: (bookId) => api.post(`/analysis/${bookId}/reidentify-book`),
  merge: (source, target) => api.post('/analysis/authors/merge', { source, target }),
  dedupBooks: (author) => api.post('/analysis/authors/dedup-books', { author }),
  dedupAll: () => api.post('/analysis/authors/dedup-all'),
}

// Upload file to shell book
export const uploadToShell = (bookId, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/books/${bookId}/upload-file`, form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

// Chapter individual summary
export const chapterAPI = {
  summarize: (bookId, chapterId) =>
    api.post(`/analysis/${bookId}/chapter/${chapterId}/summarize`),
}

// Reanalizar personajes
export const reanalyzeCharacters = (bookId) =>
  api.post(`/analysis/${bookId}/reanalyze-characters`)

// Shell books (ficha sin archivo)
export const shellAPI = {
  create: (title, author, isbn = null, year = null, cover_url = null, synopsis = null) => 
    api.post('/books/shell', { title, author, isbn, year, cover_url, synopsis }),
}
