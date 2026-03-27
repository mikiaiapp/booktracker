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
  delete: (id) => api.delete(`/books/${id}`),
}

// Analysis
export const analysisAPI = {
  status: (bookId) => api.get(`/analysis/${bookId}/status`),
  triggerPhase2: (bookId) => api.post(`/analysis/${bookId}/phase2`),
  triggerPhase3: (bookId) => api.post(`/analysis/${bookId}/phase3`),
  triggerPodcast: (bookId) => api.post(`/analysis/${bookId}/podcast`),
  podcastAudioUrl: (bookId) => `${BASE}/analysis/${bookId}/podcast/audio`,
}
