import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Cpu, Save, Key, Zap, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { api } from '../utils/api'
import './APISettingsPage.css'

const MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Rápido y gratuito (Google AI Studio).', badge: 'Gratis', badgeColor: '#10b981' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', desc: 'Ultra‑rápido para tareas masivas.', badge: 'Gratis', badgeColor: '#10b981' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', desc: 'Open‑source potente vía Groq Cloud.', badge: 'Gratis', badgeColor: '#10b981' },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', desc: 'Alta velocidad, contexto extenso (Groq).', badge: 'Gratis', badgeColor: '#10b981' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Económico y preciso (OpenAI).', badge: 'Pago', badgeColor: '#f59e0b' },
  { id: 'gpt-4o', name: 'GPT-4o', desc: 'Máxima potencia disponible (OpenAI).', badge: 'Pago', badgeColor: '#ef4444' },
]

const PROVIDERS = [
  {
    key: 'gemini',
    label: 'Google Gemini',
    field: 'gemini_api_key',
    placeholder: 'AIza...',
    link: 'https://aistudio.google.com/app/apikey',
    linkLabel: 'Obtener clave gratis en Google AI Studio ↗',
    badge: 'Gratuito',
    badgeColor: '#10b981',
    description: 'Acceso a los modelos Gemini 2.5 Flash y Flash Lite. Cuota gratuita muy generosa para análisis de libros.',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  },
  {
    key: 'groq',
    label: 'Groq Cloud',
    field: 'groq_api_key',
    placeholder: 'gsk_...',
    link: 'https://console.groq.com/keys',
    linkLabel: 'Obtener clave gratis en Groq Console ↗',
    badge: 'Gratuito',
    badgeColor: '#10b981',
    description: 'Llama 3.3 70B y Mixtral 8x7B con velocidad de inferencia ultrarrápida. Alternativa gratuita de alta calidad.',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
  },
  {
    key: 'openai',
    label: 'OpenAI',
    field: 'openai_api_key',
    placeholder: 'sk-proj-...',
    link: 'https://platform.openai.com/api-keys',
    linkLabel: 'Gestionar claves en OpenAI Platform ↗',
    badge: 'De pago',
    badgeColor: '#ef4444',
    description: 'GPT-4o Mini y GPT-4o. Úsalo como último recurso si los modelos gratuitos no están disponibles.',
    models: ['gpt-4o-mini', 'gpt-4o'],
  },
]

