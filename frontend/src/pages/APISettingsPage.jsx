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
        // Si el backend devuelve keys enmascaradas, las mantenemos como placeholder visual
        // Pero al editar, el usuario deberá meter la nueva o dejar vacío
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
      // Solo enviamos lo que el usuario haya escrito (si es enmascarado, no lo enviamos para no sobreescribir con basura)
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
    <div className="premium-page">
      <div className="premium-header">
        <button className="back-link" onClick={() => navigate('/profile')}>
          <ArrowLeft size={16} /> Volver a Perfil
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Cpu size={32} color="var(--gold)" />
          <h1>Configuración de IA</h1>
        </div>
        <p style={{ color: 'var(--mist)' }}>Gestiona tus propias claves de API para un análisis personalizado y sin límites.</p>
      </div>

      <form onSubmit={handleSave} style={{ maxWidth: '800px' }}>
        <div className="premium-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Zap size={20} color="var(--gold)" />
            <h3 style={{ margin: 0 }}>Modelo Preferido</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {[
              { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', desc: 'Rápido y eficiente.' },
              { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', desc: 'Máxima potencia.' },
              { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Equilibrado.' },
              { id: 'gpt-4o', name: 'GPT-4o', desc: 'Referencia.' }
            ].map(model => (
              <label key={model.id} style={{ 
                padding: '1rem', border: '1.5px solid var(--paper-dark)', borderRadius: '8px', 
                cursor: 'pointer', background: settings.preferred_model === model.id ? 'var(--faf7f2)' : 'white',
                borderColor: settings.preferred_model === model.id ? 'var(--gold)' : 'var(--paper-dark)',
                display: 'block'
              }}>
                <input 
                  type="radio" name="preferred_model" value={model.id} 
                  checked={settings.preferred_model === model.id}
                  onChange={e => setSettings({...settings, preferred_model: e.target.value})}
                  style={{ display: 'none' }}
                />
                <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>{model.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--mist)' }}>{model.desc}</div>
              </label>
            ))}
          </div>
        </div>

        <div className="premium-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Key size={20} color="var(--gold)" />
            <h3 style={{ margin: 0 }}>Claves de API</h3>
          </div>
          <div style={{ display: 'grid', gap: '1.5rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label className="premium-label">Google Gemini Key</label>
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: 'var(--gold)' }}>Obtener clave gratis ↗</a>
              </div>
              <input 
                type="password" className="premium-input" 
                value={settings.gemini_api_key || ''} 
                onChange={e => setSettings({...settings, gemini_api_key: e.target.value})}
                placeholder="Introduce tu clave de Google AI Studio"
              />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label className="premium-label">OpenAI Key</label>
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: 'var(--gold)' }}>Gestionar OpenAI ↗</a>
              </div>
              <input 
                type="password" className="premium-input" 
                value={settings.openai_api_key || ''} 
                onChange={e => setSettings({...settings, openai_api_key: e.target.value})}
                placeholder="sk-..."
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
          <button type="submit" className="premium-btn primary" disabled={saving}>
            <Save size={18} /> {saving ? 'Guardando...' : 'Guardar Configuración'}
          </button>
        </div>
      </form>
    </div>
  )
}
