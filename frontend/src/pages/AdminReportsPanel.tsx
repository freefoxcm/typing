import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, BookOpen, Code2, Download, FileQuestion, Keyboard, Languages, Lightbulb, Trash2, Users, X } from 'lucide-react'
import { api, jsonBody } from '../api'
import type { AdminNotifier } from '../components/AdminToast'
import { MarkdownText } from '../components/MarkdownText'
import { useRefreshRecovery } from '../components/RefreshRecovery'
import { errorLabel } from '../typing'
import type { Child, ExerciseAdminReport, LearningAnalysis, LearningAnalysisIssue, LearningAnalysisProgrammingFailure, LearningAnalysisQuestionIssue, LearningAnalysisTypingIssue, LearningAnalysisWordIssue, Report, ReportOverview, ReportOverviewRow } from '../types'

type DetailTab = 'course' | 'word' | 'exercise'
type ReportView = 'global' | 'students'
type AnalysisTab = 'typing' | 'word' | 'exercise'
const detailTabs: { id: DetailTab; label: string; icon: typeof BookOpen }[] = [
  { id: 'course', label: '打字练习', icon: BookOpen },
  { id: 'word', label: '单词练习', icon: Languages },
  { id: 'exercise', label: '习题练习', icon: FileQuestion },
]
const emptyReport: Report = { attempt_count: 0, practice_minutes: 0, average_cpm: null, cpm_metric_version: null, cpm_attempt_count: 0, accuracy: 0, weak_keys: [], attempts: [] }
const emptyExercise: ExerciseAdminReport = {
  session_count: 0, total_session_count: 0, status_counts: { in_progress: 0, judging: 0, completed: 0, abandoned: 0 },
  completion_rate: 0, average_percent: 0, unresolved_wrong_count: 0, recent: [],
}
const ignoreNotification: AdminNotifier = () => {}
const emptyAnalysis: LearningAnalysis = {
  period: { days: 30, current_start: '', current_end: '', previous_start: '', previous_end: '' },
  summary: { participating_students: 0, typing_attempts: 0, word_attempts: 0, practice_attempts: 0, practice_minutes: 0, overall_accuracy: 0, completed_exercise_sessions: 0, exercise_question_attempts: 0, exercise_wrong_rate: 0 },
  insights: [], typing: { weak_keys: [], confusion_pairs: [] }, words: { difficult_words: [] },
  exercises: { difficult_questions: [], persistent_questions: [], programming_failures: [] },
}