export default function APISettingsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState({})  // { gemini: 'loading'|'ok'|'error', … }
  const [settings, setSettings] = useState({
    gemini_api_key: '',
    openai_api_key: '',
    groq_api_key: '',
    preferred_model: 'gemini-2.5-flash',
    has_gemini: false,
    has_openai: false,
    has_groq: false,
  })

  useEffect(() => { fetchSettings() }, [])

  const fetchSettings = async () => {
    try {
      const { data } = await api.get('/users/settings')
      setSettings(prev => ({ ...prev, ...data }))
    } catch {
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
      // No reenviar claves enmascaradas
      if (settings.gemini_api_key?.includes('...')) delete toSend.gemini_api_key
      if (settings.openai_api_key?.includes('...')) delete toSend.openai_api_key
      if (settings.groq_api_key?.includes('...')) delete toSend.groq_api_key

      await api.put('/users/settings', toSend)
      toast.success('Configuración guardada correctamente')
      fetchSettings()
    } catch {
      toast.error('Error al guardar configuración')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (provider) => {
    const providerCfg = PROVIDERS.find(p => p.key === provider)
    const key = settings[providerCfg.field]
    if (!key && !settings[`has_${provider}`]) {
      return toast.error(`Introduce una clave de ${providerCfg.label} primero`)
    }
    setTesting(prev => ({ ...prev, [provider]: 'loading' }))
    const tId = toast.loading(`Probando conexión con ${providerCfg.label}...`)
    try {
      const { data } = await api.post('/users/test-api', { provider, api_key: key })
      if (data.status === 'success') {
        setTesting(prev => ({ ...prev, [provider]: 'ok' }))
        toast.success(data.message, { id: tId })
      } else {
        setTesting(prev => ({ ...prev, [provider]: 'error' }))
        toast.error(data.message, { id: tId })
      }
    } catch (err) {
      setTesting(prev => ({ ...prev, [provider]: 'error' }))
      const msg = err.response?.data?.detail || 'Error en la prueba de conexión'
      toast.error(msg, { id: tId })
    }
    // Limpiar el icono de estado después de 5s
    setTimeout(() => setTesting(prev => ({ ...prev, [provider]: null })), 5000)
  }

  if (loading) return (
    <div className="api-settings-page loading">
      <Loader2 className="spin" size={24} /> Cargando configuración...
    </div>
  )

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

        {/* --- MODELO PREFERIDO --- */}
        <div className="premium-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Zap size={20} color="var(--gold)" />
            <h3 style={{ margin: 0 }}>Modelo Preferido</h3>
          </div>
          <p style={{ color: 'var(--mist)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            La app siempre intenta primero los modelos gratuitos. El modelo preferido es el punto de partida.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
            {MODELS.map(model => (
              <label key={model.id} style={{
                padding: '0.875rem 1rem',
                border: '1.5px solid',
                borderColor: settings.preferred_model === model.id ? 'var(--gold)' : 'var(--paper-dark)',
                borderRadius: '10px',
                cursor: 'pointer',
                background: settings.preferred_model === model.id ? 'var(--faf7f2)' : 'white',
                display: 'block',
                transition: 'all 0.2s',
              }}>
                <input type="radio" name="preferred_model" value={model.id}
                  checked={settings.preferred_model === model.id}
                  onChange={e => setSettings({ ...settings, preferred_model: e.target.value })}
                  style={{ display: 'none' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span style={{ fontWeight: '700', fontSize: '0.9rem' }}>{model.name}</span>
                  <span style={{
                    fontSize: '0.65rem', fontWeight: '700', padding: '1px 6px', borderRadius: '4px',
                    background: model.badgeColor + '20', color: model.badgeColor, border: `1px solid ${model.badgeColor}40`
                  }}>{model.badge}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--mist)' }}>{model.desc}</div>
              </label>
            ))}
          </div>
        </div>

        {/* --- CLAVES DE API --- */}
        <div className="premium-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <Key size={20} color="var(--gold)" />
            <h3 style={{ margin: 0 }}>Claves de API</h3>
          </div>
          <p style={{ color: 'var(--mist)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            Prioridad: <strong>Gemini</strong> (gratis) → <strong>Groq</strong> (gratis) → <strong>OpenAI</strong> (pago, último recurso)
          </p>
          <div style={{ display: 'grid', gap: '2rem' }}>
            {PROVIDERS.map(prov => {
              const testState = testing[prov.key]
              const hasSaved = settings[`has_${prov.key}`]
              return (
                <div key={prov.key} style={{
                  border: '1.5px solid var(--paper-dark)',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  background: hasSaved ? 'rgba(16,185,129,0.03)' : 'white',
                  borderColor: hasSaved ? 'rgba(16,185,129,0.3)' : 'var(--paper-dark)',
                }}>
                  {/* Cabecera del proveedor */}
                  <div className="provider-header">
                    <div className="provider-info">
                      <div className="provider-title-row">
                        <span className="provider-label">{prov.label}</span>
                        <span className="provider-badge" style={{
                          background: prov.badgeColor + '18', color: prov.badgeColor,
                          border: `1px solid ${prov.badgeColor}35`
                        }}>{prov.badge}</span>
                        {hasSaved && <span className="provider-saved">✓ Guardada</span>}
                      </div>
                      <p className="provider-desc">{prov.description}</p>
                    </div>
                    <a href={prov.link} target="_blank" rel="noreferrer" className="provider-link">
                      {prov.linkLabel}
                    </a>
                  </div>

                  {/* Modelos disponibles */}
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.875rem' }}>
                    {prov.models.map(m => (
                      <span key={m} style={{
                        fontSize: '0.7rem', padding: '2px 8px', borderRadius: '4px',
                        background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: 'monospace'
                      }}>{m}</span>
                    ))}
                  </div>

                  <div className="provider-input-group">
                    <input
                      type="password"
                      className="premium-input"
                      value={settings[prov.field] || ''}
                      onChange={e => setSettings({ ...settings, [prov.field]: e.target.value })}
                      placeholder={hasSaved ? '••••••••••••••••••••' : prov.placeholder}
                    />
                    <button
                      type="button"
                      className="premium-btn"
                      onClick={() => handleTest(prov.key)}
                      disabled={testState === 'loading'}
                    >
                      {testState === 'loading' && <Loader2 size={14} className="spin" />}
                      {testState === 'ok' && <CheckCircle2 size={14} color="#10b981" />}
                      {testState === 'error' && <XCircle size={14} color="#ef4444" />}
                      {!testState && null}
                      {testState === 'loading' ? 'Probando...' : 'Probar'}
                    </button>
                  </div>
                </div>
              )
            })}
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
