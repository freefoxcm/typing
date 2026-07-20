import { useState } from 'react'
import { Eye, KeyRound, Keyboard, ShieldCheck, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, jsonBody } from '../api'
import { SiteFooter } from '../components/SiteFooter'
import type { Me } from '../types'

export function LoginPage({ onLogin }: { onLogin: (me: Me) => void }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'child' | 'admin'>('child')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const switchMode = (nextMode: 'child' | 'admin') => {
    setMode(nextMode)
    setName('')
    setPin('')
    setShowPin(false)
    setUsername('')
    setPassword('')
    setError('')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const me = mode === 'child'
        ? await api<Me>('/api/auth/child/login', { method: 'POST', ...jsonBody({ name: name.trim(), pin }) })
        : await api<Me>('/api/auth/admin/login', { method: 'POST', ...jsonBody({ username, password }) })
      onLogin(me)
      navigate(mode === 'child' ? '/' : '/admin')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="logo-bubble"><Keyboard size={42} /></div>
        <p className="eyebrow">每天一点点，手指更灵活</p>
        <h1>码力全开</h1>
        <p>专注英文与代码的打字练习。看准提示，用正确的手指，慢慢练出速度和准确率。</p>
        <div className="hero-keys" aria-hidden="true"><kbd>Y</kbd><kbd>L</kbd><kbd>Space</kbd></div>
      </section>
      <section className="login-card">
        <div className="login-tabs">
          <button className={mode === 'child' ? 'active' : ''} onClick={() => switchMode('child')}><UserRound /> 学生</button>
          <button className={mode === 'admin' ? 'active' : ''} onClick={() => switchMode('admin')}><ShieldCheck /> 教师</button>
        </div>
        <form onSubmit={submit} autoComplete="off">
          {mode === 'child' ? (
            <>
              <label>学生姓名<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="请输入姓名" required /></label>
              <label>输入 PIN<div className="input-icon"><KeyRound /><input type={showPin ? 'text' : 'password'} inputMode="numeric" pattern="\d{4,6}" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="off" placeholder="4–6 位数字" required /><button className="pin-visibility-toggle" type="button" aria-label="按住显示 PIN" aria-pressed={showPin} onPointerDown={() => setShowPin(true)} onPointerUp={() => setShowPin(false)} onPointerLeave={() => setShowPin(false)} onPointerCancel={() => setShowPin(false)} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') setShowPin(true) }} onKeyUp={() => setShowPin(false)} onBlur={() => setShowPin(false)}><Eye aria-hidden="true" /></button></div></label>
            </>
          ) : (
            <>
              <label>管理员用户名<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required /></label>
              <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required /></label>
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary wide" disabled={busy || (mode === 'child' && !name.trim())}>{busy ? '正在登录…' : '开始使用'}</button>
        </form>
      </section>
      <SiteFooter />
    </div>
  )
}
