import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Eye, EyeOff, Pause, Play, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, jsonBody } from '../api'
import { calculateStats, errorsToList, keyToCharacter, shuffleBag } from '../typing'
import type { AttemptResult } from '../types'
import { FingerGuide } from './FingerGuide'
import { VirtualKeyboard } from './VirtualKeyboard'

export type PracticeRunnerItem = { id: number; content: string }
type RunState = 'ready' | 'running' | 'paused' | 'saving' | 'transitioning' | 'complete'
const ITEM_TRANSITION_DELAY_MS = 500
const ROUND_TRANSITION_DELAY_MS = 5000

export function PracticeRunner<T extends PracticeRunnerItem>({
  contextLabel,
  title,
  backLabel,
  items,
  savePath,
  saveIdKey,
  renderInfo,
}: {
  contextLabel: string
  title: string
  backLabel: string
  items: T[]
  savePath: string
  saveIdKey: string
  renderInfo?: (item: T) => ReactNode
}) {
  const [bag, setBag] = useState<T[]>(() => shuffleBag(items))
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
  const roundCharsRef = useRef(0)
  const roundErrorsRef = useRef(0)
  const roundDurationRef = useRef(0)
  const current = bag[bagIndex]
  const totalErrors = useMemo(() => [...errors.values()].reduce((sum, count) => sum + count, 0), [errors])
  const liveStats = calculateStats(charIndex, totalErrors, elapsed)

  useEffect(() => {
    setTimeout(() => surfaceRef.current?.focus(), 0)
    return () => { if (nextTimerRef.current) window.clearTimeout(nextTimerRef.current) }
  }, [])

  useEffect(() => {
    if (runState !== 'running' || startRef.current === null) return
    const interval = window.setInterval(() => setElapsed(performance.now() - (startRef.current ?? performance.now()) - pausedTotalRef.current), 200)
    return () => window.clearInterval(interval)
  }, [runState])

  const resetPrompt = useCallback(() => {
    if (nextTimerRef.current) window.clearTimeout(nextTimerRef.current)
    setCharIndex(0); setErrors(new Map()); setElapsed(0); setResult(null); setMessage(''); setRunState('ready')
    startRef.current = null; pauseRef.current = null; pausedTotalRef.current = 0
    setTimeout(() => surfaceRef.current?.focus(), 0)
  }, [])

  const advancePrompt = useCallback(() => {
    if (!current) return
    if (bagIndex + 1 < bag.length) setBagIndex((value) => value + 1)
    else {
      const nextBag = shuffleBag(items)
      if (nextBag.length > 1 && nextBag[0].id === current.id) [nextBag[0], nextBag[1]] = [nextBag[1], nextBag[0]]
      roundCharsRef.current = 0; roundErrorsRef.current = 0; roundDurationRef.current = 0
      setBag(nextBag); setBagIndex(0)
    }
    resetPrompt()
  }, [bag.length, bagIndex, current, items, resetPrompt])

  const finish = useCallback(async (duration: number, currentErrors: Map<string, number>) => {
    if (!current) return
    setRunState('saving')
    try {
      const saved = await api<AttemptResult>(savePath, {
        method: 'POST',
        ...jsonBody({ [saveIdKey]: current.id, duration_ms: Math.max(100, Math.round(duration)), errors: errorsToList(currentErrors) }),
      })
      const nextChars = roundCharsRef.current + current.content.length
      const nextErrors = roundErrorsRef.current + saved.errors
      const nextDuration = roundDurationRef.current + saved.duration_ms
      roundCharsRef.current = nextChars; roundErrorsRef.current = nextErrors; roundDurationRef.current = nextDuration
      if (bagIndex + 1 === bag.length) {
        const roundStats = calculateStats(nextChars, nextErrors, nextDuration)
        setResult({ ...saved, ...roundStats, errors: nextErrors, duration_ms: nextDuration }); setRunState('complete')
        nextTimerRef.current = window.setTimeout(advancePrompt, ROUND_TRANSITION_DELAY_MS)
      } else {
        setRunState('transitioning')
        nextTimerRef.current = window.setTimeout(advancePrompt, ITEM_TRANSITION_DELAY_MS)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '成绩保存失败'); setRunState('complete')
    }
  }, [advancePrompt, bag.length, bagIndex, current, saveIdKey, savePath])

  const togglePause = () => {
    const now = performance.now()
    if (runState === 'running') { pauseRef.current = now; setRunState('paused') }
    else if (runState === 'paused') {
      pausedTotalRef.current += now - (pauseRef.current ?? now); pauseRef.current = null; setRunState('running')
      setTimeout(() => surfaceRef.current?.focus(), 0)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!current) return
    if (event.key === 'Escape') { event.preventDefault(); togglePause(); return }
    if (runState === 'paused' || runState === 'saving' || runState === 'transitioning' || runState === 'complete') return
    const expected = current.content[charIndex]
    const actual = keyToCharacter(event, expected)
    if (actual === null) return
    event.preventDefault()
    const now = performance.now()
    if (startRef.current === null) { startRef.current = now; setRunState('running') }
    const duration = now - (startRef.current ?? now) - pausedTotalRef.current
    setElapsed(duration)
    if (actual === expected) {
      const nextIndex = charIndex + 1
      setCharIndex(nextIndex)
      if (nextIndex === current.content.length) void finish(duration, errors)
    } else {
      const nextErrors = new Map(errors); const key = `${expected}\u0000${actual}`
      nextErrors.set(key, (nextErrors.get(key) ?? 0) + 1); setErrors(nextErrors); setFlash(true)
      window.setTimeout(() => setFlash(false), 220)
    }
  }

  useEffect(() => {
    if (runState !== 'ready' || !current) return
    const captureFirstKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof Node && surfaceRef.current?.contains(event.target))) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('button, a, input, select, textarea, [contenteditable="true"]')) return
      if (keyToCharacter(event, current.content[charIndex]) === null) return
      onKeyDown(event); surfaceRef.current?.focus()
    }
    window.addEventListener('keydown', captureFirstKey)
    return () => window.removeEventListener('keydown', captureFirstKey)
  }, [charIndex, current, errors, runState])

  if (!current) return <div className="page"><p className="notice error">暂无可练习内容</p></div>
  const expected = current.content[charIndex] ?? ''
  const showHints = hints && runState !== 'complete'
  return <div className="practice-page">
    <header className="practice-header">
      <Link to="/" className="back-link"><ArrowLeft /> {backLabel}</Link>
      <div><span>{contextLabel}</span><strong>{title}</strong></div>
      <div className="practice-actions">
        <button onClick={() => setHints((value) => !value)} className="ghost">{hints ? <EyeOff /> : <Eye />} {hints ? '隐藏提示' : '显示提示'}</button>
        <button onClick={togglePause} className="ghost" disabled={runState === 'ready' || runState === 'complete' || runState === 'saving' || runState === 'transitioning'}>{runState === 'paused' ? <Play /> : <Pause />} {runState === 'paused' ? '继续' : '暂停'}</button>
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
        <div className={renderInfo ? 'word-practice-content' : ''}>
          <div ref={surfaceRef} className={`typing-surface ${flash ? 'wrong' : ''} ${runState === 'paused' ? 'paused' : ''}`} tabIndex={0} onKeyDown={(event) => onKeyDown(event.nativeEvent)} aria-label="打字练习区域">
            <pre className="prompt-text"><span className="typed">{current.content.slice(0, charIndex)}</span>{expected && <span className="current-char">{expected}</span>}<span>{current.content.slice(charIndex + 1)}</span></pre>
            {runState === 'ready' && <div className="surface-message">直接按第一个字符开始计时</div>}
            {runState === 'paused' && <div className="surface-message"><Pause /> 已暂停，按 Esc 或点击“继续”</div>}
            {runState === 'saving' && <div className="surface-message">正在保存成绩…</div>}
            {runState === 'transitioning' && <div className="surface-message">本条完成，准备下一条…</div>}
            {runState === 'complete' && result && <div className="result-pop"><strong>本轮完成！</strong><span>{result.cpm} CPM · {result.accuracy}% 准确率</span><small>5 秒后自动进入下一轮</small><button onClick={advancePrompt}>下一轮</button></div>}
          </div>
          {renderInfo && renderInfo(current)}
        </div>
      </div>
      {showHints && <FingerGuide expected={expected} />}
    </div>
    {message && <p className="notice error">{message}</p>}
    <div className="bag-progress"><span>本轮进度 {bagIndex + 1} / {bag.length}</span><div><i style={{ width: `${((bagIndex + 1) / bag.length) * 100}%` }} /></div></div>
    <VirtualKeyboard expected={expected} visible={showHints} />
    <p className="keyboard-tip">提示：按 Esc 可暂停。错误按键不会前进，找到正确键后继续。</p>
  </div>
}