export function AdminReportsPanel({ children, notify = ignoreNotification }: { children: Child[]; notify?: AdminNotifier }) {
  const [days, setDays] = useState('30')
  const [view, setView] = useState<ReportView>('global')
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('typing')
  const [analysis, setAnalysis] = useState<LearningAnalysis>(emptyAnalysis)
  const [overview, setOverview] = useState<ReportOverview | null>(null)
  const [childId, setChildId] = useState('')
  const [detailTab, setDetailTab] = useState<DetailTab>('course')
  const [report, setReport] = useState<Report>(emptyReport)
  const [exerciseReport, setExerciseReport] = useState<ExerciseAdminReport>(emptyExercise)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [resetName, setResetName] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetting, setResetting] = useState(false)
  const resetTriggerRef = useRef<HTMLButtonElement>(null)
  const resetInputRef = useRef<HTMLInputElement>(null)
  const resettingRef = useRef(false)
  const { refreshAfterSave, refreshNotice } = useRefreshRecovery()

  const loadOverview = useCallback(async () => {
    setLoading(true); setError('')
    try { setOverview(await api<ReportOverview>(`/api/admin/reports/overview?days=${days}`)) }
    catch (e) { setError(e instanceof Error ? e.message : '报告加载失败') }
    finally { setLoading(false) }
  }, [days])

  useEffect(() => { if (view === 'students') void loadOverview() }, [loadOverview, view])
  useEffect(() => {
    if (view !== 'global') return
    setLoading(true); setError('')
    void api<LearningAnalysis>(`/api/admin/learning-analysis?days=${days}`)
      .then(setAnalysis)
      .catch((e) => setError(e instanceof Error ? e.message : '学情分析加载失败'))
      .finally(() => setLoading(false))
  }, [days, view])
  useEffect(() => {
    if (view !== 'students' || !childId) return
    setLoading(true); setError('')
    const request = detailTab === 'exercise'
      ? api<ExerciseAdminReport>(`/api/admin/exercise-reports/summary?days=${days}&child_id=${childId}`).then(setExerciseReport)
      : api<Report>(`/api/admin/reports/summary?days=${days}&mode=${detailTab}&child_id=${childId}`).then(setReport)
    void request.catch((e) => setError(e instanceof Error ? e.message : '报告加载失败')).finally(() => setLoading(false))
  }, [childId, days, detailTab, view])

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
    setError(''); setResetName(''); setResetError(''); setResetOpen(true)
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
    if (resettingRef.current || !selected || resetName.trim() !== selected.child_name) return
    resettingRef.current = true
    setResetting(true); setResetError('')
    try {
      await api(`/api/admin/children/${selected.child_id}/reset-learning-data`, { method: 'POST', ...jsonBody({ confirm_name: resetName.trim() }) })
      setResetOpen(false); setResetName('')
      notify('success', `${selected.child_name} 的学习数据已重置`)
      window.setTimeout(() => resetTriggerRef.current?.focus())
      await refreshAfterSave(async () => {
        const [overviewData, detailData] = await Promise.all([
          api<ReportOverview>(`/api/admin/reports/overview?days=${days}`),
          detailTab === 'exercise'
            ? api<ExerciseAdminReport>(`/api/admin/exercise-reports/summary?days=${days}&child_id=${selected.child_id}`)
            : api<Report>(`/api/admin/reports/summary?days=${days}&mode=${detailTab}&child_id=${selected.child_id}`),
        ])
        setOverview(overviewData)
        if (detailTab === 'exercise') setExerciseReport(detailData as ExerciseAdminReport)
        else setReport(detailData as Report)
      })
    } catch (e) { setResetError(e instanceof Error ? e.message : '学习数据重置失败') }
    finally { resettingRef.current = false; setResetting(false) }
  }

  return <>
    <header className="section-title"><div><p className="eyebrow">学习报告</p><h2>{view === 'global' ? '全局学情分析' : selected ? `${selected.child_name} 的学习详情` : '每位学生的学习进展'}</h2><p>{view === 'global' ? '从全体学生的共性薄弱点中提炼本周期教学重点。' : selected ? '分别查看打字、单词与习题表现。' : '先总览所有学生，再进入个人详情。'}</p></div><div className="report-header-actions">{view === 'students' && selected && <button ref={resetTriggerRef} className="danger-button report-reset-trigger" onClick={openReset}><Trash2 />重置学习数据</button>}<a className="ghost link-button" href={view === 'global' ? `/api/admin/learning-analysis/export.csv?days=${days}&section=${analysisTab}` : `/api/admin/reports/export.csv?${exportQuery}`}><Download />导出当前视图</a></div></header>
    <div className="report-view-tabs" role="tablist" aria-label="学情视图"><button role="tab" aria-selected={view === 'global'} onClick={() => setView('global')}><Users />全局学情</button><button role="tab" aria-selected={view === 'students'} onClick={() => setView('students')}><BookOpen />学生分析</button></div>
    {error && <p className="notice error">{error}</p>}
    {refreshNotice}
    <div className="report-filters card">
      {view === 'students' && childId && <button className="ghost report-back" onClick={() => setChildId('')}><ArrowLeft />学生总览</button>}
      {view === 'students' && childId && <label>学生<select value={childId} onChange={(e) => setChildId(e.target.value)}>{children.map((child) => <option value={child.id} key={child.id}>{child.name}</option>)}</select></label>}
      <label>时间范围<select value={days} onChange={(e) => setDays(e.target.value)}><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="365">最近一年</option></select></label>
      {loading && <span className="report-loading" role="status">正在更新…</span>}
    </div>
    {view === 'global' && <GlobalAnalysis analysis={analysis} tab={analysisTab} onTab={setAnalysisTab} />}
    {view === 'students' && !childId && <StudentOverview rows={overview?.students ?? []} onSelect={(id) => setChildId(String(id))} />}
    {view === 'students' && childId && <>
      <div className="report-detail-tabs" role="tablist" aria-label="学习报告类型">{detailTabs.map(({ id, label, icon: Icon }) => <button id={`report-tab-${id}`} role="tab" aria-selected={detailTab === id} tabIndex={detailTab === id ? 0 : -1} key={id} onClick={() => selectTab(id)} onKeyDown={(event) => handleTabKey(event, id)}><Icon />{label}</button>)}</div>
      {detailTab === 'exercise' ? <ExerciseDetail report={exerciseReport} /> : <TypingDetail report={report} mode={detailTab} />}
    </>}
    {resetOpen && selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReset() }}><div className="report-reset-modal card" role="dialog" aria-modal="true" aria-labelledby="report-reset-title" aria-describedby="report-reset-warning"><header><div className="report-reset-title"><span><AlertTriangle /></span><div><p className="eyebrow">不可恢复的操作</p><h2 id="report-reset-title">重置学习数据</h2></div></div><button className="ghost" aria-label="关闭重置学习数据警告" disabled={resetting} onClick={closeReset}><X /></button></header><p className="report-reset-warning" id="report-reset-warning"><strong>警告：即将永久清空「{selected.child_name}」的全部学习数据，此操作不可恢复。</strong></p><ul><li>永久删除全部打字、单词和习题练习记录</li><li>终止进行中和判题中的习题练习</li><li>清空已掌握与未掌握的错题记录</li><li>学生账号、PIN 和公共题库不会受到影响</li></ul><p className="muted">如需留档，请先取消并分别导出相关报告。</p><label className="report-reset-confirm">请输入学生姓名 <strong>{selected.child_name}</strong> 以确认<input ref={resetInputRef} value={resetName} disabled={resetting} autoComplete="off" onChange={(event) => setResetName(event.target.value)} /></label>{resetError && <p className="notice error" role="alert">{resetError}</p>}<div className="button-row"><button className="ghost" disabled={resetting} onClick={closeReset}>取消</button><button className="danger-button report-reset-confirm-button" disabled={resetting || resetName.trim() !== selected.child_name} onClick={() => void resetLearningData()}><Trash2 />{resetting ? '正在重置…' : '确认永久重置'}</button></div></div></div>}
  </>
}

