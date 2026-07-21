import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Code2, Play, Send, XCircle } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import type { ExerciseSession, ExerciseSessionItem } from '../types'

type SampleResult = { status: string; cases?: { id?: number; status: string; duration_ms: number; stdout?: string; stderr?: string }[] }
type TextEdit = { value: string; selectionStart: number; selectionEnd: number }

export function pythonIndentEdit(value: string, selectionStart: number, selectionEnd: number, key: 'Enter' | 'Tab', shiftKey = false): TextEdit {
  if (key === 'Enter') {
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
    const beforeCursor = value.slice(lineStart, selectionStart)
    const leading = beforeCursor.match(/^[ \t]*/)?.[0] ?? ''
    const extra = beforeCursor.trimEnd().endsWith(':') ? '    ' : ''
    const inserted = `\n${leading}${extra}`
    return {
      value: value.slice(0, selectionStart) + inserted + value.slice(selectionEnd),
      selectionStart: selectionStart + inserted.length,
      selectionEnd: selectionStart + inserted.length,
    }
  }

  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
  let blockEnd = value.indexOf('\n', selectionEnd)
  if (blockEnd < 0) blockEnd = value.length
  const block = value.slice(lineStart, blockEnd)
  const lines = block.split('\n')
  if (!shiftKey) {
    const replacement = lines.map((line) => `    ${line}`).join('\n')
    return {
      value: value.slice(0, lineStart) + replacement + value.slice(blockEnd),
      selectionStart: selectionStart + 4,
      selectionEnd: selectionEnd + lines.length * 4,
    }
  }
  const removed = lines.map((line) => Math.min(4, line.match(/^ */)?.[0].length ?? 0))
  const replacement = lines.map((line, index) => line.slice(removed[index])).join('\n')
  return {
    value: value.slice(0, lineStart) + replacement + value.slice(blockEnd),
    selectionStart: Math.max(lineStart, selectionStart - removed[0]),
    selectionEnd: Math.max(lineStart, selectionEnd - removed.reduce((sum, count) => sum + count, 0)),
  }
}

