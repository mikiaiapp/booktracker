import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { BookOpen, User, Mail, Lock, CheckCircle } from 'lucide-react'
import { authAPI } from '../utils/api'
import './AuthPages.css'

export default function RegisterPage() {
  const [form, setForm] = useState({ email: '', username: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState(null) // correo al que se ha enviado el enlace de verificación
  const navigate = useNavigate()

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleRegister = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await authAPI.register(form)
      setSentTo(form.email)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al crear la cuenta')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    try {
      await authAPI.resendVerification(sentTo)
      toast.success('Correo reenviado')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'No se pudo reenviar el correo')
    }
  }

  if (sentTo) {
    return (
      <div className="auth-page">
        <div className="auth-deco">
          <div className="auth-deco-text">
            {['Leer', 'Recordar', 'Descubrir'].map((w, i) => (
              <span key={w} style={{ animationDelay: `${i * 0.8}s` }}>{w}</span>
            ))}
          </div>
        </div>
        <div className="auth-panel">
          <motion.div className="auth-form-wrap" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
            <div className="auth-logo">
              <Mail size={28} strokeWidth={1.5} />
              <h1>Revisa tu correo</h1>
            </div>
            <p className="auth-sub">
              Te hemos enviado un enlace a <strong>{sentTo}</strong>. Haz clic en él para activar tu cuenta y después podrás iniciar sesión.
            </p>

            <button className="btn-primary" onClick={() => navigate('/login')}>
              <CheckCircle size={16} />
              Ir a iniciar sesión
            </button>
            <button type="button" className="btn-ghost" onClick={handleResend}>
              ¿No te ha llegado? Reenviar el correo
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
            <img src="/logo-light.png" alt="BookTracker" className="auth-brand-img-premium" />
            <h1>BookTracker</h1>
          </div>

          <form onSubmit={handleRegister}>
            <h2>Crear cuenta</h2>
            <p className="auth-sub">Tu biblioteca personal y privada. Te enviaremos un correo para activar la cuenta.</p>

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