function GlobalAnalysis({ analysis, tab, onTab }: { analysis: LearningAnalysis; tab: AnalysisTab; onTab: (tab: AnalysisTab) => void }) {
  const tabs: { id: AnalysisTab; label: string; icon: typeof Keyboard }[] = [
    { id: 'typing', label: '打字分析', icon: Keyboard }, { id: 'word', label: '单词分析', icon: Languages }, { id: 'exercise', label: '习题分析', icon: FileQuestion },
  ]
  const summary = analysis.summary
  return <div className="global-analysis">
    <div className="analysis-summary">
      <Metric label="参与学生" value={summary.participating_students} unit="人" />
      <Metric label="打字 / 单词" value={`${summary.typing_attempts} / ${summary.word_attempts}`} unit="次" />
      <Metric label="练习时长" value={summary.practice_minutes} unit="分钟" />
      <Metric label="总体准确率" value={summary.overall_accuracy} unit="%" />
      <Metric label="已完成习题" value={summary.completed_exercise_sessions} unit="套" />
      <Metric label="习题错误率" value={summary.exercise_wrong_rate} unit="%" />
    </div>
    <section className="card analysis-insights"><h3><Lightbulb />本周期教学重点</h3>{analysis.insights.length ? <div>{analysis.insights.map((item) => <article key={`${item.category}-${item.title}`}><strong>{item.title}</strong><p>{item.description}</p><small>{item.recommendation}</small></article>)}</div> : <p className="muted">暂无影响至少 2 名学生的班级共性问题。</p>}</section>
    <div className="report-detail-tabs analysis-tabs" role="tablist" aria-label="全局学情分类">{tabs.map(({ id, label, icon: Icon }) => <button id={`analysis-tab-${id}`} role="tab" aria-selected={tab === id} key={id} onClick={() => onTab(id)}><Icon />{label}</button>)}</div>
    {tab === 'typing' && <div className="analysis-columns" role="tabpanel" aria-labelledby="analysis-tab-typing"><IssueSection title="高频错键" empty="暂无错键数据">{analysis.typing.weak_keys.map((item) => <TypingIssue item={item} key={item.expected_char} />)}</IssueSection><IssueSection title="易混淆键对" empty="暂无易混淆键对">{analysis.typing.confusion_pairs.map((item) => <TypingIssue item={item} pair key={`${item.expected_char}-${item.actual_char}`} />)}</IssueSection></div>}
    {tab === 'word' && <div role="tabpanel" aria-labelledby="analysis-tab-word"><IssueSection title="易错单词" empty="该时间范围内暂无易错单词">{analysis.words.difficult_words.map((item) => <WordIssue item={item} key={item.word_key} />)}</IssueSection></div>}
    {tab === 'exercise' && <div className="analysis-exercise-sections" role="tabpanel" aria-labelledby="analysis-tab-exercise"><IssueSection title="高频易错题" empty="该时间范围内暂无错题">{analysis.exercises.difficult_questions.map((item) => <QuestionIssue item={item} key={item.question_key} />)}</IssueSection><IssueSection title="反复未掌握（错题重练）" empty="暂无错题重练失败记录">{analysis.exercises.persistent_questions.map((item) => <QuestionIssue item={item} key={item.question_key} />)}</IssueSection><IssueSection title="编程题失败类型" empty="暂无编程失败记录">{analysis.exercises.programming_failures.map((item) => <ProgrammingFailure item={item} key={item.status} />)}</IssueSection></div>}
  </div>
}

