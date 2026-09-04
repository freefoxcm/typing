import { Keyboard, LogOut, Shield } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Me } from '../types'
import { SiteFooter } from './SiteFooter'

export function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  const navigate = useNavigate()
  const [logoutError, setLogoutError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const loggingOutRef = useRef(false)
  const logout = async () => {
    if (loggingOutRef.current) return
    loggingOutRef.current = true; setLoggingOut(true); setLogoutError('')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    try {
      await api('/api/auth/logout', { method: 'POST', signal: controller.signal })
      navigate('/login')
      window.location.reload()
    } catch (error) {
      setLogoutError(`未能确认退出登录：${controller.signal.aborted ? '请求超时' : error instanceof Error ? error.message : '网络异常'}。请重试。`)
    } finally {
      window.clearTimeout(timeout)
      loggingOutRef.current = false; setLoggingOut(false)
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to={me.role === 'admin' ? '/admin' : '/'}><Keyboard /> 码力全开</Link>
        <nav>
          {me.role === 'admin' && <Link to="/admin"><Shield size={17} /> 管理后台</Link>}
          <span className="user-chip">{me.name}</span>
          <button className="icon-button" onClick={() => void logout()} disabled={loggingOut} title="退出登录" aria-label={loggingOut ? '正在退出登录' : '退出登录'}><LogOut size={18} /></button>
        </nav>
      </header>
      {logoutError && <div className="notice error" role="alert">{logoutError} <button className="ghost" disabled={loggingOut} onClick={() => void logout()}>重试退出登录</button></div>}
      <main>{children}</main>
      <SiteFooter />
    </div>
  )
}
