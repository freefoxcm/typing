import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Code2, LoaderCircle, Save, Send, WifiOff, XCircle } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import { inlineMarkdown, MarkdownText } from '../components/MarkdownText'
import type { PythonFormatStatus, PythonSyntaxDiagnostic } from '../components/PythonCodeEditor'
import type { ExerciseSession, ExerciseSessionItem } from '../types'

type SampleResult = { status: string; cases?: { id?: number; status: string; duration_ms: number; stdout?: string; stderr?: string }[] }
type TextEdit = { value: string; selectionStart: number; selectionEnd: number }
type SyntaxCheckResult = { valid: boolean; diagnostics: PythonSyntaxDiagnostic[] }
type SyntaxCheckState = { status: 'idle' | 'checking' | 'valid' | 'invalid' | 'unavailable'; diagnostics: PythonSyntaxDiagnostic[] }
type PythonFormatResult = { valid: boolean; formatted_code: string; changed: boolean; diagnostics: PythonSyntaxDiagnostic[] }
type PythonEditorPreferences = { autoCompletion: boolean; autoSyntax: boolean; autoFormat: boolean }

const PYTHON_EDITOR_PREFERENCES_KEY = 'kidtype-python-editor-preferences-v1'
const DEFAULT_PYTHON_EDITOR_PREFERENCES: PythonEditorPreferences = { autoCompletion: true, autoSyntax: true, autoFormat: false }

export function readPythonEditorPreferences(storage: Pick<Storage, 'getItem'> = window.localStorage): PythonEditorPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(PYTHON_EDITOR_PREFERENCES_KEY) || '{}')
    return {
      autoCompletion: typeof parsed.autoCompletion === 'boolean' ? parsed.autoCompletion : true,
      autoSyntax: typeof parsed.autoSyntax === 'boolean' ? parsed.autoSyntax : true,
      autoFormat: typeof parsed.autoFormat === 'boolean' ? parsed.autoFormat : false,
    }
  } catch {
    return { ...DEFAULT_PYTHON_EDITOR_PREFERENCES }
  }
}

