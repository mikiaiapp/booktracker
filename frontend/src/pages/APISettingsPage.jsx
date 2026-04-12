import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Cpu, Key, Zap, CheckCircle2, XCircle, Loader2, CloudCheck, CloudUpload } from 'lucide-react'
import { api } from '../utils/api'
import './APISettingsPage.css'

const MODELS = [
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', desc: 'Rápido y gratuito. Ideal para resumen de capítulos.', badge: 'Gratis', badgeColor: '#10b981' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', desc: 'Máxima capacidad. Recomendado para Ensayos y Personajes.', badge: 'Gratis', badgeColor: '#10b981' },
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
    linkLabel: 'Obtener clave gratis ↗',
    badge: 'Gratis',
    badgeColor: '#10b981',
    description: 'Modelos Gemini 1.5 Flash y Pro.',
    models: ['gemini-1.5-flash', 'gemini-1.5-pro'],
  },
  {
    key: 'groq',
    label: 'Groq Cloud',
    field: 'groq_api_key',
    placeholder: 'gsk_...',
    link: 'https://console.groq.com/keys',
    linkLabel: 'Obtener clave gratis ↗',
    badge: 'Gratis',
    badgeColor: '#10b981',
    description: 'Llama 3.3 70B y Mixtral 8x7B.',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
  },
  {
    key: 'openai',
    label: 'OpenAI',
    field: 'openai_api_key',
    placeholder: 'sk-proj-...',
    link: 'https://platform.openai.com/api-keys',
    linkLabel: 'Gestionar claves ↗',
    badge: 'Pago',
    badgeColor: '#ef4444',
    description: 'GPT-4o Mini y GPT-4o.',
    models: ['gpt-4o-mini', 'gpt-4o'],
  },
]

export default function APISettingsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [testing, setTesting] = useState({})
  const [settings, setSettings] = useState({
    gemini_api_key: '',
    openai_api_key: '',
    groq_api_key: '',
    preferred_model: 'gemini-1.5-flash',
    has_gemini: false,
    has_openai: false,
    has_groq: false,
  })

  // Para evitar guardar la carga inicial
  const lastSavedSettings = useRef(null)
  const debounceTimer = useRef(null)

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await api.get('/users/settings')
      setSettings(data)
      lastSavedSettings.current = JSON.stringify(data)
    } catch {
      toast.error('Error al cargar configuración')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  // Lógica de Auto-Guardado corregida
  useEffect(() => {
    if (!lastSavedSettings.current || loading) return

    const currentStr = JSON.stringify(settings)
    if (currentStr === lastSavedSettings.current) return

    setSyncing(true)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)

    debounceTimer.current = setTimeout(async () => {
        try {
            const toSend = { ...settings }
            // No enviar si es el placeholder de enmascaramiento
            if (settings.gemini_api_key?.includes('...')) delete toSend.gemini_api_key
            if (settings.openai_api_key?.includes('...')) delete toSend.openai_api_key
            if (settings.groq_api_key?.includes('...')) delete toSend.groq_api_key

            await api.put('/users/settings', toSend)
            lastSavedSettings.current = JSON.stringify(settings)
            setSyncing(false)
            console.log("Configuración sincronizada automáticamente")
        } catch (err) {
            console.error("Save failed", err)
            setSyncing(false)
        }
    }, 1000)

    return () => clearTimeout(debounceTimer.current)
  }, [settings, loading])

  const handleTest = async (provider) => {
    const providerCfg = PROVIDERS.find(p => p.key === provider)
    const key = settings[providerCfg.field]
    if (!key && !settings[`has_${provider}`]) {
      return toast.error(`Introduce una clave de ${providerCfg.label} primero`)
    }
    setTesting(prev => ({ ...prev, [provider]: 'loading' }))
    const tId = toast.loading(`Probando ${providerCfg.label}...`)
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
      const msg = err.response?.data?.detail || 'Error en la prueba'
      toast.error(msg, { id: tId })
    }
    setTimeout(() => setTesting(prev => ({ ...prev, [provider]: null })), 5000)
  }

  if (loading) return (
    <div className="api-settings-page loading">
      <Loader2 className="spin" size={24} /> Cargando...
    </div>
  )

  return (
    <div className="premium-page">
      <div className="premium-header">
        <button className="back-link" onClick={() => navigate('/profile')}>
          <ArrowLeft size={16} /> Volver
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: '800px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Cpu size={32} color="var(--gold)" />
            <h1>Configuración de IA</h1>
          </div>
          <div className={`sync-indicator ${syncing ? 'syncing' : ''}`}>
            {syncing ? (
                <><Loader2 size={16} className="spin" /> Guardando...</>
            ) : (
                <><CheckCircle2 size={16} color="#10b981" /> Sincronizado</>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '800px', display: 'grid', gap: '2.5rem' }}>
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Zap size={20} color="var(--gold)" />
            <h3 style={{ margin: 0 }}>Cerebro Predeterminado</h3>
          </div>
          <div className="model-grid-luxury">
            {MODELS.map(model => {
              const isActive = settings.preferred_model === model.id
              return (
                <label key={model.id} className={`luxury-card ${isActive ? 'active' : ''}`}>
                  <input type="radio" name="preferred_model" value={model.id}
                    checked={isActive}
                    onChange={e => setSettings({ ...settings, preferred_model: e.target.value })}
                    style={{ display: 'none' }}
                  />
                  <div className="luxury-card-header">
                    <span className="luxury-name">{model.name}</span>
                    <span className="luxury-badge" style={{ background: model.badgeColor }}>{model.badge}</span>
                  </div>
                  <div className="luxury-desc">{model.desc}</div>
                  {isActive && <div className="luxury-check">PREDETERMINADO ✓</div>}
                </label>
              )
            })}
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <Key size={20} color="var(--gold)" />
            <h3 style={{ margin: 0 }}>Llaves de Análisis</h3>
          </div>
          <div style={{ display: 'grid', gap: '1.5rem' }}>
            {PROVIDERS.map(prov => {
              const testState = testing[prov.key]
              const hasSaved = settings[`has_${prov.key}`]
              return (
                <div key={prov.key} className={`provider-luxury ${hasSaved ? 'saved' : ''}`}>
                  <div className="provider-header">
                    <div className="provider-info">
                      <div className="provider-title-row">
                        <span className="provider-label">{prov.label}</span>
                        {hasSaved && <span className="provider-saved-badge">ACTIVA ✓</span>}
                      </div>
                      <p className="provider-desc">{prov.description}</p>
                    </div>
                    <a href={prov.link} target="_blank" rel="noreferrer" className="luxury-link">
                      {prov.linkLabel}
                    </a>
                  </div>

                  <div className="provider-input-wrapper">
                    <input
                      type="password"
                      className="luxury-input"
                      value={settings[prov.field] || ''}
                      onChange={e => setSettings({ ...settings, [prov.field]: e.target.value })}
                      placeholder={hasSaved ? '••••••••••••••••••••' : prov.placeholder}
                    />
                    <button
                      type="button"
                      className={`luxury-test-btn ${testState}`}
                      onClick={() => handleTest(prov.key)}
                      disabled={testState === 'loading'}
                    >
                      {testState === 'loading' ? <Loader2 size={14} className="spin" /> : 'Probar'}
                      {testState === 'ok' && ' OK'}
                      {testState === 'error' && ' Error'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
