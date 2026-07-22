import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, BookCheck, Clock3, Code2, Dice5, RotateCcw, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api, jsonBody } from '../api'
import type { ExerciseSession, ExerciseQuestionType, ExerciseSessionSummary, QuestionSetSummary } from '../types'

type SessionCreatePayload = {
  mode: ExerciseSession['mode']
  question_set_ids: number[]
  counts: Partial<Record<ExerciseQuestionType, number>>
}

export function ExerciseHomeSection({ sets, activeSessions = [], onActiveSessionsChange = () => undefined }: {
  sets: QuestionSetSummary[]
  activeSessions?: ExerciseSessionSummary[]
  onActiveSessionsChange?: (sessions: ExerciseSessionSummary[]) => void
}) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<number[]>(() => sets.map((item) => item.id))
  const [counts, setCounts] = useState<Record<ExerciseQuestionType, number>>({ single_choice: 5, multiple_choice: 0, true_false: 5, programming: 0 })
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [randomOpen, setRandomOpen] = useState(false)
  const [pendingPayload, setPendingPayload] = useState<SessionCreatePayload | null>(null)
  const randomTriggerRef = useRef<HTMLButtonElement>(null)
  const randomDialogRef = useRef<HTMLDivElement>(null)
  const selectionInitializedRef = useRef(sets.length > 0)
  const available = useMemo(() => sets.reduce((sum, item) => sum + item.question_count, 0), [sets])
  const availableByType = useMemo(() => sets.filter((item) => selected.includes(item.id)).reduce<Record<ExerciseQuestionType, number>>((totals, item) => {
    for (const type of Object.keys(totals) as ExerciseQuestionType[]) totals[type] += item.counts[type] ?? 0
    return totals
  }, { single_choice: 0, multiple_choice: 0, true_false: 0, programming: 0 }), [selected, sets])
  const randomError = useMemo(() => {
    if (!selected.length) return '请至少选择一个题套'
    if (Object.values(counts).every((count) => count === 0)) return '随机练习至少需要一道题'
    const exceeded = (Object.keys(counts) as ExerciseQuestionType[]).find((type) => counts[type] > availableByType[type])
    return exceeded ? `${{ single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题', programming: '编程题' }[exceeded]}最多可选 ${availableByType[exceeded]} 道` : ''
  }, [availableByType, counts, selected.length])

  useEffect(() => {
    if (selectionInitializedRef.current || !sets.length) return
    setSelected(sets.map((item) => item.id))
    selectionInitializedRef.current = true
  }, [sets])

  useEffect(() => {
    if (!randomOpen) return
    randomDialogRef.current?.querySelector<HTMLElement>('input, button')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRandomOpen(false)
        window.setTimeout(() => randomTriggerRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [randomOpen])

  const refreshActiveSessions = async () => {
    const sessions = await api<ExerciseSessionSummary[]>('/api/exercises/active-sessions')
    onActiveSessionsChange(sessions)
    return sessions
  }
  const createSession = async (payload: SessionCreatePayload) => {
    setStarting(true); setError('')
    try {
      const session = await api<ExerciseSession>('/api/exercises/sessions', { method: 'POST', ...jsonBody(payload) })
      setRandomOpen(false)
      setPendingPayload(null)
      navigate(`/exercise/${session.id}`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try { await refreshActiveSessions(); setPendingPayload(payload); setRandomOpen(false) } catch { setError(e.message) }
      } else setError(e instanceof Error ? e.message : '无法开始练习')
    } finally { setStarting(false) }
  }
  const start = async (payload: SessionCreatePayload) => {
    if (activeSessions.some((session) => session.status === 'in_progress')) {
      setPendingPayload(payload)
      setRandomOpen(false)
      return
    }
    await createSession(payload)
  }
  const abandon = async (session: ExerciseSessionSummary) => {
    if (!window.confirm(`放弃“${session.title}”？已保存的 ${session.answered_count} 道答案会保留在记录中，但本次练习不能再继续或提交。`)) return
    setStarting(true); setError('')
    try {
      await api(`/api/exercises/sessions/${session.id}/abandon`, { method: 'POST' })
      const sessions = await refreshActiveSessions()
      if (pendingPayload && !sessions.some((item) => item.status === 'in_progress')) await createSession(pendingPayload)
    } catch (e) { setError(e instanceof Error ? e.message : '无法放弃练习') } finally { setStarting(false) }
  }
  const toggle = (setId: number) => setSelected((current) => current.includes(setId) ? current.filter((id) => id !== setId) : [...current, setId])
  const inProgress = activeSessions.filter((session) => session.status === 'in_progress')
  return <section className="exercise-home-section">
    <header className="section-title practice-section-title"><div className="practice-title-copy"><span className="practice-title-icon" aria-hidden="true"><BookCheck /></span><div><p className="eyebrow">习题练习</p><h2>读题、思考、动手编程</h2><p>{sets.length ? `${available} 道已发布习题，完成整套题或按题型随机练习。` : '当前没有新的已发布题套，你仍可继续尚未完成的练习。'}</p></div></div>{sets.length > 0 && <div className="exercise-home-actions"><button ref={randomTriggerRef} className="primary" onClick={() => { setError(''); setRandomOpen(true) }}><Dice5 />随机组题</button><button className="primary" disabled={starting} onClick={() => void start({ mode: 'wrong', question_set_ids: [], counts: {} })}><RotateCcw />错题重练</button></div>}</header>
    {error && !randomOpen && <p className="notice error">{error}</p>}
    {activeSessions.length > 0 && <section className="active-exercise-list" aria-labelledby="active-exercise-title"><div className="active-exercise-heading"><div><p className="eyebrow">尚未结束</p><h3 id="active-exercise-title">继续上次练习</h3></div><span>{inProgress.length ? `${inProgress.length} 个进行中` : '等待判题'}</span></div>{activeSessions.map((session) => <article className={`active-exercise-card ${session.status}`} key={session.id}><div className="active-exercise-icon">{session.status === 'judging' ? <Clock3 /> : <BookCheck />}</div><div className="grow"><div><strong>{session.title}</strong><em>{session.status === 'judging' ? '判题中' : '进行中'}</em></div><p>{session.status === 'judging' ? '答案已经提交，结果生成后会自动显示。' : `已完成 ${session.answered_count} / ${session.total_count} 题`}</p><small>最近保存 {new Date(session.last_activity_at).toLocaleString('zh-CN', { hour12: false })}</small>{session.status === 'in_progress' && <div className="active-exercise-progress" aria-label={`已完成 ${session.answered_count} / ${session.total_count} 题`}><i style={{ width: `${session.total_count ? session.answered_count / session.total_count * 100 : 0}%` }} /></div>}</div><div className="active-exercise-actions"><button className="primary" onClick={() => navigate(`/exercise/${session.id}`)}>{session.status === 'judging' ? '查看进度' : '继续练习'}<ArrowRight /></button>{session.status === 'in_progress' && <button className="ghost danger-button" disabled={starting} onClick={() => void abandon(session)}><Trash2 />放弃本次</button>}</div></article>)}</section>}
    <div className="question-set-grid">{sets.map((item) => <article className="question-set-card" key={item.id}><BookCheck /><div className="grow"><h3>{item.title}</h3><p>{item.description || `${item.question_count} 道题`}</p><span>{item.question_count} 题 · {item.total_points} 分{item.attempts ? ` · 已练 ${item.attempts} 次` : ''}</span></div><button className="primary" disabled={starting} onClick={() => void start({ mode: 'set', question_set_ids: [item.id], counts: {} })}>整套练习</button></article>)}</div>
    {randomOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setRandomOpen(false); window.setTimeout(() => randomTriggerRef.current?.focus()) } }}><div ref={randomDialogRef} className="random-practice-modal card" role="dialog" aria-modal="true" aria-labelledby="random-practice-title">
      <header><div><p className="eyebrow">个性化练习</p><h2 id="random-practice-title">随机组题</h2><p>选择题套，再决定每种题型抽取多少道。</p></div><button className="ghost" aria-label="关闭随机组题" onClick={() => { setRandomOpen(false); window.setTimeout(() => randomTriggerRef.current?.focus()) }}><X /></button></header>
      <section><h3>选择题套</h3><div className="random-set-options">{sets.map((item) => <label className="check-label" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />{item.title}</label>)}</div></section>
      <section><h3>设置题量</h3><div className="random-count-grid">{([
        ['single_choice', '单选'], ['multiple_choice', '多选'], ['true_false', '判断'], ['programming', '编程'],
      ] as [ExerciseQuestionType, string][]).map(([type, label]) => <label key={type}>{type === 'programming' && <Code2 />}{label}<span>可用 {availableByType[type]}</span><input aria-label={`${label}题数量`} type="number" min="0" max={availableByType[type]} value={counts[type]} onChange={(e) => setCounts({ ...counts, [type]: Math.max(0, Number(e.target.value)) })} /></label>)}</div></section>
      {randomError && <p className="random-validation" role="alert">{randomError}</p>}
      {error && <p className="notice error">{error}</p>}
      <div className="button-row"><button className="ghost" onClick={() => { setRandomOpen(false); window.setTimeout(() => randomTriggerRef.current?.focus()) }}>取消</button><button className="primary" disabled={starting || !!randomError} onClick={() => void start({ mode: 'random', question_set_ids: selected, counts })}><Dice5 />{starting ? '正在创建…' : '开始随机练习'}</button></div>
    </div></div>}
    {pendingPayload && inProgress.length > 0 && <div className="modal-backdrop" role="presentation"><div className="exercise-conflict-modal card" role="dialog" aria-modal="true" aria-labelledby="exercise-conflict-title"><header><div><p className="eyebrow">已有未完成练习</p><h2 id="exercise-conflict-title">先处理原练习</h2><p>每次只保留一个进行中的练习，避免答案和进度散落在多个记录中。</p></div><button className="ghost" aria-label="关闭未完成练习提示" onClick={() => setPendingPayload(null)}><X /></button></header><div className="exercise-conflict-list">{inProgress.map((session) => <div key={session.id}><span><strong>{session.title}</strong><small>已完成 {session.answered_count} / {session.total_count} 题</small></span><button className="primary" onClick={() => navigate(`/exercise/${session.id}`)}>继续原练习</button><button className="ghost danger-button" disabled={starting} onClick={() => void abandon(session)}>{inProgress.length === 1 ? '放弃并开始新练习' : '放弃这条'}</button></div>)}</div><div className="button-row"><button className="ghost" onClick={() => setPendingPayload(null)}>取消</button></div></div></div>}
  </section>
}