const PythonCodeEditor = lazy(() => import('../components/PythonCodeEditor').then((module) => ({ default: module.PythonCodeEditor })))

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
  const navigate = useNavigate()
  const [session, setSession] = useState<ExerciseSession | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sampleResults, setSampleResults] = useState<Record<number, SampleResult>>({})
  const [codeDrafts, setCodeDrafts] = useState<Record<number, string>>({})
  const [syntaxChecks, setSyntaxChecks] = useState<Record<number, SyntaxCheckState>>({})
  const [formatStates, setFormatStates] = useState<Record<number, PythonFormatStatus>>({})
  const [editorPreferences, setEditorPreferences] = useState<PythonEditorPreferences>(() => readPythonEditorPreferences())
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const sessionRef = useRef<ExerciseSession | null>(null)
  const initializedSessionRef = useRef<string | undefined>(undefined)
  const indexRef = useRef(0)
  const navigationChainRef = useRef<Promise<void>>(Promise.resolve())
  const pendingCodesRef = useRef(new Map<number, string>())
  const codeDraftsRef = useRef<Record<number, string>>({})
  const codeTimersRef = useRef(new Map<number, number>())
  const codeSavesRef = useRef(new Map<number, { code: string; promise: Promise<boolean> }>())
  const activeAnswerSavesRef = useRef(0)
  const syntaxTimersRef = useRef(new Map<number, number>())
  const syntaxControllersRef = useRef(new Map<number, AbortController>())
  const syntaxVersionsRef = useRef(new Map<number, number>())
  const initializedSyntaxRef = useRef(new Set<number>())
  const formatControllersRef = useRef(new Map<number, AbortController>())
  const formatVersionsRef = useRef(new Map<number, number>())
  const formatRequestsRef = useRef(new Map<number, { code: string; promise: Promise<string> }>())
  const autoSyntaxRef = useRef(editorPreferences.autoSyntax)
  const autoFormatRef = useRef(editorPreferences.autoFormat)
  autoSyntaxRef.current = editorPreferences.autoSyntax
  autoFormatRef.current = editorPreferences.autoFormat

  useEffect(() => {
    try { window.localStorage.setItem(PYTHON_EDITOR_PREFERENCES_KEY, JSON.stringify(editorPreferences)) } catch { /* private storage can be unavailable */ }
  }, [editorPreferences])

  const load = useCallback(() => api<ExerciseSession>(`/api/exercises/sessions/${sessionId}`).then((data) => {
    sessionRef.current = data
    setSession(data)
    if (initializedSessionRef.current !== sessionId) {
      const firstUnanswered = data.items.findIndex((candidate) => candidate.answer.status === 'unanswered')
      const savedIndex = data.status === 'in_progress' && Number.isInteger(data.current_item_sort_order)
        ? data.items.findIndex((candidate) => candidate.sort_order === data.current_item_sort_order)
        : -1
      const initialIndex = savedIndex >= 0
        ? savedIndex
        : data.status === 'in_progress'
          ? firstUnanswered >= 0 ? firstUnanswered : 0
          : Math.max(0, data.items.length - 1)
      indexRef.current = initialIndex
      setIndex(initialIndex)
      initializedSessionRef.current = sessionId
    }
    setCodeDrafts((current) => {
      const next = { ...current }
      for (const candidate of data.items) {
        if (candidate.question.type === 'programming' && !(candidate.id in next)) {
          next[candidate.id] = candidate.answer.code || candidate.question.programming?.starter_code || ''
        }
      }
      codeDraftsRef.current = next
      return next
    })
  }).catch((e) => setError(e.message)), [sessionId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (session?.status !== 'judging') return
    const timer = window.setInterval(() => void load(), 1200)
    return () => window.clearInterval(timer)
  }, [session?.status, load])
  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingCodesRef.current.size) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [])
  useEffect(() => () => {
    for (const timer of codeTimersRef.current.values()) window.clearTimeout(timer)
    for (const timer of syntaxTimersRef.current.values()) window.clearTimeout(timer)
    for (const controller of syntaxControllersRef.current.values()) controller.abort()
    for (const controller of formatControllersRef.current.values()) controller.abort()
  }, [])
  const item = session?.items[index]
  const unanswered = useMemo(() => session?.items.filter((candidate) => candidate.answer.status === 'unanswered').length ?? 0, [session])

  const updateLocal = (itemId: number, patch: Partial<ExerciseSessionItem['answer']>) => setSession((current) => {
    if (!current) return current
    const next = { ...current, items: current.items.map((candidate) => candidate.id === itemId ? { ...candidate, answer: { ...candidate.answer, ...patch } } : candidate) }
    sessionRef.current = next
    return next
  })
  const save = async (target: ExerciseSessionItem, patch: Partial<ExerciseSessionItem['answer']>) => {
    const next = { ...target.answer, ...patch }
    updateLocal(target.id, { ...patch, status: next.selected_option_ids.length || next.bool_answer !== null || (next.blank_answers || []).some((value) => value.trim()) || next.code.trim() ? 'answered' : 'unanswered' })
    activeAnswerSavesRef.current += 1
    setSaveState('saving')
    setError('')
    try {
      await api(`/api/exercises/sessions/${sessionId}/answers/${target.id}`, { method: 'POST', ...jsonBody({ selected_option_ids: next.selected_option_ids, bool_answer: next.bool_answer, blank_answers: next.blank_answers || [], code: next.code }) })
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : '答案保存失败')
      setSaveState('error')
      return false
    } finally {
      activeAnswerSavesRef.current = Math.max(0, activeAnswerSavesRef.current - 1)
      if (activeAnswerSavesRef.current === 0 && pendingCodesRef.current.size === 0) {
        setSaveState((current) => current === 'error' ? 'error' : 'saved')
      }
    }
  }
  const persistCode = async (itemId: number, code: string): Promise<boolean> => {
    const timer = codeTimersRef.current.get(itemId)
    if (timer) window.clearTimeout(timer)
    codeTimersRef.current.delete(itemId)
    const inFlight = codeSavesRef.current.get(itemId)
    if (inFlight) {
      if (inFlight.code === code) return inFlight.promise
      return inFlight.promise.then(() => persistCode(itemId, code))
    }
    const target = sessionRef.current?.items.find((candidate) => candidate.id === itemId)
    if (!target || target.answer.code === code && !pendingCodesRef.current.has(itemId)) return true
    setSaveState('saving')
    const promise = (async () => {
      let saved = false
      try {
        saved = await save(target, { code })
      } catch (e) {
        setError(e instanceof Error ? e.message : '代码保存失败')
      }
      if (saved && pendingCodesRef.current.get(itemId) === code) pendingCodesRef.current.delete(itemId)
      setSaveState((current) => {
        if (!saved || current === 'error') return 'error'
        return pendingCodesRef.current.size === 0 && activeAnswerSavesRef.current === 0 ? 'saved' : 'saving'
      })
      return saved
    })()
    codeSavesRef.current.set(itemId, { code, promise })
    try {
      return await promise
    } finally {
      if (codeSavesRef.current.get(itemId)?.promise === promise) codeSavesRef.current.delete(itemId)
    }
  }
  const scheduleCodeSave = (itemId: number, code: string) => {
    pendingCodesRef.current.set(itemId, code)
    setSaveState('saving')
    const currentTimer = codeTimersRef.current.get(itemId)
    if (currentTimer) window.clearTimeout(currentTimer)
    codeTimersRef.current.set(itemId, window.setTimeout(() => void persistCode(itemId, code), 600))
  }
  const scheduleSyntaxCheck = (target: ExerciseSessionItem, code: string, options: { immediate?: boolean; force?: boolean } = {}) => {
    const itemId = target.id
    const existingTimer = syntaxTimersRef.current.get(itemId)
    if (existingTimer) window.clearTimeout(existingTimer)
    syntaxTimersRef.current.delete(itemId)
    syntaxControllersRef.current.get(itemId)?.abort()
    syntaxControllersRef.current.delete(itemId)
    const version = (syntaxVersionsRef.current.get(itemId) ?? 0) + 1
    syntaxVersionsRef.current.set(itemId, version)
    if (!options.force && !autoSyntaxRef.current) {
      setSyntaxChecks((current) => ({ ...current, [itemId]: { status: 'idle', diagnostics: [] } }))
      return
    }
    if (!code.trim()) {
      setSyntaxChecks((current) => ({ ...current, [itemId]: { status: 'idle', diagnostics: [] } }))
      return
    }
    setSyntaxChecks((current) => ({ ...current, [itemId]: { status: 'checking', diagnostics: [] } }))
    syntaxTimersRef.current.set(itemId, window.setTimeout(async () => {
      syntaxTimersRef.current.delete(itemId)
      const controller = new AbortController()
      syntaxControllersRef.current.set(itemId, controller)
      try {
        const result = await api<SyntaxCheckResult>(`/api/exercises/sessions/${sessionId}/syntax-check`, {
          method: 'POST', signal: controller.signal, ...jsonBody({ session_item_id: itemId, code }),
        })
        if (syntaxVersionsRef.current.get(itemId) !== version) return
        setSyntaxChecks((current) => ({
          ...current,
          [itemId]: { status: result.valid ? 'valid' : 'invalid', diagnostics: result.diagnostics ?? [] },
        }))
      } catch (error) {
        if (controller.signal.aborted || syntaxVersionsRef.current.get(itemId) !== version) return
        setSyntaxChecks((current) => ({ ...current, [itemId]: { status: 'unavailable', diagnostics: [] } }))
      } finally {
        if (syntaxControllersRef.current.get(itemId) === controller) syntaxControllersRef.current.delete(itemId)
      }
    }, options.immediate ? 0 : 700))
  }
  useEffect(() => {
    if (!item || session?.status !== 'in_progress' || item.question.type !== 'programming' || initializedSyntaxRef.current.has(item.id)) return
    initializedSyntaxRef.current.add(item.id)
    scheduleSyntaxCheck(item, codeDrafts[item.id] ?? item.answer.code ?? item.question.programming?.starter_code ?? '')
  }, [item?.id, session?.status])
  const updateAutoSyntax = (enabled: boolean, target: ExerciseSessionItem, code: string) => {
    autoSyntaxRef.current = enabled
    setEditorPreferences((current) => ({ ...current, autoSyntax: enabled }))
    if (enabled) {
      scheduleSyntaxCheck(target, code)
      return
    }
    const timer = syntaxTimersRef.current.get(target.id)
    if (timer) window.clearTimeout(timer)
    syntaxTimersRef.current.delete(target.id)
    syntaxControllersRef.current.get(target.id)?.abort()
    syntaxControllersRef.current.delete(target.id)
    syntaxVersionsRef.current.set(target.id, (syntaxVersionsRef.current.get(target.id) ?? 0) + 1)
    setSyntaxChecks((current) => ({ ...current, [target.id]: { status: 'idle', diagnostics: [] } }))
  }
  const updateAutoFormat = (enabled: boolean) => {
    autoFormatRef.current = enabled
    setEditorPreferences((current) => ({ ...current, autoFormat: enabled }))
  }
  const requestPythonFormat = (target: ExerciseSessionItem, sourceCode: string): Promise<string> => {
    if (!sourceCode.trim()) {
      setFormatStates((current) => ({ ...current, [target.id]: 'unchanged' }))
      return Promise.resolve(sourceCode)
    }
    const existing = formatRequestsRef.current.get(target.id)
    if (existing?.code === sourceCode) return existing.promise
    formatControllersRef.current.get(target.id)?.abort()
    const controller = new AbortController()
    formatControllersRef.current.set(target.id, controller)
    const version = (formatVersionsRef.current.get(target.id) ?? 0) + 1
    formatVersionsRef.current.set(target.id, version)
    setFormatStates((current) => ({ ...current, [target.id]: 'formatting' }))
    const promise = (async () => {
      try {
        const result = await api<PythonFormatResult>(`/api/exercises/sessions/${sessionId}/format-code`, {
          method: 'POST', signal: controller.signal, ...jsonBody({ session_item_id: target.id, code: sourceCode }),
        })
        if (formatVersionsRef.current.get(target.id) !== version) return codeDraftsRef.current[target.id] ?? sourceCode
        const latestCode = codeDraftsRef.current[target.id] ?? sourceCode
        if (latestCode !== sourceCode) {
          setFormatStates((current) => ({ ...current, [target.id]: 'idle' }))
          return latestCode
        }
        if (!result.valid) {
          setFormatStates((current) => ({ ...current, [target.id]: 'error' }))
          if (autoSyntaxRef.current) setSyntaxChecks((current) => ({ ...current, [target.id]: { status: 'invalid', diagnostics: result.diagnostics ?? [] } }))
          return sourceCode
        }
        const formattedCode = result.formatted_code
        setFormatStates((current) => ({ ...current, [target.id]: result.changed ? 'formatted' : 'unchanged' }))
        if (autoSyntaxRef.current) setSyntaxChecks((current) => ({ ...current, [target.id]: { status: 'valid', diagnostics: [] } }))
        if (formattedCode !== sourceCode) {
          codeDraftsRef.current = { ...codeDraftsRef.current, [target.id]: formattedCode }
          setCodeDrafts((current) => ({ ...current, [target.id]: formattedCode }))
          updateLocal(target.id, { code: formattedCode, status: formattedCode.trim() ? 'answered' : 'unanswered' })
          pendingCodesRef.current.set(target.id, formattedCode)
          setSaveState('saving')
        }
        return formattedCode
      } catch (error) {
        if (!controller.signal.aborted) setFormatStates((current) => ({ ...current, [target.id]: 'error' }))
        return codeDraftsRef.current[target.id] ?? sourceCode
      } finally {
        if (formatControllersRef.current.get(target.id) === controller) formatControllersRef.current.delete(target.id)
      }
    })()
    formatRequestsRef.current.set(target.id, { code: sourceCode, promise })
    void promise.finally(() => {
      if (formatRequestsRef.current.get(target.id)?.promise === promise) formatRequestsRef.current.delete(target.id)
    })
    return promise
  }
  const formatAndSave = async (target: ExerciseSessionItem, code: string) => {
    const formattedCode = await requestPythonFormat(target, code)
    await persistCode(target.id, formattedCode)
    return formattedCode
  }
  const handleEditorBlur = async (target: ExerciseSessionItem, code: string) => {
    if (autoFormatRef.current) await formatAndSave(target, code)
    else await persistCode(target.id, code)
  }
  const flushPendingSaves = async () => {
    const pending = [...pendingCodesRef.current.entries()]
    if (!pending.length) return true
    const results = await Promise.all(pending.map(([itemId, code]) => persistCode(itemId, code)))
    return results.every(Boolean) && pendingCodesRef.current.size === 0
  }
  const persistPosition = async (nextIndex: number) => {
    const current = sessionRef.current
    const target = current?.items[nextIndex]
    if (!current || !target || current.status !== 'in_progress') return true
    setSaveState('saving')
    try {
      const saved = await api<{ session_item_id: number; sort_order: number }>(`/api/exercises/sessions/${current.id}/position`, {
        method: 'PATCH', ...jsonBody({ session_item_id: target.id }),
      })
      const updated = { ...current, current_item_sort_order: saved.sort_order ?? target.sort_order }
      sessionRef.current = updated
      setSession(updated)
      if (!pendingCodesRef.current.size && activeAnswerSavesRef.current === 0) setSaveState('saved')
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : '当前位置保存失败')
      setSaveState('error')
      return false
    }
  }
  const goToIndex = (nextIndex: number) => {
    const transition = navigationChainRef.current.then(async () => {
      if (nextIndex === indexRef.current || !await flushPendingSaves() || !await persistPosition(nextIndex)) return
      indexRef.current = nextIndex
      setIndex(nextIndex)
    })
    navigationChainRef.current = transition.catch(() => undefined)
    return transition
  }
  const saveAndExit = async () => {
    try {
      await navigationChainRef.current
      if (!await flushPendingSaves()) return
      if (!await persistPosition(indexRef.current)) return
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : '答案保存失败')
      setSaveState('error')
    }
  }

  const runSamples = async (target: ExerciseSessionItem) => {
    setError(''); setSampleResults((current) => ({ ...current, [target.id]: { status: 'queued' } }))
    try {
      let code = codeDraftsRef.current[target.id] ?? codeDrafts[target.id] ?? target.answer.code ?? target.question.programming?.starter_code ?? ''
      if (autoFormatRef.current) code = await requestPythonFormat(target, code)
      pendingCodesRef.current.set(target.id, code)
      if (!await persistCode(target.id, code)) throw new Error('代码保存失败，请重试')
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
    if (!await flushPendingSaves()) return
    setSubmitting(true); setError('')
    try {
      const result = await api<{ status: string }>(`/api/exercises/sessions/${session.id}/submit`, { method: 'POST' })
      await load()
      if (result.status === 'judging') setMessage('客观题已提交，正在运行编程题隐藏测试点…')
    } catch (e) { setError(e instanceof Error ? e.message : '提交失败') } finally { setSubmitting(false) }
  }

  if (!session || !item) return <div className="page"><p className={error ? 'notice error' : 'notice'}>{error || '正在准备习题…'}</p></div>
  const complete = session.status === 'completed'
  const editable = session.status === 'in_progress'
  const abandoned = session.status === 'abandoned'
  return <div className="page exercise-page">
    <header className="exercise-header">{editable ? <button className="back-link exercise-save-exit" onClick={() => void saveAndExit()}><ArrowLeft />保存并退出</button> : <Link className="back-link" to="/"><ArrowLeft />返回首页</Link>}<div><p className="eyebrow">{complete ? '练习结果' : abandoned ? '练习已放弃' : session.mode === 'set' ? '整套练习' : session.mode === 'random' ? '随机练习' : '错题重练'}</p><h1>{session.title}</h1></div><div className="exercise-score">{complete ? <><strong>{session.score}</strong><span>/ {session.max_score} 分</span></> : <><strong>{index + 1}</strong><span>/ {session.items.length}</span></>}</div></header>
    {error && <p className="notice error">{error}</p>}{message && <p className="notice success">{message}</p>}
    {session.status === 'judging' && <div className="judging-banner"><Clock3 /><div><strong>正在自动判题</strong><p>隐藏测试点在隔离环境中运行，结果会自动刷新。</p></div></div>}
    {abandoned && <div className="abandoned-banner"><XCircle /><div><strong>本次练习已放弃</strong><p>已保存的作答记录仍会保留，但不能继续修改、提交或查看正确答案。</p></div></div>}
    {editable && <div className={`exercise-save-state ${saveState}`} aria-live="polite"><Save />{saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存失败，请重试' : '所有答案已保存'}</div>}
    {editable && unanswered === 0 && <p className="exercise-ready-submit">全部题目均已作答，尚未提交。检查无误后请提交整套练习。</p>}
    <div className="exercise-layout"><aside className="question-navigator" aria-label="题目导航">{session.items.map((candidate, itemIndex) => {
      const resultClass = complete ? (candidate.answer.awarded_points === candidate.points ? 'result-correct' : 'result-incorrect') : ''
      const resultLabel = complete ? (candidate.answer.awarded_points === candidate.points ? '回答正确' : '回答错误') : ''
      return <button
        className={`${itemIndex === index ? 'active' : ''} ${candidate.answer.status !== 'unanswered' ? 'answered' : ''} ${resultClass}`}
        aria-label={`第 ${itemIndex + 1} 题${resultLabel ? `：${resultLabel}` : ''}`}
        aria-current={itemIndex === index ? 'true' : undefined}
        title={resultLabel || undefined}
        onClick={() => void goToIndex(itemIndex)}
        key={candidate.id}
      ><span className="question-nav-number">{itemIndex + 1}</span>{complete && <span className="question-nav-result" aria-hidden="true">{candidate.answer.awarded_points === candidate.points ? <CheckCircle2 /> : <XCircle />}</span>}</button>
    })}</aside>
      <main className="exercise-question-card card"><div className="question-heading"><span>{questionTypeLabel(item.question.type)}</span><strong>{item.points} 分</strong><small>{item.question.question_set_title}</small></div>
        {item.question.type === 'fill_blank' ? <FillBlankStem item={item} complete={complete} disabled={!editable} onChange={(blank_answers) => void save(item, { blank_answers })} /> : <MarkdownText value={item.question.stem_markdown} />}
        {item.question.stem_image_asset_id && <img className="exercise-stem-image" src={`/api/question-assets/${item.question.stem_image_asset_id}`} alt="题目配图" />}
        {item.question.show_source_crop && item.question.source_asset_id && <img className="exercise-source-image" src={`/api/question-assets/${item.question.source_asset_id}`} alt="完整原题截图" />}
        {item.question.type === 'single_choice' && <div className="answer-options">{item.question.options.map((option) => <label className={complete && option.correct ? 'correct-option' : ''} key={option.id}><input type="radio" name={`question-${item.id}`} checked={item.answer.selected_option_ids.includes(option.id!)} disabled={complete || session.status !== 'in_progress'} onChange={() => void save(item, { selected_option_ids: [option.id!] })} /><strong>{option.label}</strong><MarkdownText value={option.content_markdown} /></label>)}</div>}
        {item.question.type === 'multiple_choice' && <div className="answer-options">{item.question.options.map((option) => <label className={complete && option.correct ? 'correct-option' : ''} key={option.id}><input type="checkbox" checked={item.answer.selected_option_ids.includes(option.id!)} disabled={complete || session.status !== 'in_progress'} onChange={(e) => void save(item, { selected_option_ids: e.target.checked ? [...item.answer.selected_option_ids, option.id!] : item.answer.selected_option_ids.filter((id) => id !== option.id) })} /><strong>{option.label}</strong><MarkdownText value={option.content_markdown} /></label>)}</div>}
        {item.question.type === 'true_false' && <div className="judgment-options"><button disabled={complete || session.status !== 'in_progress'} className={item.answer.bool_answer === true ? 'selected' : ''} onClick={() => void save(item, { bool_answer: true })}><CheckCircle2 />正确</button><button disabled={complete || session.status !== 'in_progress'} className={item.answer.bool_answer === false ? 'selected' : ''} onClick={() => void save(item, { bool_answer: false })}><XCircle />错误</button></div>}
        {item.question.type === 'programming' && item.question.programming && <ProgrammingAnswer
          sessionId={session.id}
          item={item}
          complete={complete}
          sessionStatus={session.status}
          code={codeDrafts[item.id] ?? item.answer.code ?? item.question.programming.starter_code ?? ''}
          sampleResult={sampleResults[item.id]}
          syntaxCheck={syntaxChecks[item.id] ?? { status: 'idle', diagnostics: [] }}
          formatStatus={formatStates[item.id] ?? 'idle'}
          autoCompletionEnabled={editorPreferences.autoCompletion}
          autoSyntaxEnabled={editorPreferences.autoSyntax}
          autoFormatEnabled={editorPreferences.autoFormat}
          onAutoSyntaxChange={(enabled) => updateAutoSyntax(enabled, item, codeDraftsRef.current[item.id] ?? codeDrafts[item.id] ?? item.answer.code ?? item.question.programming?.starter_code ?? '')}
          onAutoFormatChange={updateAutoFormat}
          onAutoCompletionChange={(enabled) => setEditorPreferences((current) => ({ ...current, autoCompletion: enabled }))}
          onCodeChange={(code) => {
            codeDraftsRef.current = { ...codeDraftsRef.current, [item.id]: code }
            setCodeDrafts((current) => ({ ...current, [item.id]: code }))
            setFormatStates((current) => ({ ...current, [item.id]: 'idle' }))
            updateLocal(item.id, { code, status: code.trim() ? 'answered' : 'unanswered' })
            scheduleCodeSave(item.id, code)
            scheduleSyntaxCheck(item, code)
          }}
          onSave={(code) => void handleEditorBlur(item, code)}
          onSyntaxCheck={() => scheduleSyntaxCheck(item, codeDraftsRef.current[item.id] ?? codeDrafts[item.id] ?? item.answer.code ?? item.question.programming?.starter_code ?? '', { immediate: true, force: true })}
          onFormat={() => void formatAndSave(item, codeDraftsRef.current[item.id] ?? codeDrafts[item.id] ?? item.answer.code ?? item.question.programming?.starter_code ?? '')}
          onRun={() => void runSamples(item)}
        />}
        {complete && <ResultPanel item={item} />}
        <footer className="exercise-question-footer"><button className="ghost" disabled={index === 0} onClick={() => void goToIndex(index - 1)}><ChevronLeft />上一题</button>{index < session.items.length - 1 ? <button className="primary" onClick={() => void goToIndex(index + 1)}>下一题<ChevronRight /></button> : editable && <button className="primary" disabled={submitting} onClick={() => void submit()}><Send />提交整套练习</button>}</footer>
      </main></div>
    {editable && index < session.items.length - 1 && <div className="exercise-submit-row"><span>{unanswered ? `还有 ${unanswered} 题未答` : '全部题目均已作答'}</span><button className="primary" disabled={submitting} onClick={() => void submit()}><Send />提交整套练习</button></div>}
  </div>
}

function FillBlankStem({ item, complete, disabled, onChange }: { item: ExerciseSessionItem; complete: boolean; disabled: boolean; onChange: (answers: string[]) => void }) {
  const answers = [...(item.answer.blank_answers || [])]
  while (answers.length < (item.question.blanks || []).length) answers.push('')
  const parts = item.question.stem_markdown.split(/(\{\{\d+\}\})/g)
  return <div className="fill-blank-answer">{parts.map((part, index) => {
    const marker = part.match(/^\{\{(\d+)\}\}$/)
    if (!marker) return <span key={index}>{inlineMarkdown(part, `fill-${item.id}-${index}`)}</span>
    const position = Number(marker[1])
    const isCorrect = item.answer.details?.blank_correct?.[position - 1]
    return <input
      key={index}
      aria-label={`第 ${position} 空`}
      className={complete ? (isCorrect ? 'correct' : 'incorrect') : ''}
      value={answers[position - 1] || ''}
      disabled={disabled}
      onChange={(event) => { const next = [...answers]; next[position - 1] = event.target.value; onChange(next) }}
    />
  })}</div>
}

function ProgrammingAnswer({ sessionId, item, complete, sessionStatus, code, sampleResult, syntaxCheck, formatStatus, autoCompletionEnabled, autoSyntaxEnabled, autoFormatEnabled, onAutoCompletionChange, onAutoSyntaxChange, onAutoFormatChange, onCodeChange, onSave, onSyntaxCheck, onFormat, onRun }: {
  sessionId: number
  item: ExerciseSessionItem
  complete: boolean
  sessionStatus: string
  code: string
  sampleResult?: SampleResult
  syntaxCheck: SyntaxCheckState
  formatStatus: PythonFormatStatus
  autoCompletionEnabled: boolean
  autoSyntaxEnabled: boolean
  autoFormatEnabled: boolean
  onAutoCompletionChange: (enabled: boolean) => void
  onAutoSyntaxChange: (enabled: boolean) => void
  onAutoFormatChange: (enabled: boolean) => void
  onCodeChange: (code: string) => void
  onSave: (code: string) => void
  onSyntaxCheck: () => void
  onFormat: () => void
  onRun: () => void
}) {
  const program = item.question.programming!
  const samples = program.cases.filter((sample) => sample.is_sample && (sample.input_data.trim() || sample.expected_output.trim()))
  const editable = !complete && sessionStatus === 'in_progress'
  return <div className="programming-answer"><div className="program-spec-grid"><section><h3>输入格式</h3><MarkdownText value={program.input_markdown} /></section><section><h3>输出格式</h3><MarkdownText value={program.output_markdown} /></section></div>{program.constraints_markdown && <section><h3>数据范围</h3><MarkdownText value={program.constraints_markdown} /></section>}<div className="program-spec-grid program-limit-grid" aria-label="运行限制"><section><h3>时间限制</h3><p className="program-limit-value"><b>{program.time_limit_ms}</b><span>ms</span></p></section><section><h3>内存限制</h3><p className="program-limit-value"><b>{program.memory_limit_mb}</b><span>MB</span></p></section></div>{samples.length > 0 ? <section className="public-samples"><h3>公开样例</h3>{samples.map((sample, index) => <article className="public-sample" key={sample.id ?? index}><strong>样例 {index + 1}</strong><div className="public-sample-sections"><section><h4>标准输入</h4><pre>{sample.input_data || '（无输入）'}</pre></section><section><h4>期望输出</h4><pre>{sample.expected_output || '（无输出）'}</pre></section>{sample.explanation_markdown?.trim() && <section className="public-sample-explanation"><h4>样例解释</h4><MarkdownText value={sample.explanation_markdown} /></section>}</div></article>)}</section> : <p className="notice">该题未配置有效的公开样例，请联系管理员补充。</p>}<section className="python-answer-editor"><h3>Python 3.13 代码</h3><Suspense fallback={<div className="python-editor-loading">正在加载代码编辑器…</div>}><PythonCodeEditor
    value={code}
    disabled={!editable}
    diagnostics={syntaxCheck.diagnostics}
    sessionId={sessionId}
    sessionItemId={item.id}
    onChange={onCodeChange}
    onBlur={onSave}
    onRun={editable ? onRun : undefined}
    runDisabled={!code.trim() || !samples.length || sampleResult?.status === 'queued'}
    runDisabledReason={!code.trim() ? '请先输入代码' : !samples.length ? '该题没有可运行的公开样例' : sampleResult?.status === 'queued' ? '公开样例正在运行' : undefined}
    runLabel={sampleResult?.status === 'queued' ? '运行中…' : '运行样例'}
    runLoading={sampleResult?.status === 'queued'}
    autoCompletionEnabled={autoCompletionEnabled}
    onAutoCompletionChange={editable ? onAutoCompletionChange : undefined}
    autoSyntaxEnabled={autoSyntaxEnabled}
    onAutoSyntaxChange={editable ? onAutoSyntaxChange : undefined}
    onSyntaxCheck={editable ? onSyntaxCheck : undefined}
    syntaxCheckDisabled={!code.trim() || syntaxCheck.status === 'checking'}
    syntaxStatus={syntaxCheck.status}
    autoFormatEnabled={autoFormatEnabled}
    onAutoFormatChange={editable ? onAutoFormatChange : undefined}
    onFormat={editable ? onFormat : undefined}
    formatDisabled={!code.trim()}
    formatStatus={formatStatus}
  /></Suspense>{editable && (autoSyntaxEnabled || syntaxCheck.status !== 'idle') && <SyntaxCheckStatus state={syntaxCheck} />}</section><SampleResults result={sampleResult} /></div>
}

function SyntaxCheckStatus({ state }: { state: SyntaxCheckState }) {
  const diagnostic = state.diagnostics[0]
  if (state.status === 'checking') return <div className="python-syntax-status checking" role="status" aria-live="polite"><LoaderCircle />正在检查语法…</div>
  if (state.status === 'valid') return <div className="python-syntax-status valid" role="status" aria-live="polite"><CheckCircle2 />未发现语法错误</div>
  if (state.status === 'invalid' && diagnostic) return <div className="python-syntax-status invalid" role="status" aria-live="polite"><AlertCircle /><div><strong>第 {diagnostic.line} 行，第 {diagnostic.column} 列：{diagnostic.message}</strong><small>Python：{diagnostic.python_message}</small></div></div>
  if (state.status === 'unavailable') return <div className="python-syntax-status unavailable" role="status" aria-live="polite"><WifiOff />语法检查暂时不可用，可继续保存或运行样例</div>
  return <div className="python-syntax-status idle" role="status"><Code2 />输入代码后自动检查语法</div>
}

export { MarkdownText }
function questionTypeLabel(type: string) { return ({ single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题', fill_blank: '填空题', programming: '编程题' } as Record<string, string>)[type] ?? type }

function SampleResults({ result }: { result?: SampleResult }) {
  if (!result || result.status === 'queued') return null
  const indentationError = result.cases?.some((item) => /IndentationError|TabError/.test(item.stderr || ''))
  const eofError = result.cases?.some((item) => /EOFError:\s*EOF when reading a line/.test(item.stderr || ''))
  return <div className="sample-results"><h3>样例运行结果</h3>{indentationError && <p className="code-hint">Python 的 for、if、while 或 def 语句后的代码需要缩进。可以在编辑器中按 Tab 添加 4 个空格。</p>}{eofError && <p className="code-hint">程序读取的数据比公开样例提供的更多。请先对照上方“标准输入”调整 input() 次数；如果样例本身不完整，请联系管理员修正。</p>}{result.cases?.map((item, index) => <div className={item.status === 'AC' ? 'passed' : 'failed'} key={item.id ?? index}><strong>样例 {index + 1} · {item.status}</strong><span>{item.duration_ms} ms</span>{item.stdout !== undefined && <pre>{item.stdout || '（无输出）'}</pre>}{item.stderr && <pre className="stderr">{item.stderr}</pre>}</div>)}</div>
}

function ResultPanel({ item }: { item: ExerciseSessionItem }) {
  const full = item.answer.awarded_points === item.points
  return <section className={`exercise-result-panel ${full ? 'correct' : 'incorrect'}`}><header>{full ? <CheckCircle2 /> : <XCircle />}<strong>{full ? '回答正确' : '需要再想一想'}</strong><span>{item.answer.awarded_points ?? 0} / {item.points} 分</span></header>{item.question.type === 'true_false' && <p>正确答案：{item.question.correct_bool ? '正确' : '错误'}</p>}{item.question.type === 'fill_blank' && <ol>{(item.question.blanks || []).map((blank) => <li key={blank.position}>第 {blank.position} 空：{blank.accepted_answers?.join(' / ')}</li>)}</ol>}{item.question.type === 'programming' && <><p>隐藏测试点：通过 {item.answer.details?.passed ?? 0} / {item.answer.details?.total ?? 0}，状态 {item.answer.status}</p>{item.answer.status === 'Syntax Error' && <p className="code-hint">请检查括号、冒号和缩进；for、if、while 或 def 后的代码块必须缩进。</p>}</>}{item.question.explanation_markdown && <><h3>答案解析</h3><MarkdownText value={item.question.explanation_markdown} /></>}{item.question.programming?.reference_solution && <><h3>参考程序</h3><pre className="reference-code">{item.question.programming.reference_solution}</pre></>}</section>
}
