import { Component, createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Gift, ArrowRight } from 'lucide-react'
import { api } from '../api'
import { games, type Reward, type RewardResponse } from '../rewards'

const Celebration = lazy(() => import('./RewardCelebration').then(module => ({ default: module.RewardCelebration })))
const RewardContext = createContext<{ reward: Reward | null; refresh: () => Promise<void> }>({ reward: null, refresh: async () => {} })
export const useReward = () => useContext(RewardContext)
const seenInMemory = new Set<string>()

class CelebrationBoundary extends Component<{ children: React.ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError() }
  render() { return this.state.failed ? null : this.props.children }
}

export function RewardProvider({ childId, children }: { childId: number; children: React.ReactNode }) {
  const [reward, setReward] = useState<Reward | null>(null)
  const [celebration, setCelebration] = useState<Reward | null>(null)
  const active = useRef(true)
  const requestVersion = useRef(0)
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    try {
      const data = await api<RewardResponse>('/api/easter-eggs/reward')
      if (active.current && version === requestVersion.current) setReward(data?.reward?.child_id === childId ? data.reward : null)
    } catch { /* Optional reward discovery must not interrupt exercise work. */ }
  }, [childId])
  useEffect(() => {
    active.current = true; void refresh()
    const interval = setInterval(() => { if (!document.hidden) void refresh() }, 15000)
    const visible = () => { if (!document.hidden) void refresh() }
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible)
    return () => { active.current = false; clearInterval(interval); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])
  useEffect(() => {
    if (!reward || reward.status !== 'available') return
    let canceled = false
    const key = `typing:reward-seen:${childId}:${reward.id}:${reward.display_version}`
    const claim = () => {
      if (canceled || document.hidden || seenInMemory.has(key)) return
      try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1') } catch { /* In-memory fallback. */ }
      seenInMemory.add(key); setCelebration(reward)
    }
    const show = () => {
      if (navigator.locks) void navigator.locks.request('typing-reward-celebration', claim)
      else claim()
    }
    show(); document.addEventListener('visibilitychange', show)
    return () => { canceled = true; document.removeEventListener('visibilitychange', show) }
  }, [reward?.id, reward?.display_version, reward?.status, childId])
  useEffect(() => { if (!reward) setCelebration(null) }, [reward])
  return <RewardContext.Provider value={{ reward, refresh }}>{children}
    <span className="reward-sr" role="status">{celebration ? `${celebration.display_version > 1 ? '新游戏加入奖励' : '隐藏彩蛋解锁'}：${celebration.games.map(id => games[id].name).join('、')}，共享 ${celebration.duration_minutes} 分钟，开始游戏后才计时。` : ''}</span>
    {celebration && <CelebrationBoundary key={`${celebration.id}:${celebration.display_version}`} onError={() => setCelebration(null)}><Suspense fallback={null}><Celebration reward={celebration} onDone={() => setCelebration(null)} /></Suspense></CelebrationBoundary>}
  </RewardContext.Provider>
}

export function RewardCard({ compact = false }: { compact?: boolean }) {
  const { reward } = useReward()
  const [later, setLater] = useState(false)
  if (!reward) return null
  return <section data-reward-anchor className={`reward-card ${compact ? 'is-compact' : ''}`} aria-label="游戏奖励">
    <span className="reward-card-icon"><Gift /></span><div><p className="eyebrow">努力带来的小惊喜</p><h2>{reward.status === 'started' ? '游戏时光还在继续' : '你获得了一次游戏时光'}</h2>
      <p>{reward.games.map(id => games[id].name).join(' / ')} · {reward.status === 'started' ? '返回后按原截止时间继续' : `共享 ${reward.duration_minutes} 分钟，开始后才计时`}</p>
      {later && <small role="status">礼物已留在首页，记得今天来领取。</small>}</div>
    <div className="reward-card-actions"><Link className="primary" to="/rewards/play">{reward.status === 'started' ? '继续游戏' : '现在玩'}<ArrowRight size={17} /></Link>{!compact && reward.status === 'available' && <button className="ghost" onClick={() => setLater(true)}>稍后再玩</button>}</div>
  </section>
}