function Metric({ label, value, unit }: { label: string; value: string | number; unit: string }) {
  return <div><span>{label}</span><strong>{value} <small>{unit}</small></strong></div>
}

function IssueSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  return <section className="card analysis-issue-section"><h3>{title}<small>按影响学生数排序 · 前 10 项</small></h3>{Array.isArray(children) && children.length === 0 ? <p className="muted">{empty}</p> : <div className="analysis-issue-list">{children}</div>}</section>
}

function IssueMeta({ item }: { item: LearningAnalysisIssue }) {
  return <><Trend item={item} />{item.small_sample && <em className="analysis-sample">小样本</em>}<StudentBreakdown item={item} /></>
}

function Trend({ item }: { item: LearningAnalysisIssue }) {
  if (item.trend.previous == null || item.trend.delta == null) return <span className="analysis-trend neutral">暂无对比</span>
  const delta = item.trend.delta
  const unit = item.trend.unit === 'percentage_point' ? '个百分点' : '次'
  return <span className={`analysis-trend ${delta > 0 ? 'worse' : delta < 0 ? 'better' : 'neutral'}`}>较上期 {delta > 0 ? '+' : ''}{delta} {unit}</span>
}

function StudentBreakdown({ item }: { item: LearningAnalysisIssue }) {
  return <details className="analysis-students"><summary>影响 {item.affected_student_count} 名学生</summary>{item.students.length ? <ul>{item.students.map((student) => <li key={student.child_id}><strong>{student.child_name}</strong><span>{student.count} 次</span><time>最近：{new Date(student.last_at).toLocaleString('zh-CN', { hour12: false })}</time></li>)}</ul> : <p className="muted">无学生明细</p>}</details>
}

