import React, { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Upload, LogOut, Library, Users, UserCircle, UserCheck, X, ShieldCheck, KeyRound, ChevronUp } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { socialAPI } from '../utils/api'
import './Layout.css'

export default function Layout() {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  const [pendingCount, setPendingCount] = useState(0)
  const [showFloatingNotification, setShowFloatingNotification] = useState(false)

  const handleLogout = () => { logout(); navigate('/login') }

  // Cargar solicitudes pendientes
  const fetchRequests = async () => {
    try {
      const { data } = await socialAPI.getRequests()
      const count = data?.received?.length || 0
      setPendingCount(count)
      
      // Mostrar globo flotante si hay pendientes y no se ha cerrado en esta sesión
      const dismissed = sessionStorage.getItem('friend_noti_dismissed')
      if (count > 0 && !dismissed) {
        setShowFloatingNotification(true)
      }
    } catch (e) {
      console.error("Error fetching friend requests count:", e)
    }
  }

  useEffect(() => {
    if (user) {
      fetchRequests()
      // Polling cada 30 segundos
      const interval = setInterval(fetchRequests, 30000)
      return () => clearInterval(interval)
    }
  }, [user])

  // Cerrar el menú de usuario al navegar o al tocar fuera
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e) => { if (!e.target.closest?.('.sidebar-footer, .mobile-user')) setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [menuOpen])

  const initial = user?.username?.[0]?.toUpperCase() || '?'
  const avatarBg = user?.avatar_color || '#6366f1'

  const userMenu = (
    <div className="user-menu" role="menu">
      <div className="user-menu-head">
        <span className="user-name">{user?.username}</span>
        <span className="user-email">{user?.email}</span>
      </div>
      <button role="menuitem" className="user-menu-item" onClick={() => navigate('/profile')}>
        <ShieldCheck size={16} strokeWidth={1.5} /> Perfil y seguridad
      </button>
      <button role="menuitem" className="user-menu-item" onClick={() => navigate('/profile/api')}>
        <KeyRound size={16} strokeWidth={1.5} /> Claves de IA
      </button>
      <button role="menuitem" className="user-menu-item danger" onClick={handleLogout}>
        <LogOut size={16} strokeWidth={1.5} /> Cerrar sesión
      </button>
    </div>
  )

  return (
    <div className="layout">
      {/* Globo flotante rojo animado de notificación */}
      {showFloatingNotification && pendingCount > 0 && (
        <div className="floating-notification-toast">
          <div className="toast-glow-red" />
          <div className="toast-content">
            <span className="toast-dot animate-ping" />
            <div className="toast-text">
              <h4>Solicitud de amistad</h4>
              <p>Tienes {pendingCount} {pendingCount === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}</p>
            </div>
            <button className="toast-action-btn" onClick={() => { 
              setShowFloatingNotification(false); 
              sessionStorage.setItem('friend_noti_dismissed', 'true');
              navigate('/friends'); 
            }}>
              Ver
            </button>
            <button className="toast-close-btn" onClick={() => { 
              setShowFloatingNotification(false);
              sessionStorage.setItem('friend_noti_dismissed', 'true');
            }}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <aside className="sidebar">
        <div className="sidebar-brand-premium">
          <img src="/logo-dark.png" alt="Logo" className="sidebar-logo-nav" />
          <span className="brand-text">BookTracker</span>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/" end className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Library size={18} strokeWidth={1.5} />
            <span>Biblioteca</span>
          </NavLink>
          <NavLink to="/authors" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Users size={18} strokeWidth={1.5} />
            <span>Autores</span>
          </NavLink>
          <NavLink to="/friends" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <div className="nav-item-icon-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <UserCheck size={18} strokeWidth={1.5} />
              {pendingCount > 0 && (
                <span className="nav-badge-red">{pendingCount}</span>
              )}
            </div>
            <span>Amigos</span>
          </NavLink>
          <NavLink to="/upload" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Upload size={18} strokeWidth={1.5} />
            <span>Subir libro</span>
          </NavLink>
          <NavLink to="/profile" className={({isActive}) => `nav-item nav-item-profile ${isActive ? 'active' : ''}`}>
            <UserCircle size={18} strokeWidth={1.5} />
            <span>Ajustes</span>
          </NavLink>
        </nav>

        <div className="sidebar-branding-v3">
          <img src="/logo-dark.png" alt="Logo BookTracker" className="sidebar-logo-footer-large" />
        </div>

        <div className="sidebar-footer">
          {menuOpen && userMenu}
          <button className="user-badge" onClick={() => setMenuOpen(o => !o)}
                  aria-label="Menú de usuario" aria-expanded={menuOpen}>
            <div className="user-avatar" style={{ background: avatarBg }}>{initial}</div>
            <div className="user-info">
              <span className="user-name">{user?.username}</span>
              <span className="user-email">{user?.email}</span>
            </div>
            <ChevronUp size={16} strokeWidth={1.5} className={menuOpen ? 'user-chevron open' : 'user-chevron'} />
          </button>
        </div>
      </aside>

      <div className="mobile-user">
        <button className="mobile-user-btn" style={{ background: avatarBg }}
                onClick={() => setMenuOpen(o => !o)} aria-label="Menú de usuario" aria-expanded={menuOpen}>
          {initial}
        </button>
        {menuOpen && <div className="mobile-user-menu">{userMenu}</div>}
      </div>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
