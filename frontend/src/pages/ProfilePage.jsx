import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { 
  RiUserLine, 
  RiMailLine, 
  RiShieldFlashLine, 
  RiLogoutCircleLine, 
  RiPaletteLine,
  RiDatabase2Line,
  RiArrowRightSLine,
  RiKey2Line
} from 'react-icons/ri'
import { useAuthStore } from '../store/authStore'
import { useNavigate } from 'react-router-dom'
import './ProfilePage.css'

export default function ProfilePage() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  
  const formatDate = (dateString) => {
    if (!dateString) return ''
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  return (
    <div className="profile-container">
      <header className="profile-header">
        <div className="profile-hero">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="profile-avatar"
            style={{ backgroundColor: user?.avatar_color || '#6366f1' }}
          >
            {user?.username?.charAt(0).toUpperCase()}
          </motion.div>
          <div className="profile-title">
            <h1>{user?.username}</h1>
            <p>Miembro desde {formatDate(user?.created_at)}</p>
          </div>
        </div>
      </header>

      <div className="profile-grid">
        <section className="profile-card info-card">
          <h2><RiUserLine /> Información de Cuenta</h2>
          <div className="info-list">
            <div className="info-item">
              <RiMailLine className="icon" />
              <div className="details">
                <span className="label">Correo Electrónico</span>
                <span className="value">{user?.email}</span>
              </div>
            </div>
            <div className="info-item">
              <RiShieldFlashLine className="icon" />
              <div className="details">
                <span className="label">Seguridad 2FA</span>
                <span className="value">{user?.totp_enabled ? 'Activado' : 'Desactivado'}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Nueva Tarjeta de API Settings */}
        <motion.section 
          whileHover={{ y: -5 }}
          onClick={() => navigate('/profile/api')}
          className="profile-card api-card"
        >
          <div className="card-header">
            <h2><RiKey2Line /> Configuración de IA</h2>
            <RiArrowRightSLine className="arrow" />
          </div>
          <p className="card-desc">Personaliza tus claves de Gemini, OpenAI y Anthropic para un análisis de libros privado.</p>
          <div className="api-status">
            <span className={`status-pill ${user?.has_gemini ? 'active' : ''}`}>Gemini</span>
            <span className={`status-pill ${user?.has_openai ? 'active' : ''}`}>OpenAI</span>
            <span className={`status-pill ${user?.preferred_model ? 'active' : ''}`}>Auto-Model</span>
          </div>
        </motion.section>

        <section className="profile-card preferences-card">
          <h2><RiPaletteLine /> Apariencia</h2>
          <p>Personaliza tu experiencia visual en BookTracker.</p>
          <div className="pref-action">
            <button className="btn-secondary">Editar Perfil</button>
          </div>
        </section>

        <section className="profile-card system-card">
          <h2><RiDatabase2Line /> Datos y Privacidad</h2>
          <p>Controla tus datos literarios y configuraciones del sistema.</p>
          <div className="pref-action">
            <button className="btn-danger" onClick={logout}>
              <RiLogoutCircleLine /> Cerrar Sesión
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