function TypingIssue({ item, pair = false }: { item: LearningAnalysisTypingIssue; pair?: boolean }) {
  return <article className="analysis-issue"><header><div className="analysis-key">{pair ? <><kbd>{errorLabel(item.expected_char)}</kbd><span>→</span><kbd>{errorLabel(item.actual_char ?? '')}</kbd></> : <kbd>{errorLabel(item.expected_char)}</kbd>}</div><strong>{item.error_count} 次 <small>· 占全部错误 {item.error_share}%</small></strong></header><div className="analysis-badges"><IssueMeta item={item} /></div><p>{item.recommendation}</p></article>
}

function WordIssue({ item }: { item: LearningAnalysisWordIssue }) {
  return <article className="analysis-issue"><header><div><strong className="analysis-title">{item.word}</strong><small>{item.word_set_title}</small></div><strong>{item.wrong_attempt_count} / {item.attempt_count} 次错误 <small>· {item.wrong_rate}%</small></strong></header><div className="analysis-badges"><IssueMeta item={item} /><span>平均准确率 {item.average_accuracy}%</span></div>{item.top_confusions.length > 0 && <p className="analysis-patterns">高频误按：{item.top_confusions.map((pair) => `${errorLabel(pair.expected_char)} → ${errorLabel(pair.actual_char)}（${pair.count}次）`).join('；')}</p>}<p>{item.recommendation}</p></article>
}

function QuestionIssue({ item }: { item: LearningAnalysisQuestionIssue }) {
  const typeLabels: Record<string, string> = { single_choice: '单选', multiple_choice: '多选', true_false: '判断', fill_blank: '填空', programming: '编程' }
  return <article className="analysis-issue question-analysis-issue"><header><div><span className="analysis-question-set">{item.question_set_title} · {typeLabels[item.question_type] ?? item.question_type}</span><MarkdownText value={item.stem_markdown} /></div><strong>{item.wrong_count} / {item.attempt_count} 次错误 <small>· {item.wrong_rate}%</small></strong></header><div className="analysis-badges"><IssueMeta item={item} /><span>当前未掌握 {item.current_unmastered_count} 人</span></div><details className="analysis-answer"><summary>查看答案与错误模式</summary><p><strong>正确答案：</strong>{item.correct_answer || '—'}</p>{item.common_wrong_answers.length > 0 && <ol>{item.common_wrong_answers.map((pattern) => <li key={pattern.label}>{pattern.label} <small>{pattern.count} 次</small></li>)}</ol>}</details><p>{item.recommendation}</p></article>
}

function ProgrammingFailure({ item }: { item: LearningAnalysisProgrammingFailure }) {
  return <article className="analysis-issue"><header><div className="analysis-program-status"><Code2 /><strong>{item.status}</strong></div><strong>{item.attempt_count} 次 <small>· {item.question_count} 道题</small></strong></header><div className="analysis-badges"><IssueMeta item={item} /></div><p>{item.recommendation}</p></article>
}

function StudentOverview({ rows, onSelect }: { rows: ReportOverviewRow[]; onSelect: (id: number) => void }) {
  if (!rows.length) return <div className="card report-empty"><strong>暂无学生档案</strong><p>创建学生后，学习数据会显示在这里。</p></div>
  return <div className="student-report-list"><div className="student-report-head"><span>学生</span><span>打字 / 单词</span><span>速度 / 准确率</span><span>习题完成</span><span>平均成绩</span><span>未掌握错题</span></div>{rows.map((row) => <button className="student-report-row" onClick={() => onSelect(row.child_id)} key={row.child_id}>
    <span><strong>{row.child_name}</strong><small>{row.active ? '正常使用' : '已停用'}</small></span>
    <span><strong>{row.course_attempt_count} / {row.word_attempt_count}</strong><small>{row.practice_minutes} 分钟</small></span>
    <span><strong>{row.average_cpm ?? '—'} CPM</strong><small>{speedMetricLabel(row.cpm_metric_version, row.cpm_attempt_count)} · {row.accuracy}%</small></span>
    <span><strong>{row.exercise_completed} / {row.exercise_total}</strong><small>{row.exercise_completion_rate}%</small></span>
    <span><strong>{row.exercise_average_percent}%</strong><small>已完成练习</small></span>
    <span><strong>{row.unresolved_wrong_count}</strong><small>当前存量</small></span>
  </button>)}</div>
}

