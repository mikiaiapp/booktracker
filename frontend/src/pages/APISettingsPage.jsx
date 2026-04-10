import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  RiKey2Fill, 
  RiOpenaiFill, 
  RiGoogleFill, 
  RiRobot2Fill,
  RiSave2Fill,
  RiInformationLine,
  RiArrowLeftFill,
  RiLockPasswordFill,
  RiFlashlightFill
} from 'react-icons/ri'
import { useNavigate } from 'react-router-dom'
import { api } from '../utils/api'
import toast from 'react-hot-toast'
import './APISettingsPage.css'

export default function APISettingsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const [settings, setSettings] = useState({
    gemini_api_key: '',
    openai_api_key: '',
    anthropic_api_key: '',
    preferred_model: 'gemini-1.5-flash-latest'
  })

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const { data } = await api.get('/users/settings')
      setSettings(prev => ({
        ...prev,
        ...data,
        // Si el backend devuelve keys enmascaradas (ej. "AIza...RIa"), las dejamos vacías
        // o las tratamos como placeholders para no sobreescribir con basura
        gemini_api_key: data.gemini_api_key?.includes('...') ? '' : data.gemini_api_key,
        openai_api_key: data.openai_api_key?.includes('...') ? '' : data.openai_api_key,
      }))
    } catch (err) {
      toast.error('Error al cargar ajustes')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      // Filtrar campos vacíos para no borrar lo que ya está guardado (si son placeholders)
      const payload = { ...settings }
      if (!payload.gemini_api_key) delete payload.gemini_api_key
      if (!payload.openai_api_key) delete payload.openai_api_key
      if (!payload.anthropic_api_key) delete payload.anthropic_api_key
      
      await api.put('/users/settings', payload)
      toast.success('Configuración guardada correctamente')
      navigate('/profile')
    } catch (err) {
      toast.error('Error al guardar configuración')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="api-settings-loading">
      <motion.div 
        animate={{ rotate: 360 }} 
        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        className="loader-spinner"
      />
    </div>
  )

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="api-settings-container"
    >
      <header className="api-settings-header">
        <button className="back-btn" onClick={() => navigate('/profile')}>
          <RiArrowLeftFill />
        </button>
        <div className="header-text">
          <h1>Configuración de IA</h1>
          <p>Gestiona tus propias llaves de API para un análisis privado y personalizado</p>
        </div>
      </header>

      <section className="api-info-card">
        <RiInformationLine className="info-icon" />
        <div className="info-conent">
          <h3>¿Cómo funciona?</h3>
          <p>
            Al introducir tus propias llaves, BookTracker utilizará tu cuota personal para los análisis. 
            Esto te permite usar modelos más potentes (como GPT-4o) y garantiza que tus datos se procesen 
            aisladamente. Las llaves se enmascaran una vez guardadas por seguridad.
          </p>
        </div>
      </section>

      <form className="api-form" onSubmit={handleSave}>
        
        {/* Google Gemini */}
        <div className="form-group">
          <label>
            <RiGoogleFill className="brand-icon gemini" />
            Google Gemini API Key
          </label>
          <div className="input-wrapper">
            <RiKey2Fill className="field-icon" />
            <input 
              type="password"
              placeholder="AIzaSy..."
              value={settings.gemini_api_key}
              onChange={e => setSettings({...settings, gemini_api_key: e.target.value})}
            />
          </div>
          <span className="helper">Obtén tu clave en <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer">Google AI Studio</a></span>
        </div>

        {/* OpenAI */}
        <div className="form-group">
          <label>
            <RiOpenaiFill className="brand-icon openai" />
            OpenAI API Key
          </label>
          <div className="input-wrapper">
            <RiKey2Fill className="field-icon" />
            <input 
              type="password"
              placeholder="sk-..."
              value={settings.openai_api_key}
              onChange={e => setSettings({...settings, openai_api_key: e.target.value})}
            />
          </div>
          <span className="helper">Obtén tu clave en el <a href="https://platform.openai.com/" target="_blank" rel="noreferrer">Dashboard de OpenAI</a></span>
        </div>

        {/* Modelo Preferido */}
        <div className="form-group">
          <label>
            <RiFlashlightFill className="brand-icon preferred" />
            Modelo de IA Preferido
          </label>
          <div className="input-wrapper">
            <RiRobot2Fill className="field-icon" />
            <select 
              value={settings.preferred_model}
              onChange={e => setSettings({...settings, preferred_model: e.target.value})}
            >
              <optgroup label="Google Gemini (Rápido y Gratuito)">
                <option value="gemini-1.5-flash-latest">Gemini 1.5 Flash (Recomendado)</option>
                <option value="gemini-1.5-pro-latest">Gemini 1.5 Pro (Más lento, más inteligente)</option>
              </optgroup>
              <optgroup label="OpenAI (Preciso)">
                <option value="gpt-4o-mini">GPT-4o Mini (Económico)</option>
                <option value="gpt-4o">GPT-4o (Máxima Calidad)</option>
              </optgroup>
            </select>
          </div>
        </div>

        <motion.button 
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="submit" 
          className="save-btn"
          disabled={saving}
        >
          {saving ? 'Guardando...' : <><RiSave2Fill /> Guardar Configuración</>}
        </motion.button>

      </form>

      <footer className="api-security-notice">
        <RiLockPasswordFill />
        <span>Tus credenciales se cifran y nunca se comparten con otros usuarios.</span>
      </footer>
    </motion.div>
  )
}
