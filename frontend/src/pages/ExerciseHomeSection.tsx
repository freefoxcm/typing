import { useEffect, useMemo, useRef, useState } from 'react'
import { BookCheck, Code2, Dice5, RotateCcw, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { ExerciseSession, ExerciseQuestionType, QuestionSetSummary } from '../types'

export function ExerciseHomeSection({ sets }: { sets: QuestionSetSummary[] }) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<number[]>(() => sets.map((item) => item.id))
  const [counts, setCounts] = useState<Record<ExerciseQuestionType, number>>({ single_choice: 5, multiple_choice: 0, true_false: 5, programming: 0 })
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [randomOpen, setRandomOpen] = useState(false)
  const randomTriggerRef = useRef<HTMLButtonElement>(null)
  const randomDialogRef = useRef<HTMLDivElement>(null)
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

  const start = async (payload: unknown) => {
    setStarting(true); setError('')
    try {
      const session = await api<ExerciseSession>('/api/exercises/sessions', { method: 'POST', ...jsonBody(payload) })
      setRandomOpen(false)
      navigate(`/exercise/${session.id}`)
    } catch (e) { setError(e instanceof Error ? e.message : '无法开始练习') } finally { setStarting(false) }
  }
  const toggle = (setId: number) => setSelected((current) => current.includes(setId) ? current.filter((id) => id !== setId) : [...current, setId])
  if (!sets.length) return null
  return <section className="exercise-home-section">
    <header className="section-title"><div><p className="eyebrow">习题练习</p><h2>读题、思考、动手编程</h2><p>{available} 道已发布习题，完成整套题或按题型随机练习。</p></div><div className="exercise-home-actions"><button ref={randomTriggerRef} className="primary" onClick={() => { setError(''); setRandomOpen(true) }}><Dice5 />随机组题</button><button className="ghost" disabled={starting} onClick={() => void start({ mode: 'wrong', question_set_ids: [], counts: {} })}><RotateCcw />错题重练</button></div></header>
    {error && !randomOpen && <p className="notice error">{error}</p>}
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
  </section>
}