export function ExercisePage() {
  const { sessionId } = useParams()
  const [session, setSession] = useState<ExerciseSession | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sampleResults, setSampleResults] = useState<Record<number, SampleResult>>({})
  const [codeDrafts, setCodeDrafts] = useState<Record<number, string>>({})

  const load = useCallback(() => api<ExerciseSession>(`/api/exercises/sessions/${sessionId}`).then((data) => {
    setSession(data)
    setCodeDrafts((current) => {
      const next = { ...current }
      for (const candidate of data.items) {
        if (candidate.question.type === 'programming' && !(candidate.id in next)) {
          next[candidate.id] = candidate.answer.code || candidate.question.programming?.starter_code || ''
        }
      }
      return next
    })
  }).catch((e) => setError(e.message)), [sessionId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (session?.status !== 'judging') return
    const timer = window.setInterval(() => void load(), 1200)
    return () => window.clearInterval(timer)
  }, [session?.status, load])
  const item = session?.items[index]
  const unanswered = useMemo(() => session?.items.filter((candidate) => candidate.answer.status === 'unanswered').length ?? 0, [session])

  const updateLocal = (itemId: number, patch: Partial<ExerciseSessionItem['answer']>) => setSession((current) => current ? ({ ...current, items: current.items.map((candidate) => candidate.id === itemId ? { ...candidate, answer: { ...candidate.answer, ...patch } } : candidate) }) : current)
  const save = async (target: ExerciseSessionItem, patch: Partial<ExerciseSessionItem['answer']>) => {
    const next = { ...target.answer, ...patch }
    updateLocal(target.id, { ...patch, status: next.selected_option_ids.length || next.bool_answer !== null || next.code.trim() ? 'answered' : 'unanswered' })
    try {
      await api(`/api/exercises/sessions/${sessionId}/answers/${target.id}`, { method: 'PATCH', ...jsonBody({ selected_option_ids: next.selected_option_ids, bool_answer: next.bool_answer, code: next.code }) })
      setMessage('答案已保存'); window.setTimeout(() => setMessage(''), 1000)
    } catch (e) { setError(e instanceof Error ? e.message : '答案保存失败') }
  }

  const runSamples = async (target: ExerciseSessionItem) => {
    setError(''); setSampleResults((current) => ({ ...current, [target.id]: { status: 'queued' } }))
    try {
      const code = codeDrafts[target.id] ?? target.answer.code ?? target.question.programming?.starter_code ?? ''
      await save(target, { code })
      const queued = await api<{ job_id: string }>(`/api/exercises/sessions/${sessionId}/sample-runs`, { method: 'POST', ...jsonBody({ session_item_id: target.id, code }) })
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 700))
        const result = await api<SampleResult>(`/api/exercises/sample-runs/${queued.job_id}`)
        if (result.status !== 'queued') { setSampleResults((current) => ({ ...current, [target.id]: result })); return }
      }
      setSampleResults((current) => ({ ...current, [target.id]: { status: 'queued' } }))
    } catch (e) { setError(e instanceof Error ? e.message : '运行样例失败'); setSampleResults((current) => ({ ...current, [target.id]: { status: 'failed' } })) }
  }

  const submit = async () => {
    if (!session) return
    if (unanswered && !window.confirm(`还有 ${unanswered} 道题未作答，未答题将按 0 分计算。确认提交？`)) return
    if (!unanswered && !window.confirm('提交后不能再修改答案，确认提交整套练习？')) return
    setSubmitting(true); setError('')
    try {
      const result = await api<{ status: string }>(`/api/exercises/sessions/${session.id}/submit`, { method: 'POST' })
      await load()
      if (result.status === 'judging') setMessage('客观题已提交，正在运行编程题隐藏测试点…')
    } catch (e) { setError(e instanceof Error ? e.message : '提交失败') } finally { setSubmitting(false) }
  }

  if (!session || !item) return <div className="page"><p className={error ? 'notice error' : 'notice'}>{error || '正在准备习题…'}</p></div>
  const complete = session.status === 'completed'
  return <div className="page exercise-page">
    <header className="exercise-header"><Link className="back-link" to="/"><ArrowLeft />返回首页</Link><div><p className="eyebrow">{complete ? '练习结果' : session.mode === 'set' ? '整套练习' : session.mode === 'random' ? '随机练习' : '错题重练'}</p><h1>{session.title}</h1></div><div className="exercise-score">{complete ? <><strong>{session.score}</strong><span>/ {session.max_score} 分</span></> : <><strong>{index + 1}</strong><span>/ {session.items.length}</span></>}</div></header>
    {error && <p className="notice error">{error}</p>}{message && <p className="notice success">{message}</p>}
    {session.status === 'judging' && <div className="judging-banner"><Clock3 /><div><strong>正在自动判题</strong><p>隐藏测试点在隔离环境中运行，结果会自动刷新。</p></div></div>}
    <div className="exercise-layout"><aside className="question-navigator" aria-label="题目导航">{session.items.map((candidate, itemIndex) => <button className={`${itemIndex === index ? 'active' : ''} ${candidate.answer.status !== 'unanswered' ? 'answered' : ''}`} onClick={() => setIndex(itemIndex)} key={candidate.id}>{itemIndex + 1}{complete && (candidate.answer.awarded_points === candidate.points ? <CheckCircle2 /> : <XCircle />)}</button>)}</aside>
      <main className="exercise-question-card card"><div className="question-heading"><span>{questionTypeLabel(item.question.type)}</span><strong>{item.points} 分</strong><small>{item.question.question_set_title}</small></div>
        {item.question.show_source_crop && item.question.source_asset_id && <img className="exercise-source-image" src={`/api/question-assets/${item.question.source_asset_id}`} alt="原题题面" />}
        <MarkdownText value={item.question.stem_markdown} />
        {item.question.type === 'single_choice' && <div className="answer-options">{item.question.options.map((option) => <label className={complete && option.correct ? 'correct-option' : ''} key={option.id}><input type="radio" name={`question-${item.id}`} checked={item.answer.selected_option_ids.includes(option.id!)} disabled={complete || session.status !== 'in_progress'} onChange={() => void save(item, { selected_option_ids: [option.id!] })} /><strong>{option.label}</strong><MarkdownText value={option.content_markdown} /></label>)}</div>}
        {item.question.type === 'multiple_choice' && <div className="answer-options">{item.question.options.map((option) => <label className={complete && option.correct ? 'correct-option' : ''} key={option.id}><input type="checkbox" checked={item.answer.selected_option_ids.includes(option.id!)} disabled={complete || session.status !== 'in_progress'} onChange={(e) => void save(item, { selected_option_ids: e.target.checked ? [...item.answer.selected_option_ids, option.id!] : item.answer.selected_option_ids.filter((id) => id !== option.id) })} /><strong>{option.label}</strong><MarkdownText value={option.content_markdown} /></label>)}</div>}
        {item.question.type === 'true_false' && <div className="judgment-options"><button disabled={complete || session.status !== 'in_progress'} className={item.answer.bool_answer === true ? 'selected' : ''} onClick={() => void save(item, { bool_answer: true })}><CheckCircle2 />正确</button><button disabled={complete || session.status !== 'in_progress'} className={item.answer.bool_answer === false ? 'selected' : ''} onClick={() => void save(item, { bool_answer: false })}><XCircle />错误</button></div>}
        {item.question.type === 'programming' && item.question.programming && <ProgrammingAnswer item={item} complete={complete} sessionStatus={session.status} code={codeDrafts[item.id] ?? item.answer.code ?? item.question.programming.starter_code ?? ''} sampleResult={sampleResults[item.id]} onCodeChange={(code) => { setCodeDrafts((current) => ({ ...current, [item.id]: code })); updateLocal(item.id, { code, status: code.trim() ? 'answered' : 'unanswered' }) }} onSave={(code) => void save(item, { code })} onRun={() => void runSamples(item)} />}
        {complete && <ResultPanel item={item} />}
        <footer className="exercise-question-footer"><button className="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft />上一题</button>{index < session.items.length - 1 ? <button className="primary" onClick={() => setIndex(index + 1)}>下一题<ChevronRight /></button> : !complete && <button className="primary" disabled={submitting || session.status !== 'in_progress'} onClick={() => void submit()}><Send />提交整套练习</button>}</footer>
      </main></div>
    {!complete && index < session.items.length - 1 && <div className="exercise-submit-row"><span>{unanswered ? `还有 ${unanswered} 题未答` : '全部题目均已作答'}</span><button className="primary" disabled={submitting || session.status !== 'in_progress'} onClick={() => void submit()}><Send />提交整套练习</button></div>}
  </div>
}

