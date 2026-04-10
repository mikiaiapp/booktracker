import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/authStore'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import LibraryPage from './pages/LibraryPage'
import BookPage from './pages/BookPage'
import UploadPage from './pages/UploadPage'
import AuthorsPage from './pages/AuthorsPage'
import ProfilePage from './pages/ProfilePage'
import APISettingsPage from './pages/APISettingsPage'
import Layout from './components/Layout'

function PrivateRoute({ children }) {
  const token = useAuthStore(s => s.token)
  return token ? children : <Navigate to="/login" replace />
}

export default function App() {
  const init = useAuthStore(s => s.init)
  const token = useAuthStore(s => s.token)
  
  useEffect(() => { init() }, [init])

  // Disparar reparacin de eventos clave una sola vez tras la actualizacin
  useEffect(() => {
    if (token && !localStorage.getItem('repair_v2')) {
      const triggerRepair = async () => {
        try {
          const { analysisAPI } = await import('./utils/api')
          await analysisAPI.repairAllEvents()
          localStorage.setItem('repair_v2', 'true')
        } catch (e) {
          console.error('Error al iniciar reparacin de hitos:', e)
        }
      }
      triggerRepair()
    }
  }, [token])

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontFamily: 'var(--font-body)',
            background: 'var(--ink)',
            color: 'var(--paper)',
            borderRadius: '4px',
          },
        }}
      />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<LibraryPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="authors" element={<AuthorsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="profile/api" element={<APISettingsPage />} />
          <Route path="book/:id" element={<BookPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
