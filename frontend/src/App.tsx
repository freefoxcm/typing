import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { UnsavedChangesProvider } from './components/UnsavedChanges'
import { api, ApiError } from './api'
import { Shell } from './components/Shell'
import { AdminPage } from './pages/AdminPage'
import { ChildHomePage } from './pages/ChildHomePage'
import { LoginPage } from './pages/LoginPage'
import { PracticePage } from './pages/PracticePage'
import { ExercisePage } from './pages/ExercisePage'
import { WordPracticePage } from './pages/WordPracticePage'
import type { Me } from './types'

function AppRoutes() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [authError, setAuthError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setAuthError('')
    api<Me>('/api/auth/me', { signal: controller.signal }).then((value) => { if (active) setMe(value) }).catch((e) => {
      if (!active) return
      if (e instanceof ApiError && e.status === 401) setMe(null)
      else setAuthError(e instanceof Error ? e.message : '登录状态读取失败')
    })
    return () => { active = false; controller.abort() }
  }, [attempt])
  if (me === undefined && authError) return <div className="loading-screen"><p className="notice error" role="alert">暂时无法确认登录状态：{authError}</p><button onClick={() => setAttempt((value) => value + 1)}>重试连接</button></div>
  if (me === undefined) return <div className="loading-screen"><div className="loading-keys"><kbd>F</kbd><kbd>J</kbd></div><p>正在准备键盘…</p></div>
  return <Routes>
    <Route path="/login" element={me ? <Navigate to={me.role === 'admin' ? '/admin' : '/'} replace /> : <LoginPage onLogin={setMe} />} />
    <Route path="/" element={me?.role === 'child' ? <Shell me={me}><ChildHomePage me={me} /></Shell> : <Navigate to={me?.role === 'admin' ? '/admin' : '/login'} replace />} />
    <Route path="/practice/:lessonId" element={me?.role === 'child' ? <Shell me={me}><PracticePage /></Shell> : <Navigate to="/login" replace />} />
    <Route path="/word-practice/:wordSetId" element={me?.role === 'child' ? <Shell me={me}><WordPracticePage /></Shell> : <Navigate to="/login" replace />} />
    <Route path="/exercise/:sessionId" element={me?.role === 'child' ? <Shell me={me}><ExercisePage /></Shell> : <Navigate to="/login" replace />} />
    <Route path="/admin" element={me?.role === 'admin' ? <Shell me={me}><AdminPage /></Shell> : <Navigate to="/login" replace />} />
    <Route path="*" element={<Navigate to={me?.role === 'admin' ? '/admin' : me ? '/' : '/login'} replace />} />
  </Routes>
}

export default function App() {
  return <UnsavedChangesProvider><AppRoutes /></UnsavedChangesProvider>
}

