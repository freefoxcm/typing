import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, BookOpen, Download, FileQuestion, Languages, Trash2, X } from 'lucide-react'
import { api, jsonBody } from '../api'
import { errorLabel } from '../typing'
import type { Child, ExerciseAdminReport, Report, ReportOverview, ReportOverviewRow } from '../types'

type DetailTab = 'course' | 'word' | 'exercise'
const detailTabs: { id: DetailTab; label: string; icon: typeof BookOpen }[] = [
  { id: 'course', label: '打字练习', icon: BookOpen },
  { id: 'word', label: '单词练习', icon: Languages },
  { id: 'exercise', label: '习题练习', icon: FileQuestion },
]
const emptyReport: Report = { attempt_count: 0, practice_minutes: 0, average_cpm: 0, accuracy: 0, weak_keys: [], attempts: [] }
const emptyExercise: ExerciseAdminReport = {
  session_count: 0, total_session_count: 0, status_counts: { in_progress: 0, judging: 0, completed: 0, abandoned: 0 },
  completion_rate: 0, average_percent: 0, unresolved_wrong_count: 0, recent: [],
}

export function AdminReportsPanel({ children }: { children: Child[] }) {
  const [days, setDays] = useState('30')
  const [overview, setOverview] = useState<ReportOverview | null>(null)
  const [childId, setChildId] = useState('')
  const [detailTab, setDetailTab] = useState<DetailTab>('course')
  const [report, setReport] = useState<Report>(emptyReport)
  const [exerciseReport, setExerciseReport] = useState<ExerciseAdminReport>(emptyExercise)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [resetName, setResetName] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetting, setResetting] = useState(false)
  const resetTriggerRef = useRef<HTMLButtonElement>(null)
  const resetInputRef = useRef<HTMLInputElement>(null)

  const loadOverview = useCallback(async () => {
    setLoading(true); setError('')
    try { setOverview(await api<ReportOverview>(`/api/admin/reports/overview?days=${days}`)) }
    catch (e) { setError(e instanceof Error ? e.message : '报告加载失败') }
    finally { setLoading(false) }
  }, [days])

  useEffect(() => { void loadOverview() }, [loadOverview])
  useEffect(() => {
    if (!childId) return
    setLoading(true); setError('')
    const request = detailTab === 'exercise'
      ? api<ExerciseAdminReport>(`/api/admin/exercise-reports/summary?days=${days}&child_id=${childId}`).then(setExerciseReport)
      : api<Report>(`/api/admin/reports/summary?days=${days}&mode=${detailTab}&child_id=${childId}`).then(setReport)
    void request.catch((e) => setError(e instanceof Error ? e.message : '报告加载失败')).finally(() => setLoading(false))
  }, [childId, days, detailTab])

  const selected = useMemo(() => (overview?.students ?? []).find((item) => String(item.child_id) === childId), [childId, overview])
  const exportQuery = childId ? `view=${detailTab}&child_id=${childId}&days=${days}` : `view=overview&days=${days}`
  const selectTab = (tab: DetailTab, focus = false) => {
    setDetailTab(tab)
    if (focus) window.setTimeout(() => document.getElementById(`report-tab-${tab}`)?.focus(), 0)
  }
  const handleTabKey = (event: React.KeyboardEvent, current: DetailTab) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = detailTabs.findIndex((item) => item.id === current)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? detailTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + detailTabs.length) % detailTabs.length
    selectTab(detailTabs[next].id, true)
  }
  const closeReset = () => {
    if (resetting) return
    setResetOpen(false); setResetName(''); setResetError('')
    window.setTimeout(() => resetTriggerRef.current?.focus())
  }
  const openReset = () => {
    setMessage(''); setError(''); setResetName(''); setResetError(''); setResetOpen(true)
  }
  useEffect(() => {
    if (!resetOpen) return
    resetInputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !resetting) closeReset()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [resetOpen, resetting])
  useEffect(() => {
    setResetOpen(false); setResetName(''); setResetError('')
  }, [childId])
  const resetLearningData = async () => {
    if (!selected || resetName.trim() !== selected.child_name) return
    setResetting(true); setResetError(''); setMessage('')
    try {
      await api(`/api/admin/children/${selected.child_id}/reset-learning-data`, { method: 'POST', ...jsonBody({ confirm_name: resetName.trim() }) })
      const [overviewData, detailData] = await Promise.all([
        api<ReportOverview>(`/api/admin/reports/overview?days=${days}`),
        detailTab === 'exercise'
          ? api<ExerciseAdminReport>(`/api/admin/exercise-reports/summary?days=${days}&child_id=${selected.child_id}`)
          : api<Report>(`/api/admin/reports/summary?days=${days}&mode=${detailTab}&child_id=${selected.child_id}`),
      ])
      setOverview(overviewData)
      if (detailTab === 'exercise') setExerciseReport(detailData as ExerciseAdminReport)
      else setReport(detailData as Report)
      setResetOpen(false); setResetName('')
      setMessage(`${selected.child_name} 的学习数据已重置`)
      window.setTimeout(() => resetTriggerRef.current?.focus())
    } catch (e) { setResetError(e instanceof Error ? e.message : '学习数据重置失败') }
    finally { setResetting(false) }
  }

  return <>
    <header className="section-title"><div><p className="eyebrow">学习报告</p><h2>{selected ? `${selected.child_name} 的学习详情` : '每位学生的学习进展'}</h2><p>{selected ? '分别查看打字、单词与习题表现。' : '先总览所有学生，再进入个人详情。'}</p></div><div className="report-header-actions">{selected && <button ref={resetTriggerRef} className="danger-button report-reset-trigger" onClick={openReset}><Trash2 />重置学习数据</button>}<a className="ghost link-button" href={`/api/admin/reports/export.csv?${exportQuery}`}><Download />导出当前视图</a></div></header>
    {message && <p className="notice success">{message}</p>}
    {error && <p className="notice error">{error}</p>}
    <div className="report-filters card">
      {childId && <button className="ghost report-back" onClick={() => setChildId('')}><ArrowLeft />学生总览</button>}
      {childId && <label>学生<select value={childId} onChange={(e) => setChildId(e.target.value)}>{children.map((child) => <option value={child.id} key={child.id}>{child.name}</option>)}</select></label>}
      <label>时间范围<select value={days} onChange={(e) => setDays(e.target.value)}><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="365">最近一年</option></select></label>
      {loading && <span className="report-loading" role="status">正在更新…</span>}
    </div>
    {!childId && <StudentOverview rows={overview?.students ?? []} onSelect={(id) => setChildId(String(id))} />}
    {childId && <>
      <div className="report-detail-tabs" role="tablist" aria-label="学习报告类型">{detailTabs.map(({ id, label, icon: Icon }) => <button id={`report-tab-${id}`} role="tab" aria-selected={detailTab === id} tabIndex={detailTab === id ? 0 : -1} key={id} onClick={() => selectTab(id)} onKeyDown={(event) => handleTabKey(event, id)}><Icon />{label}</button>)}</div>
      {detailTab === 'exercise' ? <ExerciseDetail report={exerciseReport} /> : <TypingDetail report={report} mode={detailTab} />}
    </>}
    {resetOpen && selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReset() }}><div className="report-reset-modal card" role="dialog" aria-modal="true" aria-labelledby="report-reset-title" aria-describedby="report-reset-warning"><header><div className="report-reset-title"><span><AlertTriangle /></span><div><p className="eyebrow">不可恢复的操作</p><h2 id="report-reset-title">重置学习数据</h2></div></div><button className="ghost" aria-label="关闭重置学习数据警告" disabled={resetting} onClick={closeReset}><X /></button></header><p className="report-reset-warning" id="report-reset-warning"><strong>警告：即将永久清空「{selected.child_name}」的全部学习数据，此操作不可恢复。</strong></p><ul><li>永久删除全部打字、单词和习题练习记录</li><li>终止进行中和判题中的习题练习</li><li>清空已掌握与未掌握的错题记录</li><li>学生账号、PIN 和公共题库不会受到影响</li></ul><p className="muted">如需留档，请先取消并分别导出相关报告。</p><label className="report-reset-confirm">请输入学生姓名 <strong>{selected.child_name}</strong> 以确认<input ref={resetInputRef} value={resetName} disabled={resetting} autoComplete="off" onChange={(event) => setResetName(event.target.value)} /></label>{resetError && <p className="notice error" role="alert">{resetError}</p>}<div className="button-row"><button className="ghost" disabled={resetting} onClick={closeReset}>取消</button><button className="danger-button report-reset-confirm-button" disabled={resetting || resetName.trim() !== selected.child_name} onClick={() => void resetLearningData()}><Trash2 />{resetting ? '正在重置…' : '确认永久重置'}</button></div></div></div>}
  </>
}