function TypingDetail({ report, mode }: { report: Report; mode: 'course' | 'word' }) {
  return <div role="tabpanel" aria-labelledby={`report-tab-${mode}`}><div className="report-metrics"><div><span>练习次数</span><strong>{report.attempt_count}</strong></div><div><span>练习分钟</span><strong>{report.practice_minutes}</strong></div><div><span>平均速度</span><strong>{report.average_cpm ?? '—'} <small>CPM</small></strong><small>{speedMetricLabel(report.cpm_metric_version, report.cpm_attempt_count)}</small></div><div><span>整体准确率</span><strong>{report.accuracy}%</strong></div></div><div className="report-columns"><section className="card"><h3>薄弱按键</h3>{report.weak_keys.length ? report.weak_keys.map((item) => <div className="weak-row" key={item.char}><kbd>{errorLabel(item.char)}</kbd><div><i style={{ width: `${Math.max(8, item.count / report.weak_keys[0].count * 100)}%` }} /></div><span>{item.count} 次</span></div>) : <p className="muted">还没有错误记录，继续保持！</p>}</section><section className="card"><h3>最近练习</h3>{report.attempts.length ? <div className="attempt-table">{report.attempts.slice(0, 12).map((item) => <div key={item.id}><time>{new Date(item.created_at).toLocaleDateString()}</time><strong>{item.cpm ?? '—'} CPM{item.metric_version === 1 && <small> · 历史口径</small>}</strong><span>{item.accuracy}%</span><span>{item.errors} 错</span></div>)}</div> : <p className="muted">该时间范围内暂无练习。</p>}</section></div></div>
}

function speedMetricLabel(version: number | null, count: number): string {
  if (!version || count === 0) return '暂无测速'
  return `${version === 1 ? '历史口径' : '当前口径'} · ${count} 次`
}

function ExerciseDetail({ report }: { report: ExerciseAdminReport }) {
  const statusLabel: Record<string, string> = { in_progress: '进行中', judging: '判题中', completed: '已完成', abandoned: '已放弃' }
  return <div role="tabpanel" aria-labelledby="report-tab-exercise"><div className="report-metrics"><div><span>已完成练习</span><strong>{report.session_count}</strong></div><div><span>完成率</span><strong>{report.completion_rate}%</strong></div><div><span>平均得分率</span><strong>{report.average_percent}%</strong></div><div><span>当前未掌握错题</span><strong>{report.unresolved_wrong_count}</strong></div></div><div className="report-columns exercise-report-columns"><section className="card"><h3>练习状态</h3><div className="exercise-status-list">{Object.entries(report.status_counts).map(([status, count]) => <div key={status}><span>{statusLabel[status] ?? status}</span><strong>{count}</strong></div>)}</div><p className="muted">完成率按已完成数 ÷ 全部已创建练习计算。</p></section><section className="card"><h3>最近习题练习</h3>{report.recent.length ? <div className="exercise-attempt-table">{report.recent.slice(0, 20).map((item) => <div key={item.id}><span><strong>{item.title}</strong><small>{new Date(item.created_at).toLocaleDateString()}</small></span><em className={`report-status ${item.status}`}>{statusLabel[item.status] ?? item.status}</em><span>{item.status === 'completed' ? `${item.score} / ${item.max_score}` : '—'}</span><time>{item.completed_at ? new Date(item.completed_at).toLocaleString('zh-CN', { hour12: false }) : '尚未完成'}</time></div>)}</div> : <p className="muted">该时间范围内暂无习题练习。</p>}</section></div></div>
}
