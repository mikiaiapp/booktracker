import { create } from 'zustand'
import { authAPI } from '../utils/api'

export const useAuthStore = create((set, get) => ({
  user: null,
  token: localStorage.getItem('bt_token'),
  loading: false,

  init: async () => {
    const token = localStorage.getItem('bt_token')
    if (!token) return
    try {
      const { data } = await authAPI.me()
      set({ user: data })
    } catch {
      localStorage.removeItem('bt_token')
      set({ token: null, user: null })
    }
  },

  login: async (email, password) => {
    const { data } = await authAPI.login({ email, password })
    if (data.requires_2fa) return data  // caller handles 2FA
    localStorage.setItem('bt_token', data.access_token)
    set({ token: data.access_token })
    const me = await authAPI.me()
    set({ user: me.data })
    return data
  },

  verify2fa: async (temp_token, code) => {
    const { data } = await authAPI.verify2fa({ temp_token, code })
    localStorage.setItem('bt_token', data.access_token)
    set({ token: data.access_token })
    const me = await authAPI.me()
    set({ user: me.data })
    return data
  },

  logout: () => {
    localStorage.removeItem('bt_token')
    set({ user: null, token: null })
  },
}))
