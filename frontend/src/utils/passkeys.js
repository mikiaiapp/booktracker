// Claves de acceso (passkeys / WebAuthn): Face ID, huella o PIN del dispositivo sustituyen a usuario, contraseña y código del autenticador.
// Contrato del estándar de usuarios (docs/usuarios/passkeys.md). El reto se pide ANTES del toque y no hay ningún await entre el toque y
// navigator.credentials.*: Safari exige un gesto del usuario (si no, iOS pregunta «¿Usar llave de acceso?» o lo rechaza).
import { api } from './api'

const KEY = 'bt_passkey_device'
export const passkeysSupported = () =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials && window.isSecureContext

const flag = () => { try { return localStorage.getItem(KEY) } catch { return null } }
export const deviceHasPasskey = () => !!flag()
export const devicePasskeyId = () => { const v = flag(); return v && v !== '1' ? v : null }
export const markDevice = (si, id) => { try { si ? localStorage.setItem(KEY, id || '1') : localStorage.removeItem(KEY) } catch { /* sin almacenamiento */ } }

const b64uToBuf = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  const u = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
  return u.buffer
}
const bufToB64u = (buf) => {
  let s = ''
  new Uint8Array(buf).forEach((x) => { s += String.fromCharCode(x) })
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Nombre automático del dispositivo («iPhone · Safari»): nunca se pregunta
export const deviceName = () => {
  const ua = navigator.userAgent || ''
  const touch = (navigator.maxTouchPoints || 0) > 1
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && touch) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo'
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : ''
  return nav ? `${dev} · ${nav}` : dev
}

const pkError = (err) => {
  const detail = err?.response?.data?.detail || err?.message
  const e = new Error(
    err?.name === 'NotAllowedError' ? 'Operación cancelada o sin tiempo.'
      : err?.name === 'InvalidStateError' ? 'Esta clave ya está registrada en este dispositivo.'
        : detail || 'No se pudo usar la clave de acceso.')
  e.cancelado = err?.name === 'NotAllowedError'
  e.yaRegistrada = err?.name === 'InvalidStateError'
  e.noReconocida = /no reconocida/i.test(detail || '')
  return e
}

export const prepareLogin = async () => (await api.post('/auth/passkeys/login/options')).data
export const prepareRegister = async () => (await api.post('/auth/passkeys/register/options')).data

// prep = reto ya pedido con prepareLogin(); sin await antes de navigator.credentials.get cuando viene de un toque
export const loginWithPasskey = async (prep) => {
  try {
    const { options, challengeId } = prep || await prepareLogin()
    const cred = await navigator.credentials.get({
      publicKey: { challenge: b64uToBuf(options.challenge), rpId: options.rpId, timeout: options.timeout, userVerification: 'required' },
    })
    if (!cred) throw new Error('Operación cancelada.')
    const response = {
      id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: {
        clientDataJSON: bufToB64u(cred.response.clientDataJSON), authenticatorData: bufToB64u(cred.response.authenticatorData),
        signature: bufToB64u(cred.response.signature), userHandle: cred.response.userHandle ? bufToB64u(cred.response.userHandle) : undefined,
      },
    }
    const { data } = await api.post('/auth/passkeys/login/verify', { challengeId, response })
    markDevice(true, cred.id)
    return data
  } catch (err) {
    const e = pkError(err)
    if (e.noReconocida) markDevice(false) // la clave de este dispositivo ya no existe en el servidor: se vuelve al acceso normal
    throw e
  }
}

export const registerPasskey = async (name, prep) => {
  try {
    const o = prep || await prepareRegister()
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: b64uToBuf(o.challenge), rp: o.rp,
        user: { id: b64uToBuf(o.user.id), name: o.user.name, displayName: o.user.displayName || o.user.name },
        pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout, attestation: 'none',
        excludeCredentials: (o.excludeCredentials || []).map((c) => ({ id: b64uToBuf(c.id), type: 'public-key', transports: c.transports })),
        authenticatorSelection: o.authenticatorSelection,
      },
    })
    if (!cred) throw new Error('Operación cancelada.')
    const response = {
      id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: { clientDataJSON: bufToB64u(cred.response.clientDataJSON), attestationObject: bufToB64u(cred.response.attestationObject), transports: cred.response.getTransports ? cred.response.getTransports() : [] },
    }
    await api.post('/auth/passkeys/register/verify', { name, response })
    markDevice(true, cred.id)
    return true
  } catch (err) {
    const e = pkError(err)
    if (e.yaRegistrada) { markDevice(true); return true } // el dispositivo ya tenía la clave (sincronizada): vale como activado
    throw e
  }
}

export const listPasskeys = async () => (await api.get('/auth/passkeys')).data.passkeys || []
export const deletePasskey = async (id) => { await api.delete('/auth/passkeys/' + encodeURIComponent(id)) }