function ProgrammingAnswer({ item, complete, sessionStatus, code, sampleResult, onCodeChange, onSave, onRun }: {
  item: ExerciseSessionItem
  complete: boolean
  sessionStatus: string
  code: string
  sampleResult?: SampleResult
  onCodeChange: (code: string) => void
  onSave: (code: string) => void
  onRun: () => void
}) {
  const program = item.question.programming!
  const applyIndent = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' && event.key !== 'Tab') return
    event.preventDefault()
    const target = event.currentTarget
    const edit = pythonIndentEdit(code, target.selectionStart, target.selectionEnd, event.key, event.shiftKey)
    onCodeChange(edit.value)
    window.requestAnimationFrame(() => {
      target.selectionStart = edit.selectionStart
      target.selectionEnd = edit.selectionEnd
    })
  }
  return <div className="programming-answer"><div className="program-spec-grid"><section><h3>输入格式</h3><MarkdownText value={program.input_markdown} /></section><section><h3>输出格式</h3><MarkdownText value={program.output_markdown} /></section></div>{program.constraints_markdown && <section><h3>数据范围</h3><MarkdownText value={program.constraints_markdown} /></section>}<div className="program-limits"><span>{program.time_limit_ms} ms</span><span>{program.memory_limit_mb} MB</span></div><label>Python 3.13 代码<textarea aria-label="Python 3.13 代码" className="code-editor" spellCheck={false} rows={16} value={code} disabled={complete || sessionStatus !== 'in_progress'} onKeyDown={applyIndent} onChange={(event) => onCodeChange(event.target.value)} onBlur={() => onSave(code)} /></label>{!complete && <button className="ghost" disabled={!code.trim() || sampleResult?.status === 'queued'} onClick={onRun}><Play />{sampleResult?.status === 'queued' ? '正在运行…' : '运行公开样例'}</button>}<SampleResults result={sampleResult} /></div>
}

function MarkdownText({ value }: { value?: string }) {
  const parts = (value || '—').split(/```/g)
  return <div className="markdown-text">{parts.map((part, index) => {
    if (index % 2 === 1) {
      const lines = part.replace(/^\n/, '').split('\n')
      if (lines[0] && /^[a-z0-9_+-]+$/i.test(lines[0])) lines.shift()
      return <pre key={index}><code>{lines.join('\n').trimEnd()}</code></pre>
    }
    return <span key={index}>{part}</span>
  })}</div>
}
function questionTypeLabel(type: string) { return ({ single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题', programming: '编程题' } as Record<string, string>)[type] ?? type }

function SampleResults({ result }: { result?: SampleResult }) {
  if (!result || result.status === 'queued') return null
  const indentationError = result.cases?.some((item) => /IndentationError|TabError/.test(item.stderr || ''))
  return <div className="sample-results"><h3>样例运行结果</h3>{indentationError && <p className="code-hint">Python 的 for、if、while 或 def 语句后的代码需要缩进。可以在编辑器中按 Tab 添加 4 个空格。</p>}{result.cases?.map((item, index) => <div className={item.status === 'AC' ? 'passed' : 'failed'} key={item.id ?? index}><strong>样例 {index + 1} · {item.status}</strong><span>{item.duration_ms} ms</span>{item.stdout !== undefined && <pre>{item.stdout || '（无输出）'}</pre>}{item.stderr && <pre className="stderr">{item.stderr}</pre>}</div>)}</div>
}

function ResultPanel({ item }: { item: ExerciseSessionItem }) {
  const full = item.answer.awarded_points === item.points
  return <section className={`exercise-result-panel ${full ? 'correct' : 'incorrect'}`}><header>{full ? <CheckCircle2 /> : <XCircle />}<strong>{full ? '回答正确' : '需要再想一想'}</strong><span>{item.answer.awarded_points ?? 0} / {item.points} 分</span></header>{item.question.type === 'true_false' && <p>正确答案：{item.question.correct_bool ? '正确' : '错误'}</p>}{item.question.type === 'programming' && <><p>隐藏测试点：通过 {item.answer.details?.passed ?? 0} / {item.answer.details?.total ?? 0}，状态 {item.answer.status}</p>{item.answer.status === 'Syntax Error' && <p className="code-hint">请检查括号、冒号和缩进；for、if、while 或 def 后的代码块必须缩进。</p>}</>}{item.question.explanation_markdown && <><h3>答案解析</h3><MarkdownText value={item.question.explanation_markdown} /></>}{item.question.programming?.reference_solution && <><h3>参考程序</h3><pre className="reference-code">{item.question.programming.reference_solution}</pre></>}</section>
}
