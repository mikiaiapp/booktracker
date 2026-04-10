import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import { Key, Shield, ShieldOff, Eye, EyeOff, ArrowLeft, CheckCircle, LogOut, Brain, ChevronRight } from 'lucide-react'
import { api } from '../utils/api'
import './ProfilePage.css'

export default function ProfilePage() {
  const user = useAuthStore(s => s.user)
  const init = useAuthStore(s => s.init)
  const logout = useAuthStore(s => s.logout)
  const navigate = useNavigate()

  const [pwForm, setPwForm] = useState({ current: '', new: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  const [qr, setQr] = useState(null)
  const [totpCode, setTotpCode] = useState('')
  const [tfaLoading, setTfaLoading] = useState(false)
  const [tfaEnabled, setTfaEnabled] = useState(!!user?.totp_enabled)
  const [disablePassword, setDisablePassword] = useState('')

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleChangePassword = async () => {
    if (pwForm.new !== pwForm.confirm) {
      toast.error('Las contraseñas no coinciden')
      return
    }
    setPwLoading(true)
    try {
      await api.post('/auth/change-password', {
        current_password: pwForm.current,
        new_password: pwForm.new,
      })
      toast.success('Contraseña actualizada')
      setPwForm({ current: '', new: '', confirm: '' })
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al cambiar contraseña')
    } finally {
      setPwLoading(false)
    }
  }

  const handleSetup2FA = async () => {
    setTfaLoading(true)
    try {
      const { data } = await api.post('/auth/setup-2fa')
      setQr(data.qr)
    } catch {
      toast.error('Error al generar QR')
    } finally {
      setTfaLoading(false)
    }
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Biblioteca
        </button>
        <h1>Mi perfil</h1>
      </div>

      <div className="profile-grid">
        <div className="profile-card">
          <div className="profile-avatar">
            {user?.username?.[0]?.toUpperCase()}
          </div>
          <div className="profile-info">
            <h2>{user?.username}</h2>
            <p>{user?.email}</p>
          </div>
          <button className="profile-logout-btn" onClick={handleLogout}>
            <LogOut size={16} />
            <span>Cerrar sesión</span>
          </button>
        </div>

        <div className="profile-section ai-settings-card" onClick={() => navigate('/profile/api')}>
          <div className="section-header">
            <Brain size={16} className="text-primary" />
            <h3>Configuración de IA</h3>
            <span className="badge-new">NUEVO</span>
          </div>
          <div className="ai-card-content">
            <p>Configura tus propias claves de Gemini y OpenAI para análisis ilimitados.</p>
            <div className="ai-card-footer">
              <span>Gestionar API Keys</span>
              <ChevronRight size={16} />
            </div>
          </div>
        </div>

        <div className="profile-section">
          <div className="section-header">
            <Key size={16} />
            <h3>Seguridad</h3>
          </div>
          <button className="profile-btn primary" onClick={() => navigate('/profile')}>
             Ajustes de Seguridad
          </button>
        </div>
      </div>
    </div>
  )
}
