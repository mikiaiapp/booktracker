import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { BookOpen, Mail, Lock, Shield } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import './AuthPages.css'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [twoFAStep, setTwoFAStep] = useState(null) // null | {temp_token, method}
  const [code, setCode] = useState('')
  const { login, verify2fa } = useAuthStore()
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await login(email, password)
      if (result?.requires_2fa) {
        setTwoFAStep({ temp_token: result.temp_token, method: result.tfa_method })
        toast('Introduce tu código de verificación', { icon: '🔐' })
      } else {
        navigate('/')
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Credenciales incorrectas')
    } finally {
      setLoading(false)
    }
  }

  const handle2FA = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await verify2fa(twoFAStep.temp_token, code)
      navigate('/')
    } catch (err) {
      toast.error('Código incorrecto o expirado')
      setCode('')
    } finally {
      setLoading(false)
    }
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
        <motion.div
          className="auth-form-wrap"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="auth-logo">
            <BookOpen size={28} strokeWidth={1.5} />
            <h1>BookTracker</h1>
          </div>

          <AnimatePresence mode="wait">
            {!twoFAStep ? (
              <motion.form
                key="login"
                onSubmit={handleLogin}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              >
                <h2>Bienvenido de nuevo</h2>
                <p className="auth-sub">Tu biblioteca personal te espera</p>

                <div className="field">
                  <label>Email</label>
                  <div className="input-wrap">
                    <Mail size={16} />
                    <input
                      type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="nombre@ejemplo.com" required autoFocus
                    />
                  </div>
                </div>

                <div className="field">
                  <label>Contraseña</label>
                  <div className="input-wrap">
                    <Lock size={16} />
                    <input
                      type="password" value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" required
                    />
                  </div>
                </div>

                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? <span className="spinner" /> : 'Entrar'}
                </button>

                <p className="auth-link">
                  ¿Nuevo usuario? <Link to="/register">Crear cuenta</Link>
                </p>
              </motion.form>
            ) : (
              <motion.form
                key="2fa"
                onSubmit={handle2FA}
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              >
                <div className="twofa-icon"><Shield size={32} strokeWidth={1} /></div>
                <h2>Verificación en 2 pasos</h2>
                <p className="auth-sub">
                  {twoFAStep.method === 'totp'
                    ? 'Introduce el código de tu app autenticadora'
                    : 'Hemos enviado un código a tu email'}
                </p>

                <div className="field">
                  <label>Código de verificación</label>
                  <input
                    className="otp-input"
                    type="text" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000" required autoFocus
                    inputMode="numeric" maxLength={6}
                  />
                </div>

                <button type="submit" className="btn-primary" disabled={loading || code.length < 6}>
                  {loading ? <span className="spinner" /> : 'Verificar'}
                </button>

                <button type="button" className="btn-ghost" onClick={() => setTwoFAStep(null)}>
                  ← Volver
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}
