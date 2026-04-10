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
    <div className="profile-page">
      <div className="profile-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Biblioteca
        </button>
        <h1>Mi perfil</h1>
      </div>

      <div className="profile-grid">
        {/* Sidebar con Info usuario + IA */}
        <div className="profile-sidebar">
          <div className="profile-card">
            <div className="profile-avatar-wrap">
              <div className="profile-avatar" style={{ backgroundColor: user?.avatar_color }}>
                {user?.username?.[0]?.toUpperCase()}
              </div>
              <div className="avatar-shadow"></div>
            </div>
            <div className="profile-info">
              <h2>{user?.username || 'Usuario'}</h2>
              <p>{user?.email}</p>
            </div>
            <button
              className="profile-logout-btn"
              onClick={handleLogout}
              title="Cerrar sesión"
            >
              <LogOut size={16} />
              <span>Cerrar sesión</span>
            </button>
          </div>

          <div className="profile-section ai-settings-card" onClick={() => navigate('/profile/api')}>
            <div className="section-header">
              <Brain size={18} />
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
        </div>

        {/* Content con Seguridad y 2FA */}
        <div className="profile-content">
          {/* Cambiar contraseña */}
          <div className="profile-section">
            <div className="section-header">
              <Key size={18} />
              <h3>Seguridad</h3>
            </div>
            <div className="profile-form">
              <div className="form-field">
                <label>Contraseña actual</label>
                <div className="input-wrap">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={pwForm.current}
                    onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                    placeholder="••••••••"
                  />
                  <button className="eye-btn" onClick={() => setShowPw(s => !s)}>
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="form-field">
                <label>Nueva contraseña</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pwForm.new}
                  onChange={e => setPwForm(f => ({ ...f, new: e.target.value }))}
                  placeholder="Mínimo 8 caracteres"
                />
              </div>
              <div className="form-field">
                <label>Confirmar nueva contraseña</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pwForm.confirm}
                  onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                  placeholder="Repite la contraseña"
                />
              </div>
              <button
                className="profile-btn primary"
                onClick={handleChangePassword}
                disabled={pwLoading || !pwForm.current || !pwForm.new || !pwForm.confirm}
              >
                {pwLoading ? 'Guardando…' : 'Cambiar contraseña'}
              </button>
            </div>
          </div>

          {/* 2FA */}
          <div className="profile-section">
            <div className="section-header">
              <Shield size={18} />
              <h3>Autenticación de Dos Factores</h3>
            </div>

            {tfaEnabled ? (
              <div className="tfa-active">
                <div className="tfa-status enabled">
                  <CheckCircle size={16} /> Protegido con 2FA
                </div>
                <p className="tfa-desc">Tu biblioteca está blindada contra accesos no autorizados.</p>
                <div className="form-field">
                  <label>Contraseña para desactivar</label>
                  <input
                    type="password"
                    value={disablePassword}
                    onChange={e => setDisablePassword(e.target.value)}
                    placeholder="Contraseña de cuenta"
                    style={{maxWidth: '300px'}}
                  />
                </div>
                <button
                  className="profile-btn danger"
                  onClick={handleDisable2FA}
                  disabled={tfaLoading || !disablePassword}
                >
                  <ShieldOff size={14} /> {tfaLoading ? 'Desactivando…' : 'Desactivar Seguridad Extra'}
                </button>
              </div>
            ) : (
              <div className="tfa-setup">
                <div className="tfa-status disabled">
                  Protección básica activa
                </div>
                <p className="tfa-desc">
                  Eleva la seguridad de tus datos literarios activando el 2FA con Google Authenticator.
                </p>

                {!qr ? (
                  <button
                    className="profile-btn primary"
                    onClick={handleSetup2FA}
                    disabled={tfaLoading}
                  >
                    <Shield size={14} /> {tfaLoading ? 'Iniciando…' : 'Activar 2FA'}
                  </button>
                ) : (
                  <div className="tfa-qr-section">
                    <p className="tfa-instructions">
                      Escanea el QR con tu aplicación TOTP e introduce el código.
                    </p>
                    <img src={qr} alt="QR 2FA" className="tfa-qr" />
                    <div className="tfa-verify">
                      <input
                        type="text"
                        value={totpCode}
                        onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000 top"
                        className="tfa-code-input"
                        maxLength={6}
                      />
                      <button
                        className="profile-btn primary"
                        onClick={handleVerify2FA}
                        disabled={tfaLoading || totpCode.length !== 6}
                      >
                        {tfaLoading ? 'Verificando…' : 'Configurar Cuenta'}
                      </button>
                    </div>
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
