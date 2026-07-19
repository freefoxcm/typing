import { Keyboard, LogOut, Shield } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Me } from '../types'

export function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  const navigate = useNavigate()
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' })
    navigate('/login')
    window.location.reload()
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to={me.role === 'admin' ? '/admin' : '/'}><Keyboard /> 小小键盘手</Link>
        <nav>
          {me.role === 'admin' && <Link to="/admin"><Shield size={17} /> 管理后台</Link>}
          <span className="user-chip">{me.name}</span>
          <button className="icon-button" onClick={logout} title="退出登录"><LogOut size={18} /></button>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  )
}

