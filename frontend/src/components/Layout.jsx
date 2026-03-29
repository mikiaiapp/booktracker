import React from 'react'
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom'
import { BookOpen, Upload, LogOut, Library, Users, UserCircle } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import './Layout.css'

export default function Layout() {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const navigate = useNavigate()

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BookOpen size={22} strokeWidth={1.5} />
          <span>BookTracker</span>
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
          <NavLink to="/upload" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Upload size={18} strokeWidth={1.5} />
            <span>Añadir libro</span>
          </NavLink>
          <NavLink to="/profile" className={({isActive}) => `nav-item nav-item-profile ${isActive ? 'active' : ''}`}>
            <UserCircle size={18} strokeWidth={1.5} />
            <span>Perfil</span>
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <Link to="/profile" className="user-badge" style={{textDecoration:'none'}}>
            <div className="user-avatar" style={{ background: user?.avatar_color || '#6366f1' }}>
              {user?.username?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="user-info">
              <span className="user-name">{user?.username}</span>
              <span className="user-email">{user?.email}</span>
            </div>
          </Link>
          <button className="logout-btn" onClick={handleLogout} title="Cerrar sesión">
            <LogOut size={16} strokeWidth={1.5} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
