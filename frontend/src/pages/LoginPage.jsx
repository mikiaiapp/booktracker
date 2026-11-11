import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { BookOpen, Mail, Lock, Shield } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { authAPI } from '../utils/api'
import './AuthPages.css'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [twoFAStep, setTwoFAStep] = useState(null)
  const [loading, setLoading] = useState(false)

  // Cuenta sin verificar (aviso con reenvío del correo)
  const [unverified, setUnverified] = useState(false)
  const [resending, setResending] = useState(false)

  // Recuperar contraseña: se pide el enlace por correo
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  // Restablecer contraseña: llegada desde el enlace del correo
  const [resetToken, setResetToken] = useState(null)
  const [resetPw, setResetPw] = useState('')
  const [resetPw2, setResetPw2] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  const login = useAuthStore(s => s.login)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Enlaces de los correos: /login?action=verify|reset&token=...
  useEffect(() => {
    const action = searchParams.get('action')
    const token = searchParams.get('token')
    if (!action || !token) return
    if (action === 'verify') {
      authAPI.verifyEmail(token)
        .then(() => toast.success('Cuenta verificada. Ya puedes iniciar sesión.', { duration: 6000 }))
        .catch((err) => toast.error(err.response?.data?.detail || 'No se pudo verificar la cuenta'))
        .finally(() => navigate('/login', { replace: true }))
    } else if (action === 'reset') {
      setResetToken(token)
      navigate('/login', { replace: true }) // quita el token de la barra de direcciones
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      const detail = err.response?.data?.detail
      if (err.response?.status === 403 && /no verificada/i.test(detail || '')) {
        setUnverified(true)
        toast.error(detail)
      } else {
        setUnverified(false)
        toast.error(detail || 'Email o contraseña incorrectos')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    try {
      await authAPI.resendVerification(email)
      toast.success('Correo de verificación reenviado')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'No se pudo reenviar el correo')
    } finally {
      setResending(false)
    }
  }

  const handle2FA = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const verify = useAuthStore.getState().verify2fa
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
      await authAPI.forgotPassword(forgotEmail)
      toast.success('Si el email existe, recibirás un enlace para restablecer la contraseña', { duration: 8000 })
      setShowForgot(false)
      setForgotEmail('')
    } catch {
      toast.error('No se pudo solicitar la recuperación')
    } finally {
      setForgotLoading(false)
    }
  }

  const handleReset = async (e) => {
    e.preventDefault()
    if (resetPw !== resetPw2) { toast.error('Las contraseñas no coinciden'); return }
    setResetLoading(true)
    try {
      await authAPI.resetPassword(resetToken, resetPw)
      toast.success('Contraseña actualizada. Ya puedes entrar.')
      setResetToken(null)
      setResetPw('')
      setResetPw2('')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'No se pudo restablecer la contraseña')
    } finally {
      setResetLoading(false)
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
            <img src="/logo-light.png" alt="BookTracker" className="auth-brand-img-premium" />
            <h1>BookTracker</h1>
          </div>

          <AnimatePresence mode="wait">
            {resetToken ? (
              <motion.form
                key="reset"
                onSubmit={handleReset}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              >
                <h2>Nueva contraseña</h2>
                <p className="auth-sub">Elige tu nueva contraseña (mínimo 8 caracteres)</p>

                <div className="field">
                  <label>Nueva contraseña</label>
                  <div className="input-wrap">
                    <Lock size={16} />
                    <input type="password" value={resetPw} onChange={e => setResetPw(e.target.value)}
                      placeholder="••••••••" required autoFocus minLength={8} />
                  </div>
                </div>

                <div className="field">
                  <label>Repite la contraseña</label>
                  <div className="input-wrap">
                    <Lock size={16} />
                    <input type="password" value={resetPw2} onChange={e => setResetPw2(e.target.value)}
                      placeholder="••••••••" required minLength={8} />
                  </div>
                </div>

                <button type="submit" className="btn-primary" disabled={resetLoading}>
                  {resetLoading ? <span className="spinner" /> : 'Cambiar contraseña'}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setResetToken(null)}>
                  ← Volver a iniciar sesión
                </button>
              </motion.form>
            ) : !twoFAStep ? (
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

                {unverified && (
                  <div className="auth-notice">
                    <p>Tu cuenta aún no está verificada. Revisa tu correo y haz clic en el enlace de activación.</p>
                    <button type="button" className="forgot-link" onClick={handleResend} disabled={resending}>
                      {resending ? 'Enviando…' : 'Reenviar el correo de verificación'}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="forgot-link"
                  onClick={() => setShowForgot(true)}
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
                <div className="forgot-content">
                  <p>Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.</p>
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
                      {forgotLoading ? 'Enviando…' : 'Enviar enlace'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </motion.div>
      </div>
    </div>
  )
}
