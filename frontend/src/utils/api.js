import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || '/api'

export const api = axios.create({ 
  baseURL: BASE,
  headers: {
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Expires': '0',
  }
})

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('bt_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  
  // Forzar no-cache en todas las peticiones GET si no tienen ya un timestamp
  if (cfg.method === 'get') {
    const separator = cfg.url.includes('?') ? '&' : '?'
    if (!cfg.url.includes('t=')) {
      cfg.url = `${cfg.url}${separator}t=${Date.now()}`
    }
    // Añadir cabecera aleatoria para saltar caches de algunos proxies/móviles
    cfg.headers['X-Cache-Bypass'] = Math.random().toString(36).substring(7)
  }
  
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
  list: () => api.get(`/books/?t=${Date.now()}`),
  get: (id) => api.get(`/books/${id}?t=${Date.now()}`),
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

// Task status
export const taskAPI = {
  status: (taskId) => api.get(`/analysis/tasks/${taskId}/status`),
  /** Poll until done. Returns final status object. Timeout en ms (default 120s). */
  pollUntilDone: async (taskId, { interval = 3000, timeout = 120000, onPoll } = {}) => {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      await new Promise(r => setTimeout(r, interval))
      const { data } = await api.get(`/analysis/tasks/${taskId}/status`)
      if (onPoll) onPoll(data)
      if (data.done) return data
    }
    return { task_id: taskId, state: 'TIMEOUT', done: true, success: false }
  },
}

// Analysis
export const analysisAPI = {
  status: (bookId) => api.get(`/analysis/${bookId}/status?t=${Date.now()}`),
  triggerPhase1: (bookId, force = false) => api.post(`/analysis/${bookId}/phase1?force=${force}`),
  triggerPhase2: (bookId, force = false) => api.post(`/analysis/${bookId}/phase2?force=${force}`),
  triggerPhase3: (bookId, force = false) => api.post(`/analysis/${bookId}/phase3?force=${force}`),
  triggerPhase3b: (bookId) => api.post(`/analysis/${bookId}/phase3b`), // legacy alias
  triggerPhase4: (bookId, force = false) => api.post(`/analysis/${bookId}/phase4?force=${force}`),
  triggerPhase5: (bookId, force = false) => api.post(`/analysis/${bookId}/phase5?force=${force}`),
  cancel: (bookId) => api.post(`/analysis/${bookId}/cancel`),
  triggerPodcast: (bookId, force = false) => api.post(`/analysis/${bookId}/podcast?force=${force}`),
  podcastAudioUrl: (bookId) => `${BASE}/analysis/${bookId}/podcast/audio`,
  downloadUrl: (bookId) => `${BASE}/analysis/${bookId}/download`,
  repairAllEvents: () => api.post('/analysis/repair-all-events'),
}

// Authors
export const authorsAPI = {
  list: () => api.get('/analysis/authors/list'),
  reidentify: (author) => api.post('/analysis/authors/reidentify', { author }),
  reidentifyBook: (bookId) => api.post(`/analysis/${bookId}/reidentify-book`),
  merge: (source, target) => api.post('/analysis/authors/merge', { source, target }),
  dedupBooks: (author) => api.post('/analysis/authors/dedup-books', { author }),
  dedupAll: () => api.post('/analysis/authors/dedup-all'),
  deleteAuthor: (author) => api.delete('/analysis/authors/delete', { data: { author } }),
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

export const characterAPI = {
  reanalyze: (bookId, characterId) =>
    api.post(`/analysis/${bookId}/character/${characterId}/analyze`),
}

// Reanalizar personajes
export const reanalyzeCharacters = (bookId) =>
  api.post(`/analysis/${bookId}/reanalyze-characters`)

// Shell books (ficha sin archivo)
export const shellAPI = {
  create: (title, author, isbn = null, year = null, cover_url = null, synopsis = null) => 
    api.post('/books/shell', { title, author, isbn, year, cover_url, synopsis }),
}

// Queue (cola de análisis serializada)
export const queueAPI = {
  get:     ()         => api.get('/analysis/queue'),
  pause:   ()         => api.post('/analysis/queue/pause'),
  resume:  ()         => api.post('/analysis/queue/resume'),
  clear:   ()         => api.delete('/analysis/queue'),
  cancel:  (bookId)   => api.delete(`/analysis/queue/${bookId}`),
}

// Chat Literario
export const chatAPI = {
  getHistory: (bookId) => api.get(`/chat/${bookId}/history`),
  sendMessage: (bookId, message, mode, model) => api.post(`/chat/${bookId}/send`, { message, mode, model }),
  clearHistory: (bookId) => api.delete(`/chat/${bookId}/clear`),
}
