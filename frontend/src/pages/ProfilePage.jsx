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

  // Change password
  const [pwForm, setPwForm] = useState({ current: '', new: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  // 2FA setup
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
    if (pwForm.new.length < 8) {
      toast.error('Mínimo 8 caracteres')
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
      setTotpCode('')
    } catch {
      toast.error('Error al generar QR')
    } finally {
      setTfaLoading(false)
    }
  }

  const handleVerify2FA = async () => {
    if (!totpCode || totpCode.length !== 6) {
      toast.error('Introduce el código de 6 dígitos')
      return
    }
    setTfaLoading(true)
    try {
      await api.post('/auth/verify-setup-2fa', { code: totpCode })
      toast.success('2FA activado correctamente')
      setTfaEnabled(true)
      setQr(null)
      setTotpCode('')
      await init()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Código incorrecto')
    } finally {
      setTfaLoading(false)
    }
  }

  const handleDisable2FA = async () => {
    if (!disablePassword) {
      toast.error('Introduce tu contraseña para desactivar el 2FA')
      return
    }
    setTfaLoading(true)
    try {
      await api.post('/auth/disable-2fa', { password: disablePassword })
      toast.success('2FA desactivado')
      setTfaEnabled(false)
      setDisablePassword('')
      await init()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Contraseña incorrecta')
    } finally {
      setTfaLoading(false)
    }
  }

  return (
    <div className="premium-page">
      <div className="premium-header">
        <button className="back-link" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Volver a Biblioteca
        </button>
        <h1>Mi Perfil</h1>
      </div>

      <div className="profile-grid">
        <div className="profile-sidebar">
          <div className="premium-card" style={{ textAlign: 'center' }}>
            <div className="profile-avatar-wrap" style={{ display: 'inline-block', marginBottom: '1rem' }}>
              <div className="user-avatar" style={{ width: 80, height: 80, fontSize: '2rem', background: user?.avatar_color }}>
                {user?.username?.[0]?.toUpperCase()}
              </div>
            </div>
            <div className="profile-info">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.25rem' }}>{user?.username}</h2>
              <p style={{ color: 'var(--mist)', fontSize: '0.9rem' }}>{user?.email}</p>
            </div>
            <button className="premium-btn secondary" style={{ marginTop: '1.5rem', width: '100%', justifyContent: 'center' }} onClick={handleLogout}>
              <LogOut size={16} /> Cerrar sesión
            </button>
          </div>

          <div className="premium-card ai-settings-card" onClick={() => navigate('/profile/api')} style={{ cursor: 'pointer' }}>
            <div className="section-header" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Brain size={18} color="var(--gold)" />
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Configuración de IA</h3>
            </div>
            <p style={{ fontSize: '0.9rem', color: 'var(--mist)', lineHeight: '1.5' }}>Gestiona tus propias llaves de Gemini o OpenAI para potenciar tus análisis.</p>
            <div style={{ marginTop: '1rem', color: 'var(--gold)', fontSize: '0.85rem', fontWeight: 'bold' }}>
              Gestionar API Keys →
            </div>
          </div>
        </div>

        <div className="profile-content">
          <div className="premium-card">
            <div className="section-header" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <Key size={18} color="var(--gold)" />
              <h3 style={{ margin: 0 }}>Seguridad de cuenta</h3>
            </div>
            
            <div style={{ display: 'grid', gap: '1.25rem' }}>
              <div>
                <label className="premium-label">Contraseña actual</label>
                <input 
                  type="password" className="premium-input" 
                  value={pwForm.current} onChange={e => setPwForm(f=>({...f, current: e.target.value}))} 
                  placeholder="••••••••"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="premium-label">Nueva contraseña</label>
                  <input 
                    type="password" className="premium-input" 
                    value={pwForm.new} onChange={e => setPwForm(f=>({...f, new: e.target.value}))} 
                    placeholder="Mínimo 8 caracteres"
                  />
                </div>
                <div>
                  <label className="premium-label">Confirmar nueva</label>
                  <input 
                    type="password" className="premium-input" 
                    value={pwForm.confirm} onChange={e => setPwForm(f=>({...f, confirm: e.target.value}))} 
                    placeholder="Repite contraseña"
                  />
                </div>
              </div>
              <button 
                className="premium-btn primary" onClick={handleChangePassword}
                disabled={pwLoading || !pwForm.current || !pwForm.new}
              >
                {pwLoading ? 'Guardando...' : 'Actualizar contraseña'}
              </button>
            </div>
          </div>

          <div className="premium-card">
            <div className="section-header" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <Shield size={18} color="var(--gold)" />
              <h3 style={{ margin: 0 }}>Autenticación de Dos Factores</h3>
            </div>
            
            {tfaEnabled ? (
              <div style={{ background: 'var(--faf7f2)', padding: '1.5rem', borderRadius: '8px', borderLeft: '4px solid #2ecc71' }}>
                <div style={{ fontWeight: 'bold', color: '#27ae60', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle size={16} /> Tu cuenta está protegida
                </div>
                <p style={{ color: 'var(--mist)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>El 2FA está activo. Necesitarás tu código de seguridad para entrar.</p>
                <div style={{ marginBottom: '1rem' }}>
                  <label className="premium-label">Contraseña para desactivar</label>
                  <input type="password" className="premium-input" value={disablePassword} onChange={e=>setDisablePassword(e.target.value)} placeholder="Confirma tu contraseña" />
                </div>
                <button className="premium-btn" style={{ background: '#f8d7da', color: '#721c24' }} onClick={handleDisable2FA} disabled={tfaLoading}>
                  Desactivar 2FA
                </button>
              </div>
            ) : (
              <div>
                <p style={{ color: 'var(--mist)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Añade una capa extra de seguridad usando Google Authenticator o similar.</p>
                {!qr ? (
                  <button className="premium-btn secondary" onClick={handleSetup2FA} disabled={tfaLoading}>
                    Configurar 2FA
                  </button>
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <img src={qr} alt="2FA QR" style={{ border: '1px solid var(--paper-dark)', padding: '0.5rem', background: 'white', borderRadius: '8px', marginBottom: '1rem' }} />
                    <input 
                      type="text" className="premium-input" style={{ width: '150px', textAlign: 'center', fontSize: '1.5rem', letterSpacing: '4px' }}
                      value={totpCode} onChange={e=>setTotpCode(e.target.value.replace(/\D/g,'').slice(0,6))}
                      placeholder="000000"
                    />
                    <button className="premium-btn primary" style={{ marginLeft: '1rem' }} onClick={handleVerify2FA}>Verificar</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
