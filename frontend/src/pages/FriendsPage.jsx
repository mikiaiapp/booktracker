import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { Search, UserPlus, UserCheck, X, Check, Trash2, Mail, Clock, Loader2, Sparkles } from 'lucide-react'
import { socialAPI } from '../utils/api'
import './FriendsPage.css'

export default function FriendsPage() {
  const [friends, setFriends] = useState([])
  const [receivedRequests, setReceivedRequests] = useState([])
  const [sentRequests, setSentRequests] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [loadingFriends, setLoadingFriends] = useState(true)
  const [searching, setSearching] = useState(false)

  // Cargar lista de amigos y solicitudes
  const loadSocialData = useCallback(async () => {
    try {
      setLoadingFriends(true)
      const friendsRes = await socialAPI.getFriends()
      setFriends(friendsRes.data || [])

      const requestsRes = await socialAPI.getRequests()
      setReceivedRequests(requestsRes.data?.received || [])
      setSentRequests(requestsRes.data?.sent || [])
    } catch (e) {
      console.error(e)
      toast.error('Error al cargar datos sociales')
    } finally {
      setLoadingFriends(false)
    }
  }, [])

  useEffect(() => {
    loadSocialData()
  }, [loadSocialData])

  // Ejecutar búsqueda de usuarios
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const { data } = await socialAPI.searchUsers(searchQuery)
        setSearchResults(data || [])
      } catch (e) {
        console.error(e)
      } finally {
        setSearching(false)
      }
    }, 400);

    return () => clearTimeout(timer)
  }, [searchQuery])

  // Enviar invitación
  const handleInvite = async (user) => {
    try {
      const { data } = await socialAPI.invite(user.id)
      toast.success(data.message || `Invitación enviada a ${user.username}`)
      
      // Actualizar resultados de búsqueda localmente
      setSearchResults(prev =>
        prev.map(item =>
          item.id === user.id ? { ...item, friendship_status: 'sent_pending' } : item
        )
      )
      loadSocialData()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al enviar invitación')
    }
  }

  // Aceptar solicitud
  const handleAccept = async (requestId, senderName) => {
    try {
      await socialAPI.accept(requestId)
      toast.success(`Ahora eres amigo de ${senderName}!`, { icon: '🤝' })
      loadSocialData()
      
      // Si el usuario aceptado estaba en los resultados de búsqueda, actualizarlo
      setSearchResults(prev =>
        prev.map(item =>
          item.friendship_request_id === requestId ? { ...item, friendship_status: 'accepted' } : item
        )
      )
    } catch (err) {
      toast.error('Error al aceptar solicitud')
    }
  }

  // Rechazar / Cancelar solicitud
  const handleReject = async (requestId, senderName, isReceived) => {
    const verb = isReceived ? 'Rechazar' : 'Cancelar'
    if (!confirm(`¿${verb} la solicitud de amistad de ${senderName}?`)) return
    
    try {
      await socialAPI.reject(requestId)
      toast.success('Solicitud eliminada')
      loadSocialData()
      
      // Si estaba en la búsqueda, restaurarlo a 'none'
      setSearchResults(prev =>
        prev.map(item =>
          item.friendship_request_id === requestId ? { ...item, friendship_status: 'none', friendship_request_id: null } : item
        )
      )
    } catch (err) {
      toast.error('Error al eliminar solicitud')
    }
  }

  // Eliminar amigo
  const handleRemoveFriend = async (friend) => {
    if (!confirm(`¿Eliminar a "${friend.username}" de tus amigos? Esto revocará el acceso a todos los libros compartidos entre vosotros.`)) return
    
    try {
      await socialAPI.removeFriend(friend.id)
      toast.success('Amigo eliminado')
      loadSocialData()
      
      setSearchResults(prev =>
        prev.map(item =>
          item.id === friend.id ? { ...item, friendship_status: 'none', friendship_request_id: null } : item
        )
      )
    } catch (err) {
      toast.error('Error al eliminar amigo')
    }
  }

  return (
    <div className="friends-page">
      <div className="friends-header">
        <div>
          <h1>Comunidad y Amigos</h1>
          <p className="friends-sub">Conéctate con otros usuarios para compartir tus análisis literarios</p>
        </div>
      </div>

      <div className="friends-grid-layout">
        {/* Panel Izquierdo: Buscar y Agregar */}
        <div className="friends-panel-left">
          <div className="card-premium search-panel">
            <h3><UserPlus size={18} /> Encontrar usuarios</h3>
            <p className="panel-desc">Busca por nombre de usuario o dirección de correo electrónico.</p>
            
            <div className="search-box-wrap">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Buscar usuarios..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searching && <Loader2 size={16} className="spin search-spinner" />}
            </div>

            <div className="search-results-list">
              <AnimatePresence>
                {searchResults.map(u => (
                  <motion.div
                    key={u.id}
                    className="search-result-item"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    <div className="user-avatar" style={{ background: u.avatar_color }}>
                      {u.username[0].toUpperCase()}
                    </div>
                    <div className="user-details">
                      <span className="user-name">{u.username}</span>
                      <span className="user-email">{u.email}</span>
                    </div>

                    <div className="action-area">
                      {u.friendship_status === 'none' && (
                        <button className="btn-invite" onClick={() => handleInvite(u)}>
                          <UserPlus size={14} /> Invitar
                        </button>
                      )}
                      {u.friendship_status === 'sent_pending' && (
                        <span className="status-label pending"><Clock size={12} /> Enviada</span>
                      )}
                      {u.friendship_status === 'received_pending' && (
                        <div className="btn-group-row">
                          <button className="btn-icon-accept" title="Aceptar" onClick={() => handleAccept(u.friendship_request_id, u.username)}>
                            <Check size={14} />
                          </button>
                          <button className="btn-icon-reject" title="Rechazar" onClick={() => handleReject(u.friendship_request_id, u.username, true)}>
                            <X size={14} />
                          </button>
                        </div>
                      )}
                      {u.friendship_status === 'accepted' && (
                        <span className="status-label friends"><UserCheck size={12} /> Amigos</span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {searchQuery.trim().length >= 2 && searchResults.length === 0 && !searching && (
                <div className="search-no-results">
                  No se encontraron usuarios que coincidan.
                </div>
              )}
            </div>
          </div>

          {/* Solicitudes de Amistad Recibidas */}
          <div className="card-premium requests-panel">
            <h3><Mail size={18} /> Solicitudes recibidas ({receivedRequests.length})</h3>
            
            <div className="requests-list">
              <AnimatePresence>
                {receivedRequests.map(req => (
                  <motion.div
                    key={req.id}
                    className="request-item"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                  >
                    <div className="user-avatar" style={{ background: req.sender.avatar_color }}>
                      {req.sender.username[0].toUpperCase()}
                    </div>
                    <div className="user-details">
                      <span className="user-name">{req.sender.username}</span>
                      <span className="user-email">{req.sender.email}</span>
                    </div>
                    <div className="btn-group-row">
                      <button className="btn-accept" onClick={() => handleAccept(req.id, req.sender.username)}>
                        Aceptar
                      </button>
                      <button className="btn-reject" onClick={() => handleReject(req.id, req.sender.username, true)}>
                        Rechazar
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {receivedRequests.length === 0 && (
                <div className="requests-empty">
                  No tienes solicitudes de amistad entrantes
                </div>
              )}
            </div>
          </div>

          {/* Solicitudes de Amistad Enviadas */}
          {sentRequests.length > 0 && (
            <div className="card-premium requests-panel">
              <h3><Clock size={18} /> Solicitudes enviadas ({sentRequests.length})</h3>
              <div className="requests-list">
                {sentRequests.map(req => (
                  <div key={req.id} className="request-item">
                    <div className="user-avatar" style={{ background: req.recipient.avatar_color }}>
                      {req.recipient.username[0].toUpperCase()}
                    </div>
                    <div className="user-details">
                      <span className="user-name">{req.recipient.username}</span>
                      <span className="user-email">{req.recipient.email}</span>
                    </div>
                    <button className="btn-cancel" onClick={() => handleReject(req.id, req.recipient.username, false)}>
                      Cancelar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Panel Derecho: Lista de Amigos */}
        <div className="friends-panel-right">
          <div className="card-premium friends-list-card">
            <div className="friends-card-header">
              <h2>Mis Amigos ({friends.length})</h2>
              {friends.length > 0 && <Sparkles size={16} className="header-icon-glow" />}
            </div>

            {loadingFriends ? (
              <div className="friends-loading">
                <Loader2 size={32} className="spin loading-icon" />
                <p>Cargando lista de amigos...</p>
              </div>
            ) : (
              <div className="friends-grid">
                <AnimatePresence>
                  {friends.map(friend => (
                    <motion.div
                      key={friend.id}
                      className="friend-card"
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      whileHover={{ y: -3 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      <div className="friend-card-top">
                        <div className="user-avatar" style={{ background: friend.avatar_color }}>
                          {friend.username[0].toUpperCase()}
                        </div>
                        <button className="btn-remove-friend" title="Eliminar amigo" onClick={() => handleRemoveFriend(friend)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="friend-card-body">
                        <h4 className="friend-name">{friend.username}</h4>
                        <p className="friend-email">{friend.email}</p>
                      </div>
                      <div className="friend-card-footer">
                        <Clock size={12} />
                        <span>Amigos desde: {new Date(friend.since).toLocaleDateString()}</span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {friends.length === 0 && (
                  <div className="friends-empty-state">
                    <UserPlus size={48} strokeWidth={1} />
                    <p className="empty-title">Aún no tienes amigos agregados</p>
                    <p className="empty-sub">Busca a otros usuarios para agregarlos a tu lista de amigos y poder compartir vuestros análisis literarios.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
