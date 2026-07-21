import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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
  useEffect(() => { api<Me>('/api/auth/me').then(setMe).catch((e) => setMe(e instanceof ApiError && e.status === 401 ? null : null)) }, [])
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

export default function App() { return <BrowserRouter><AppRoutes /></BrowserRouter> }