function StudentOverview({ rows, onSelect }: { rows: ReportOverviewRow[]; onSelect: (id: number) => void }) {
  if (!rows.length) return <div className="card report-empty"><strong>暂无学生档案</strong><p>创建学生后，学习数据会显示在这里。</p></div>
  return <div className="student-report-list"><div className="student-report-head"><span>学生</span><span>打字 / 单词</span><span>速度 / 准确率</span><span>习题完成</span><span>平均成绩</span><span>未掌握错题</span></div>{rows.map((row) => <button className="student-report-row" onClick={() => onSelect(row.child_id)} key={row.child_id}>
    <span><strong>{row.child_name}</strong><small>{row.active ? '正常使用' : '已停用'}</small></span>
    <span><strong>{row.course_attempt_count} / {row.word_attempt_count}</strong><small>{row.practice_minutes} 分钟</small></span>
    <span><strong>{row.average_cpm} CPM</strong><small>{row.accuracy}%</small></span>
    <span><strong>{row.exercise_completed} / {row.exercise_total}</strong><small>{row.exercise_completion_rate}%</small></span>
    <span><strong>{row.exercise_average_percent}%</strong><small>已完成练习</small></span>
    <span><strong>{row.unresolved_wrong_count}</strong><small>当前存量</small></span>
  </button>)}</div>
}

