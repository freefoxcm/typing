import { useEffect, useState } from 'react'
import { KeyRound, Keyboard, ShieldCheck, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, jsonBody } from '../api'
import { SiteFooter } from '../components/SiteFooter'
import type { Child, Me } from '../types'

export function LoginPage({ onLogin }: { onLogin: (me: Me) => void }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'child' | 'admin'>('child')
  const [children, setChildren] = useState<Child[]>([])
  const [childId, setChildId] = useState('')
  const [pin, setPin] = useState('')
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Child[]>('/api/auth/children').then((items) => {
      setChildren(items)
      if (items[0]) setChildId(String(items[0].id))
    }).catch(() => setError('暂时无法读取孩子档案'))
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const me = mode === 'child'
        ? await api<Me>('/api/auth/child/login', { method: 'POST', ...jsonBody({ child_id: Number(childId), pin }) })
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
        <div className="hero-keys" aria-hidden="true"><kbd>F</kbd><kbd>J</kbd><kbd>Space</kbd></div>
      </section>
      <section className="login-card">
        <div className="login-tabs">
          <button className={mode === 'child' ? 'active' : ''} onClick={() => setMode('child')}><UserRound /> 孩子登录</button>
          <button className={mode === 'admin' ? 'active' : ''} onClick={() => setMode('admin')}><ShieldCheck /> 管理员</button>
        </div>
        <form onSubmit={submit}>
          {mode === 'child' ? (
            <>
              <label>选择你的名字<select value={childId} onChange={(e) => setChildId(e.target.value)} required>
                {children.length === 0 && <option value="">请管理员先创建档案</option>}
                {children.map((child) => <option value={child.id} key={child.id}>{child.name}</option>)}
              </select></label>
              <label>输入 PIN<div className="input-icon"><KeyRound /><input inputMode="numeric" pattern="\d{4,6}" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="4–6 位数字" required /></div></label>
            </>
          ) : (
            <>
              <label>管理员用户名<input value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
              <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary wide" disabled={busy || (mode === 'child' && !childId)}>{busy ? '正在登录…' : '开始使用'}</button>
        </form>
      </section>
      <SiteFooter />
    </div>
  )
}
