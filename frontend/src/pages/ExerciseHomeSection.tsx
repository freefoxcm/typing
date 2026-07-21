import { useMemo, useState } from 'react'
import { BookCheck, Code2, Dice5, RotateCcw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { ExerciseSession, ExerciseQuestionType, QuestionSetSummary } from '../types'

export function ExerciseHomeSection({ sets }: { sets: QuestionSetSummary[] }) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<number[]>(() => sets.map((item) => item.id))
  const [counts, setCounts] = useState<Record<ExerciseQuestionType, number>>({ single_choice: 5, multiple_choice: 0, true_false: 5, programming: 0 })
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const available = useMemo(() => sets.reduce((sum, item) => sum + item.question_count, 0), [sets])

  const start = async (payload: unknown) => {
    setStarting(true); setError('')
    try {
      const session = await api<ExerciseSession>('/api/exercises/sessions', { method: 'POST', ...jsonBody(payload) })
      navigate(`/exercise/${session.id}`)
    } catch (e) { setError(e instanceof Error ? e.message : '无法开始练习') } finally { setStarting(false) }
  }
  const toggle = (setId: number) => setSelected((current) => current.includes(setId) ? current.filter((id) => id !== setId) : [...current, setId])
  if (!sets.length) return null
  return <section className="exercise-home-section">
    <header className="section-title"><div><p className="eyebrow">习题练习</p><h2>读题、思考、动手编程</h2><p>{available} 道已发布习题，完成整套题或按题型随机练习。</p></div></header>
    {error && <p className="notice error">{error}</p>}
    <div className="question-set-grid">{sets.map((item) => <article className="question-set-card" key={item.id}><BookCheck /><div className="grow"><h3>{item.title}</h3><p>{item.description || `${item.question_count} 道题`}</p><span>{item.question_count} 题 · {item.total_points} 分{item.attempts ? ` · 已练 ${item.attempts} 次` : ''}</span></div><button className="primary" disabled={starting} onClick={() => void start({ mode: 'set', question_set_ids: [item.id], counts: {} })}>整套练习</button></article>)}</div>
    <div className="random-practice-card card"><div><Dice5 /><h3>随机组题</h3><p>选择题套，再决定每种题型抽取多少道。</p></div><div className="random-set-options">{sets.map((item) => <label className="check-label" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />{item.title}</label>)}</div><div className="random-count-grid">{([
      ['single_choice', '单选'], ['multiple_choice', '多选'], ['true_false', '判断'], ['programming', '编程'],
    ] as [ExerciseQuestionType, string][]).map(([type, label]) => <label key={type}>{type === 'programming' && <Code2 />}{label}<input type="number" min="0" max="50" value={counts[type]} onChange={(e) => setCounts({ ...counts, [type]: Number(e.target.value) })} /></label>)}</div><div className="button-row"><button className="primary" disabled={starting || !selected.length} onClick={() => void start({ mode: 'random', question_set_ids: selected, counts })}><Dice5 />开始随机练习</button><button className="ghost" disabled={starting} onClick={() => void start({ mode: 'wrong', question_set_ids: [], counts: {} })}><RotateCcw />重练我的错题</button></div></div>
  </section>
}