function TypingDetail({ report, mode }: { report: Report; mode: 'course' | 'word' }) {
  return <div role="tabpanel" aria-labelledby={`report-tab-${mode}`}><div className="report-metrics"><div><span>练习次数</span><strong>{report.attempt_count}</strong></div><div><span>练习分钟</span><strong>{report.practice_minutes}</strong></div><div><span>平均速度</span><strong>{report.average_cpm} <small>CPM</small></strong></div><div><span>整体准确率</span><strong>{report.accuracy}%</strong></div></div><div className="report-columns"><section className="card"><h3>薄弱按键</h3>{report.weak_keys.length ? report.weak_keys.map((item) => <div className="weak-row" key={item.char}><kbd>{errorLabel(item.char)}</kbd><div><i style={{ width: `${Math.max(8, item.count / report.weak_keys[0].count * 100)}%` }} /></div><span>{item.count} 次</span></div>) : <p className="muted">还没有错误记录，继续保持！</p>}</section><section className="card"><h3>最近练习</h3>{report.attempts.length ? <div className="attempt-table">{report.attempts.slice(0, 12).map((item) => <div key={item.id}><time>{new Date(item.created_at).toLocaleDateString()}</time><strong>{item.cpm} CPM</strong><span>{item.accuracy}%</span><span>{item.errors} 错</span></div>)}</div> : <p className="muted">该时间范围内暂无练习。</p>}</section></div></div>
}

function ExerciseDetail({ report }: { report: ExerciseAdminReport }) {
  const statusLabel: Record<string, string> = { in_progress: '进行中', judging: '判题中', completed: '已完成', abandoned: '已放弃' }
  return <div role="tabpanel" aria-labelledby="report-tab-exercise"><div className="report-metrics"><div><span>已完成练习</span><strong>{report.session_count}</strong></div><div><span>完成率</span><strong>{report.completion_rate}%</strong></div><div><span>平均得分率</span><strong>{report.average_percent}%</strong></div><div><span>当前未掌握错题</span><strong>{report.unresolved_wrong_count}</strong></div></div><div className="report-columns exercise-report-columns"><section className="card"><h3>练习状态</h3><div className="exercise-status-list">{Object.entries(report.status_counts).map(([status, count]) => <div key={status}><span>{statusLabel[status] ?? status}</span><strong>{count}</strong></div>)}</div><p className="muted">完成率按已完成数 ÷ 全部已创建练习计算。</p></section><section className="card"><h3>最近习题练习</h3>{report.recent.length ? <div className="exercise-attempt-table">{report.recent.slice(0, 20).map((item) => <div key={item.id}><span><strong>{item.title}</strong><small>{new Date(item.created_at).toLocaleDateString()}</small></span><em className={`report-status ${item.status}`}>{statusLabel[item.status] ?? item.status}</em><span>{item.status === 'completed' ? `${item.score} / ${item.max_score}` : '—'}</span><time>{item.completed_at ? new Date(item.completed_at).toLocaleString('zh-CN', { hour12: false }) : '尚未完成'}</time></div>)}</div> : <p className="muted">该时间范围内暂无习题练习。</p>}</section></div></div>
}
