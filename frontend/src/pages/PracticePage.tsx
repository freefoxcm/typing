import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Eye, EyeOff, Pause, Play, RotateCcw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api, jsonBody } from '../api'
import { FingerGuide } from '../components/FingerGuide'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { calculateStats, errorsToList, keyToCharacter, shuffleBag } from '../typing'
import type { AttemptResult, LessonDetail, Prompt } from '../types'

type RunState = 'ready' | 'running' | 'paused' | 'saving' | 'complete'

export function PracticePage() {
  const { lessonId } = useParams()
  const [lesson, setLesson] = useState<LessonDetail | null>(null)
  const [bag, setBag] = useState<Prompt[]>([])
  const [bagIndex, setBagIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)
  const [errors, setErrors] = useState<Map<string, number>>(new Map())
  const [runState, setRunState] = useState<RunState>('ready')
  const [elapsed, setElapsed] = useState(0)
  const [flash, setFlash] = useState(false)
  const [hints, setHints] = useState(true)
  const [result, setResult] = useState<AttemptResult | null>(null)
  const [message, setMessage] = useState('')
  const surfaceRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<number | null>(null)
  const pauseRef = useRef<number | null>(null)
  const pausedTotalRef = useRef(0)
  const nextTimerRef = useRef<number | null>(null)
  const current = bag[bagIndex]
  const totalErrors = useMemo(() => [...errors.values()].reduce((sum, count) => sum + count, 0), [errors])
  const liveStats = calculateStats(charIndex, totalErrors, elapsed)

  useEffect(() => {
    api<LessonDetail>(`/api/library/lessons/${lessonId}`).then((data) => {
      setLesson(data)
      setBag(shuffleBag(data.prompts))
      setTimeout(() => surfaceRef.current?.focus(), 0)
    }).catch((e) => setMessage(e.message))
    return () => { if (nextTimerRef.current) window.clearTimeout(nextTimerRef.current) }
  }, [lessonId])

  useEffect(() => {
    if (runState !== 'running' || startRef.current === null) return
    const interval = window.setInterval(() => setElapsed(performance.now() - (startRef.current ?? performance.now()) - pausedTotalRef.current), 200)
    return () => window.clearInterval(interval)
  }, [runState])

  const resetPrompt = useCallback(() => {
    if (nextTimerRef.current) window.clearTimeout(nextTimerRef.current)
    setCharIndex(0)
    setErrors(new Map())
    setElapsed(0)
    setResult(null)
    setMessage('')
    setRunState('ready')
    startRef.current = null
    pauseRef.current = null
    pausedTotalRef.current = 0
    setTimeout(() => surfaceRef.current?.focus(), 0)
  }, [])

  const advancePrompt = useCallback(() => {
    if (!lesson || !current) return
    if (bagIndex + 1 < bag.length) {
      setBagIndex((value) => value + 1)
    } else {
      const nextBag = shuffleBag(lesson.prompts)
      if (nextBag.length > 1 && nextBag[0].id === current.id) [nextBag[0], nextBag[1]] = [nextBag[1], nextBag[0]]
      setBag(nextBag)
      setBagIndex(0)
    }
    resetPrompt()
  }, [bag.length, bagIndex, current, lesson, resetPrompt])

  const finish = useCallback(async (duration: number, currentErrors: Map<string, number>) => {
    if (!current) return
    setRunState('saving')
    try {
      const saved = await api<AttemptResult>('/api/practice/attempts', {
        method: 'POST',
        ...jsonBody({ prompt_id: current.id, duration_ms: Math.max(100, Math.round(duration)), errors: errorsToList(currentErrors) }),
      })
      setResult(saved)
      setRunState('complete')
      nextTimerRef.current = window.setTimeout(advancePrompt, 1600)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '成绩保存失败')
      setRunState('complete')
    }
  }, [advancePrompt, current])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!current) return
    if (event.key === 'Escape') {
      event.preventDefault()
      togglePause()
      return
    }
    if (runState === 'paused' || runState === 'saving' || runState === 'complete') return
    const expected = current.content[charIndex]
    const actual = keyToCharacter(event.nativeEvent, expected)
    if (actual === null) return
    event.preventDefault()
    const now = performance.now()
    if (startRef.current === null) {
      startRef.current = now
      setRunState('running')
    }
    const duration = now - (startRef.current ?? now) - pausedTotalRef.current
    setElapsed(duration)
    if (actual === expected) {
      const nextIndex = charIndex + 1
      setCharIndex(nextIndex)
      if (nextIndex === current.content.length) void finish(duration, errors)
    } else {
      const nextErrors = new Map(errors)
      const key = `${expected}\u0000${actual}`
      nextErrors.set(key, (nextErrors.get(key) ?? 0) + 1)
      setErrors(nextErrors)
      setFlash(true)
      window.setTimeout(() => setFlash(false), 220)
    }
  }

  const togglePause = () => {
    const now = performance.now()
    if (runState === 'running') {
      pauseRef.current = now
      setRunState('paused')
    } else if (runState === 'paused') {
      pausedTotalRef.current += now - (pauseRef.current ?? now)
      pauseRef.current = null
      setRunState('running')
      setTimeout(() => surfaceRef.current?.focus(), 0)
    }
  }

  if (!lesson || !current) return <div className="page"><p className={message ? 'notice error' : 'notice'}>{message || '正在准备练习…'}</p></div>
  const expected = current.content[charIndex] ?? ''
  const showHints = hints && runState !== 'complete'
  return (
    <div className="practice-page">
      <header className="practice-header">
        <Link to="/" className="back-link"><ArrowLeft /> 返回课程</Link>
        <div><span>{lesson.course.title}</span><strong>{lesson.title}</strong></div>
        <div className="practice-actions">
          <button onClick={() => setHints((value) => !value)} className="ghost">{hints ? <EyeOff /> : <Eye />} {hints ? '隐藏提示' : '显示提示'}</button>
          <button onClick={togglePause} className="ghost" disabled={runState === 'ready' || runState === 'complete' || runState === 'saving'}>{runState === 'paused' ? <Play /> : <Pause />} {runState === 'paused' ? '继续' : '暂停'}</button>
          <button onClick={resetPrompt} className="ghost"><RotateCcw /> 重练</button>
        </div>
      </header>
      <div className={`practice-stage ${showHints ? 'with-finger-guide' : ''}`}>
        <div className="practice-main">
          <div className="metric-strip">
            <div><span>速度</span><strong>{liveStats.cpm}</strong><small>字符/分钟</small></div>
            <div><span>准确率</span><strong>{liveStats.accuracy.toFixed(1)}%</strong></div>
            <div><span>错误</span><strong className={totalErrors ? 'danger' : ''}>{totalErrors}</strong><small>次</small></div>
            <div><span>时间</span><strong>{(elapsed / 1000).toFixed(1)}</strong><small>秒</small></div>
          </div>
          <div
            ref={surfaceRef}
            className={`typing-surface ${flash ? 'wrong' : ''} ${runState === 'paused' ? 'paused' : ''}`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-label="打字练习区域"
          >
            <pre className="prompt-text"><span className="typed">{current.content.slice(0, charIndex)}</span>{expected && <span className="current-char">{expected}</span>}<span>{current.content.slice(charIndex + 1)}</span></pre>
            {runState === 'ready' && <div className="surface-message">点击这里，然后开始打字</div>}
            {runState === 'paused' && <div className="surface-message"><Pause /> 已暂停，按 Esc 或点击“继续”</div>}
            {runState === 'saving' && <div className="surface-message">正在保存成绩…</div>}
            {runState === 'complete' && result && <div className="result-pop"><strong>完成得很棒！</strong><span>{result.cpm} CPM · {result.accuracy}% 准确率</span><button onClick={advancePrompt}>下一条</button></div>}
          </div>
        </div>
        {showHints && <FingerGuide expected={expected} />}
      </div>
      {message && <p className="notice error">{message}</p>}
      <div className="bag-progress"><span>本轮进度 {bagIndex + 1} / {bag.length}</span><div><i style={{ width: `${((bagIndex + 1) / bag.length) * 100}%` }} /></div></div>
      <VirtualKeyboard expected={expected} visible={showHints} />
      <p className="keyboard-tip">提示：按 Esc 可暂停。错误按键不会前进，找到正确键后继续。</p>
    </div>
  )
}
