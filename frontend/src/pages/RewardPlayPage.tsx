import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Clock3, Gift, HelpCircle, Maximize, Volume2, VolumeX } from 'lucide-react'
import { api, ApiError, jsonBody } from '../api'
import { games, type GameId, type Reward, type RewardResponse } from '../rewards'
import { useReward } from '../components/RewardProvider'

function instanceId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
}

export function RewardPlayPage() {
  const navigate = useNavigate()
  const { refresh } = useReward()
  const [instance] = useState(instanceId)
  const [reward, setReward] = useState<Reward | null>(null)
  const [game, setGame] = useState<GameId | null>(null)
  const [url, setUrl] = useState('')
  const [ready, setReady] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [ended, setEnded] = useState('')
  const [remaining, setRemaining] = useState(0)
  const [muted, setMuted] = useState(true)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [offline, setOffline] = useState(false)
  const [retry, setRetry] = useState(0)
  const [ownedSession, setOwnedSession] = useState<number | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const deadline = useRef(0)
  const lastContact = useRef(0)
  const own = useRef<number | null>(null)
  const inFlight = useRef(false)
  const loadVersion = useRef(0)
  const gameRef = useRef(game); gameRef.current = game
  const mutedRef = useRef(muted); mutedRef.current = muted
  const offlineRef = useRef(offline); offlineRef.current = offline
  const send = useCallback((type: string, extra: Record<string, unknown> = {}) => {
    frame.current?.contentWindow?.postMessage({ channel: 'typing-reward', instanceId: instance, type, ...extra }, location.origin)
  }, [instance])
  const authorize = useCallback((start = false) => send('authorize', { remainingMs: Math.max(0, deadline.current - performance.now()), muted: mutedRef.current, start }), [send])
  const accept = useCallback((data: RewardResponse, sentAt = performance.now()) => {
    if (!data.reward) return
    setReward(data.reward)
    if (data.reward.play) {
      // Subtract the whole round trip so latency can never extend the allowance.
      deadline.current = performance.now() + Date.parse(data.reward.play.expires_at) - Date.parse(data.server_now) - (performance.now() - sentAt)
      setRemaining(Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000)))
    }
  }, [])
  const finish = useCallback((message: string) => {
    send('destroy'); setUrl(''); own.current = null; setOwnedSession(null); setReady(false); setEnded(message); setOffline(false)
    void refresh()
  }, [send, refresh])
  const load = useCallback(async () => {
    const version = ++loadVersion.current
    setError(''); const sent = performance.now()
    try {
      const data = await api<RewardResponse>('/api/easter-eggs/reward')
      if (version !== loadVersion.current) return
      accept(data, sent); setLoaded(true)
      if (data.reward) setGame(data.reward.play?.game_id ?? data.reward.games[0])
      else setEnded('现在还没有可用的游戏奖励，完成练习后再来看看。')
    } catch (e) { if (version === loadVersion.current) { setLoaded(true); setError(e instanceof Error ? e.message : '读取奖励失败') } }
  }, [accept])
  useEffect(() => { void load(); return () => { loadVersion.current++ } }, [load])
  useEffect(() => {
    if (!game || !reward?.id || ended) return
    let active = true
    const controller = new AbortController()
    setReady(false); setUrl(''); setError('')
    if (game === 'kart-racer' && window.matchMedia?.('(pointer: coarse)').matches && window.matchMedia?.('(hover: none)').matches) {
      setError('卡丁赛车需要电脑键盘操作，请在电脑上领取。这次奖励尚未开始时不会扣除时间。'); return
    }
    void api<{ url: string }>(`/api/easter-eggs/rewards/${reward.id}/prepare`, { method: 'POST', signal: controller.signal, ...jsonBody({ game_id: game, instance_id: instance }) })
      .then(data => { if (active) setUrl(data.url) })
      .catch(e => { if (active && e.name !== 'AbortError') { if (e instanceof ApiError && e.status === 410) finish(e.message); else setError(e.message) } })
    return () => { active = false; controller.abort(); send('destroy') }
  }, [game, reward?.id, instance, retry, ended, finish, send])
  useEffect(() => {
    if (!url || ready) return
    const timeout = setTimeout(() => { setError('游戏准备时间较长，请重新加载。尚未开始的奖励不会扣时。') }, 20000)
    return () => clearTimeout(timeout)
  }, [url, ready])
  const start = useCallback(async (takeOver = false) => {
    if (!ready || !reward || !game || inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    const sent = performance.now()
    try {
      const data = await api<RewardResponse>(`/api/easter-eggs/rewards/${reward.id}/start`, { method: 'POST', ...jsonBody({ game_id: game, instance_id: instance, take_over: takeOver }) })
      accept(data, sent)
      if (data.reward?.play) { own.current = data.reward.play.id; setOwnedSession(data.reward.play.id); lastContact.current = performance.now(); setOffline(false); setConflict(false); container.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' }); authorize(true); void refresh() }
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) finish(e.message)
      else { setError(e instanceof Error ? e.message : '开始失败，请重试'); setConflict(e instanceof ApiError && e.status === 409) }
    } finally { inFlight.current = false; setBusy(false) }
  }, [ready, reward, game, instance, accept, authorize, refresh, finish])
  const startRef = useRef(start); startRef.current = start
  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== 'typing-reward' || event.data.instanceId !== instance || event.data.gameId !== gameRef.current) return
      if (event.data.type === 'ready') { setReady(true); setError(''); if (own.current) authorize(true) }
      else if (event.data.type === 'request-start') void startRef.current()
      else if (event.data.type === 'error') { send('pause'); setReady(false); setError(typeof event.data.message === 'string' ? event.data.message : '游戏加载失败'); }
      else if (event.data.type === 'lease-lost') setOffline(true)
    }
    window.addEventListener('message', message)
    return () => window.removeEventListener('message', message)
  }, [instance, authorize, send])
  useEffect(() => {
    if (!ownedSession) return
    let active = true, pending = false
    const check = async () => {
      if (pending || !active) return
      pending = true; const sent = performance.now()
      try {
        const data = await api<RewardResponse>(`/api/easter-eggs/sessions/${ownedSession}/heartbeat`, { method: 'POST', timeoutMs: 4500, ...jsonBody({ instance_id: instance }) })
        if (active) { accept(data, sent); lastContact.current = performance.now(); setOffline(false); authorize(false) }
      } catch (e) {
        if (active && e instanceof ApiError && [401, 403, 404, 409, 410].includes(e.status)) finish(e.message)
      } finally { pending = false }
    }
    const interval = setInterval(() => void check(), 5000)
    const tick = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000)); setRemaining(seconds)
      if (seconds <= 0) finish('本次游戏时光结束。带着好心情，继续下一段练习吧！')
      else if (performance.now() - lastContact.current >= 15000 && !offlineRef.current) { send('pause'); setOffline(true) }
    }, 200)
    const visible = () => { if (!document.hidden) void check() }
    window.addEventListener('online', visible); document.addEventListener('visibilitychange', visible)
    return () => { active = false; clearInterval(interval); clearInterval(tick); window.removeEventListener('online', visible); document.removeEventListener('visibilitychange', visible) }
  }, [ownedSession, instance, accept, authorize, finish, send])
  useEffect(() => {
    if (!reward?.play || ownedSession || ended) return
    const timer = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000))
      setRemaining(seconds)
      if (!seconds) finish('本次游戏时光结束。带着好心情，继续下一段练习吧！')
    }, 250)
    return () => clearInterval(timer)
  }, [reward?.play?.expires_at, ownedSession, ended, finish])
  useEffect(() => {
    const leave = () => {
      send('destroy')
      if (own.current) void fetch(`/api/easter-eggs/sessions/${own.current}/leave`, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instance_id: instance }) }).catch(() => {})
    }
    window.addEventListener('pagehide', leave)
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload() }
    window.addEventListener('pageshow', restore)
    return () => { window.removeEventListener('pagehide', leave); window.removeEventListener('pageshow', restore); leave() }
  }, [instance, send])
  const changeGame = async (next: GameId) => {
    if (next === game || inFlight.current) return
    send('destroy'); setUrl(''); setReady(false)
    if (!own.current) { setGame(next); return }
    inFlight.current = true; setBusy(true); const sent = performance.now()
    try {
      const data = await api<RewardResponse>(`/api/easter-eggs/sessions/${own.current}/switch`, { method: 'POST', ...jsonBody({ game_id: next, instance_id: instance }) })
      accept(data, sent); lastContact.current = performance.now(); setGame(next)
    } catch (e) {
      if (e instanceof ApiError && [409, 410].includes(e.status)) finish(e.message)
      else { setError(e instanceof Error ? e.message : '切换失败'); setRetry(value => value + 1) }
    } finally { inFlight.current = false; setBusy(false) }
  }
  const exit = async () => {
    send('destroy')
    if (own.current) {
      const id = own.current; own.current = null; setOwnedSession(null)
      try { await api(`/api/easter-eggs/sessions/${id}/leave`, { method: 'POST', ...jsonBody({ instance_id: instance }) }) } catch { /* The lease also expires without a leave response. */ }
    }
    navigate(reward?.source_session_id ? `/exercise/${reward.source_session_id}` : '/')
  }
  const time = `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`
  return <div className="reward-page page"><header className="reward-page-heading"><div><p className="eyebrow">码力全开 · 学习彩蛋</p><h1>奖励时光</h1><p className="muted">认真练习后的快乐，也值得认真享受。</p></div><Gift size={44} /></header>
    {error && <div className="notice error" role="alert">{error} <button className="ghost" disabled={busy} onClick={() => reward ? setRetry(value => value + 1) : void load()}>重新准备</button></div>}
    {!loaded && <p>正在打开你的礼物…</p>}
    {ended ? <section className="card reward-ended"><Gift size={50} /><h2>下一段精彩，等你开启</h2><p>{ended}</p><div>{reward?.source_session_id && <Link className="ghost" to={`/exercise/${reward.source_session_id}`}>返回练习结果</Link>}<Link className="primary" to="/">继续练习</Link></div></section> : reward && <>
      <div className="reward-game-options">{reward.games.map(id => <button key={id} className={`reward-game-choice ${id === game ? 'selected' : ''}`} aria-pressed={id === game} disabled={busy} onClick={() => void changeGame(id)}><span className={`reward-game-art ${id}`} aria-hidden="true">{games[id].icon}</span><span><strong>{games[id].name}</strong><small>{games[id].description}</small></span></button>)}</div>
      <p className="reward-time-note">{reward.status === 'available' ? `共享 ${reward.duration_minutes} 分钟 · 今天领取 · 开始游戏后连续计时` : '暂停、退出、切换和刷新均不延长截止时间。切换游戏会结束当前关卡或比赛。'}</p>
      <div className="reward-game-container" ref={container}>
        <div className="reward-toolbar"><button className="ghost" onClick={() => void exit()}><ArrowLeft size={17} />返回练习</button><strong>{game && games[game].name}</strong>
          {reward.games.length > 1 && <select className="reward-game-select" aria-label="切换游戏" value={game ?? ''} disabled={busy} onChange={event => void changeGame(event.target.value as GameId)}>{reward.games.map(id => <option key={id} value={id}>{games[id].name}</option>)}</select>}
          <span className={`reward-clock ${ownedSession && remaining <= 60 ? 'is-ending' : ''}`}><Clock3 size={18} /><span>奖励剩余时间</span><b>{reward.play ? time : `${reward.duration_minutes}:00`}</b></span>
          <button className="ghost" aria-label={muted ? '开启游戏声音' : '关闭游戏声音'} onClick={() => { setMuted(!muted); send('mute', { muted: !muted }) }}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
          <button className="ghost" aria-label="操作指南" disabled={!ready} onClick={() => { container.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' }); send('help') }}><HelpCircle size={18} /></button>
          <button className="ghost" aria-label="全屏游戏" onClick={async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await container.current?.requestFullscreen() } catch { setError('当前浏览器无法进入全屏，可继续使用窗口模式。') } }}><Maximize size={18} /></button>
        </div>
        {ownedSession && remaining <= 60 && <div className="reward-time-warning" role="status">{remaining <= 10 ? '还有 10 秒，准备回到练习啦。' : '还有 1 分钟，好好享受最后一段旅程。'}</div>}
        {!ownedSession && <div className="reward-start-strip"><span>{ready ? '游戏准备好了，点击开始后才计时。' : '正在准备游戏，暂不开始计时。'}</span><button className="primary" disabled={!ready || busy} onClick={() => void start(conflict)}>{busy ? '正在确认…' : conflict ? '在此继续（接管原页面）' : reward.play ? '继续游戏' : '开始游戏'}</button></div>}
        {offline && <div className="notice reward-network" role="alert">连接中断，游戏已暂停。正在重新连接，奖励截止时间不变。</div>}
        <div className={`reward-frame-wrap ${offline ? 'is-offline' : ''}`}>
          {url ? <iframe key={url} ref={frame} src={url} title={game ? games[game].name : '奖励游戏'} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" /> : <div className="reward-frame-placeholder"><Gift size={40} /><p>{error ? '游戏暂未就绪' : '正在准备你的游戏世界…'}</p></div>}
        </div>
      </div>
    </>}
  </div>
}
