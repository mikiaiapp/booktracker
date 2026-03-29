import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { BookOpen, Mail, Lock, Shield } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { api } from '../utils/api'
import './AuthPages.css'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [twoFAStep, setTwoFAStep] = useState(null)
  const [loading, setLoading] = useState(false)

  // Forgot password
  const [showForgot, setShowForgot] = useState(false)
  const [forgotStep, setForgotStep] = useState(1)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotCode, setForgotCode] = useState('')
  const [forgotNewPw, setForgotNewPw] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  const login = useAuthStore(s => s.login)
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await login(email, password)
      if (result?.requires_2fa) {
        setTwoFAStep({ method: result.tfa_method, temp_token: result.temp_token })
      } else {
        navigate('/')
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Email o contraseña incorrectos')
    } finally {
      setLoading(false)
    }
  }

  const handle2FA = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const verify = useAuthStore.getState().verify2FA
      await verify(twoFAStep.temp_token, code)
      navigate('/')
    } catch {
      toast.error('Código incorrecto')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotRequest = async () => {
    if (!forgotEmail) return
    setForgotLoading(true)
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail })
      toast.success('Si el email existe, recibirás un código')
      setForgotStep(2)
    } catch {
      toast.error('Error al enviar el código')
    } finally {
      setForgotLoading(false)
    }
  }

  const handleForgotReset = async () => {
    if (!forgotCode || !forgotNewPw) return
    setForgotLoading(true)
    try {
      await api.post('/auth/reset-password', {
        email: forgotEmail,
        code: forgotCode,
        new_password: forgotNewPw,
      })
      toast.success('Contraseña actualizada. Ya puedes entrar.')
      setShowForgot(false)
      setForgotStep(1)
      setForgotEmail('')
      setForgotCode('')
      setForgotNewPw('')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al resetear')
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-bg-text">
          <h2>Tu biblioteca personal, organizada con IA</h2>
          <p>Resúmenes, personajes, mapas mentales y más.</p>
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
                      type="email" value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="nombre@ejemplo.com" required autoFocus
                    />
                  </div>
                </div>

                <div className="field">
                  <label>Contraseña</label>
                  <div className="input-wrap">
                    <Lock size={16} />
                    <input
                      type="password" value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" required
                    />
                  </div>
                </div>

                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? <span className="spinner" /> : 'Entrar'}
                </button>

                <button
                  type="button"
                  className="forgot-link"
                  onClick={() => { setShowForgot(true); setForgotStep(1) }}
                >
                  ¿Olvidaste tu contraseña?
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
                    type="text" value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
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

          {/* Modal recuperar contraseña */}
          {showForgot && (
            <div className="forgot-modal">
              <div className="forgot-box">
                <h3>Recuperar contraseña</h3>
                {forgotStep === 1 ? (
                  <div className="forgot-content">
                    <p>Introduce tu email y te enviaremos un código de recuperación.</p>
                    <input
                      type="email" placeholder="tu@email.com"
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                    />
                    <div className="forgot-actions">
                      <button onClick={() => setShowForgot(false)} className="forgot-cancel">
                        Cancelar
                      </button>
                      <button
                        onClick={handleForgotRequest}
                        disabled={forgotLoading || !forgotEmail}
                        className="forgot-submit"
                      >
                        {forgotLoading ? 'Enviando…' : 'Enviar código'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="forgot-content">
                    <p>Código enviado a <strong>{forgotEmail}</strong>. Introduce el código y tu nueva contraseña.</p>
                    <input
                      type="text" placeholder="Código de 6 dígitos"
                      value={forgotCode}
                      onChange={e => setForgotCode(e.target.value)}
                      maxLength={6}
                    />
                    <input
                      type="password" placeholder="Nueva contraseña (mín. 8 caracteres)"
                      value={forgotNewPw}
                      onChange={e => setForgotNewPw(e.target.value)}
                    />
                    <div className="forgot-actions">
                      <button onClick={() => setForgotStep(1)} className="forgot-cancel">
                        Atrás
                      </button>
                      <button
                        onClick={handleForgotReset}
                        disabled={forgotLoading || !forgotCode || !forgotNewPw}
                        className="forgot-submit"
                      >
                        {forgotLoading ? 'Guardando…' : 'Cambiar contraseña'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </motion.div>
      </div>
    </div>
  )
}
