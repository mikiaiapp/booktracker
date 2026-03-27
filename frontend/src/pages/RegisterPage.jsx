import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { BookOpen, User, Mail, Lock, Shield, Smartphone, CheckCircle } from 'lucide-react'
import { authAPI } from '../utils/api'
import './AuthPages.css'

export default function RegisterPage() {
  const [form, setForm] = useState({ email: '', username: '', password: '', tfa_method: 'totp' })
  const [loading, setLoading] = useState(false)
  const [totpData, setTotpData] = useState(null) // {totp_qr, totp_secret}
  const navigate = useNavigate()

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleRegister = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await authAPI.register(form)
      if (data.totp_qr) {
        setTotpData(data)
      } else {
        toast.success('Cuenta creada. Ya puedes iniciar sesión.')
        navigate('/login')
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al crear la cuenta')
    } finally {
      setLoading(false)
    }
  }

  if (totpData) {
    return (
      <div className="auth-page">
        <div className="auth-deco">
          <div className="auth-deco-text">
            {['Seguro', 'Privado', 'Tuyo'].map((w, i) => (
              <span key={w} style={{ animationDelay: `${i * 0.8}s` }}>{w}</span>
            ))}
          </div>
        </div>
        <div className="auth-panel">
          <motion.div className="auth-form-wrap" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
            <div className="auth-logo">
              <Shield size={28} strokeWidth={1.5} />
              <h1>Configura tu 2FA</h1>
            </div>
            <p className="auth-sub">Escanea el código QR con Google Authenticator, Authy o cualquier app TOTP</p>

            <div className="qr-wrap">
              <img src={totpData.totp_qr} alt="QR TOTP" className="qr-img" />
            </div>

            <details className="secret-details">
              <summary>Ver clave manual</summary>
              <code>{totpData.totp_secret}</code>
            </details>

            <button className="btn-primary" onClick={() => navigate('/login')}>
              <CheckCircle size={16} />
              Listo, ir a iniciar sesión
            </button>
          </motion.div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-deco">
        <div className="auth-deco-text">
          {['Leer', 'Recordar', 'Descubrir', 'Explorar'].map((w, i) => (
            <span key={w} style={{ animationDelay: `${i * 0.8}s` }}>{w}</span>
          ))}
        </div>
      </div>

      <div className="auth-panel">
        <motion.div className="auth-form-wrap" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="auth-logo">
            <BookOpen size={28} strokeWidth={1.5} />
            <h1>BookTracker</h1>
          </div>

          <form onSubmit={handleRegister}>
            <h2>Crear cuenta</h2>
            <p className="auth-sub">Tu biblioteca personal y privada</p>

            <div className="field">
              <label>Usuario</label>
              <div className="input-wrap">
                <User size={16} />
                <input type="text" value={form.username} onChange={set('username')} placeholder="tu_nombre" required />
              </div>
            </div>

            <div className="field">
              <label>Email</label>
              <div className="input-wrap">
                <Mail size={16} />
                <input type="email" value={form.email} onChange={set('email')} placeholder="tu@email.com" required />
              </div>
            </div>

            <div className="field">
              <label>Contraseña</label>
              <div className="input-wrap">
                <Lock size={16} />
                <input type="password" value={form.password} onChange={set('password')} placeholder="••••••••" required minLength={8} />
              </div>
            </div>

            <div className="field">
              <label>Doble factor de autenticación</label>
              <div className="tfa-options">
                {[
                  { value: 'totp', label: 'App autenticadora', icon: <Smartphone size={16} />, desc: 'Google Authenticator, Authy...' },
                  { value: 'email', label: 'Código por email', icon: <Mail size={16} />, desc: 'Código OTP en cada acceso' },
                  { value: 'none', label: 'Sin 2FA', icon: <Shield size={16} />, desc: 'No recomendado' },
                ].map(opt => (
                  <label key={opt.value} className={`tfa-opt ${form.tfa_method === opt.value ? 'selected' : ''}`}>
                    <input type="radio" name="tfa" value={opt.value} checked={form.tfa_method === opt.value} onChange={set('tfa_method')} />
                    <span className="tfa-opt-icon">{opt.icon}</span>
                    <div>
                      <strong>{opt.label}</strong>
                      <small>{opt.desc}</small>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Crear cuenta'}
            </button>

            <p className="auth-link">
              ¿Ya tienes cuenta? <Link to="/login">Iniciar sesión</Link>
            </p>
          </form>
        </motion.div>
      </div>
    </div>
  )
}
