import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { KeyRound, Trash2 } from 'lucide-react'
import {
  passkeysSupported, deviceHasPasskey, devicePasskeyId, markDevice, deviceName,
  listPasskeys, registerPasskey, deletePasskey,
} from '../utils/passkeys'
import '../pages/Passkeys.css'

// Interruptor «Face ID / huella en este dispositivo» + lista de los demás dispositivos (perfil)
export default function PasskeysCard() {
  const [list, setList] = useState([])
  const [busy, setBusy] = useState(false)

  const cargar = async () => { try { setList(await listPasskeys()) } catch { setList([]) } }
  useEffect(() => { cargar() }, [])

  if (!passkeysSupported()) {
    return <p style={{ fontSize: '0.9rem' }}>Este navegador no permite claves de acceso (hace falta https y un navegador compatible).</p>
  }

  const base = deviceName()
  const id = devicePasskeyId()
  const mia = id ? list.find(p => p.id === id)
    : deviceHasPasskey() ? list.find(p => p.name === base || p.name.startsWith(base + ' (')) : undefined
  const otras = list.filter(p => !mia || p.id !== mia.id)

  const alternar = async () => {
    setBusy(true)
    try {
      if (mia) {
        await deletePasskey(mia.id)
        markDevice(false)
        toast.success('Face ID / huella desactivado en este dispositivo')
      } else {
        const n = list.filter(p => p.name === base || p.name.startsWith(base + ' (')).length
        await registerPasskey(n ? `${base} (${n + 1})` : base)
        toast.success('Listo: este dispositivo ya entra con Face ID o huella')
      }
    } catch (err) {
      toast.error(err.message)
    }
    setBusy(false)
    cargar()
  }

  const eliminar = async (p) => {
    if (!window.confirm('¿Eliminar la clave de acceso «' + p.name + '»? Con ella ya no podrás entrar con Face ID o huella.')) return
    try { await deletePasskey(p.id) } catch (err) { toast.error(err.message) }
    cargar()
  }

  return (
    <div>
      <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
        Al iniciar sesión, Face ID, la huella o el PIN del dispositivo sustituyen a la contraseña y al código del autenticador.
      </p>
      <label className="pk-switch-row">
        <span><b>Face ID / huella en este dispositivo</b><br /><small>{busy ? 'Esperando al dispositivo…' : mia ? 'Activado' : 'Desactivado'}</small></span>
        <input type="checkbox" className="pk-switch" checked={!!mia} disabled={busy} onChange={alternar} />
      </label>
      {otras.length > 0 && (
        <div>
          <p style={{ fontSize: '0.8rem', fontWeight: 700, marginTop: '1rem' }}>Otros dispositivos</p>
          {otras.map(p => (
            <div key={p.id} className="pk-item">
              <span>{p.name}<br /><small>Creada el {new Date(p.createdAt).toLocaleDateString('es-ES')}{p.lastUsed ? ' · usada el ' + new Date(p.lastUsed).toLocaleDateString('es-ES') : ''}</small></span>
              <button type="button" onClick={() => eliminar(p)} aria-label="Eliminar clave"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
