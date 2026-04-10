import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Cpu, Save, ExternalLink, Key, Zap, Info } from 'lucide-react'
import { api } from '../utils/api'
import './APISettingsPage.css'

export default function APISettingsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState({
    gemini_api_key: '',
    openai_api_key: '',
    anthropic_api_key: '',
    preferred_model: 'gemini-1.5-flash'
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
      }))
    } catch (err) {
      toast.error('Error al cargar configuración')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const toSend = { ...settings }
      if (settings.gemini_api_key?.includes('...')) delete toSend.gemini_api_key
      if (settings.openai_api_key?.includes('...')) delete toSend.openai_api_key
      if (settings.anthropic_api_key?.includes('...')) delete toSend.anthropic_api_key

      await api.put('/users/settings', toSend)
      toast.success('Configuración guardada correctamente')
      fetchSettings()
    } catch (err) {
      toast.error('Error al guardar configuración')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="api-settings-page loading">Cargando configuración...</div>
  }

  return (
    <div className="api-settings-page">
      <div className="api-header">
        <button className="back-btn" onClick={() => navigate('/profile')}>
          <ArrowLeft size={16} /> Perfil
        </button>
        <div className="title-area">
          <Cpu className="title-icon" />
          <div>
            <h1>Configuración de Inteligencia Artificial</h1>
            <p className="subtitle">Gestiona tus propias claves de API para un análisis personalizado y sin límites.</p>
          </div>
        </div>
      </div>

      <div className="api-container">
        <form onSubmit={handleSave} className="api-form">
          <div className="settings-section">
            <div className="section-info">
              <Zap size={18} className="text-primary" />
              <h3>Modelo Preferido</h3>
            </div>
            <p className="section-desc">Selecciona qué cerebro quieres que lidere el análisis de tus libros.</p>
            <div className="model-selector">
              {[
                { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', desc: 'Rápido, económico y eficiente.', color: '#4f46e5' },
                { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', desc: 'Máxima capacidad analítica y razonamiento.', color: '#8b5cf6' },
                { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Equilibrio perfecto entre coste y calidad.', color: '#10b981' },
                { id: 'gpt-4o', name: 'GPT-4o', desc: 'El estándar de oro en inteligencia general.', color: '#059669' }
              ].map(model => (
                <label key={model.id} className={`model-card ${settings.preferred_model === model.id ? 'active' : ''}`}>
                  <input 
                    type="radio" 
                    name="preferred_model" 
                    value={model.id} 
                    checked={settings.preferred_model === model.id}
                    onChange={e => setSettings({...settings, preferred_model: e.target.value})}
                  />
                  <div className="model-name">{model.name}</div>
                  <div className="model-desc">{model.desc}</div>
                </label>
              ))}
            </div>
          </div>

          <div className="settings-section">
            <div className="section-info">
              <Key size={18} className="text-secondary" />
              <h3>Claves de API</h3>
            </div>
            <p className="section-desc">Tus claves se cifran en la base de datos y se usan exclusivamente para tus procesos.</p>
            <div className="api-inputs-grid">
              <div className="form-field">
                <div className="field-label-row">
                  <label>Google Gemini API Key</label>
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="external-link">
                    Consigue tu clave gratis <ExternalLink size={12} />
                  </a>
                </div>
                <input 
                  type="password" 
                  value={settings.gemini_api_key || ''} 
                  onChange={e => setSettings({...settings, gemini_api_key: e.target.value})}
                  placeholder="Introduce tu clave de Google AI Studio"
                  className={settings.gemini_api_key?.includes('...') ? 'masked' : ''}
                />
              </div>
              <div className="form-field">
                <div className="field-label-row">
                  <label>OpenAI API Key</label>
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="external-link">
                    Gestionar en OpenAI <ExternalLink size={12} />
                  </a>
                </div>
                <input 
                  type="password" 
                  value={settings.openai_api_key || ''} 
                  onChange={e => setSettings({...settings, openai_api_key: e.target.value})}
                  placeholder="sk-..."
                  className={settings.openai_api_key?.includes('...') ? 'masked' : ''}
                />
              </div>
            </div>
          </div>

          <div className="info-banner">
            <Info size={16} />
            <p>Si dejas los campos vacíos, el sistema usará las claves por defecto de BookTracker (si están disponibles).</p>
          </div>

          <div className="form-actions">
            <button type="submit" className="save-btn" disabled={saving}>
              {saving ? 'Guardando...' : <><Save size={18} /> Guardar Privacidad</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
