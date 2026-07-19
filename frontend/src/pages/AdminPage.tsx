import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, BookOpen, Download, FileUp, Pencil, Plus, RefreshCcw, Trash2, Users } from 'lucide-react'
import { api, jsonBody } from '../api'
import { errorLabel } from '../typing'
import type { Child, Course, Lesson, Prompt, Report } from '../types'

type Tab = 'children' | 'library' | 'import' | 'reports'

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('children')
  const [children, setChildren] = useState<Child[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadChildren = useCallback(() => api<Child[]>('/api/admin/children').then(setChildren), [])
  const loadLibrary = useCallback(() => api<Course[]>('/api/admin/library').then(setCourses), [])
  const loadReport = useCallback((childId = '', days = '30') => api<Report>(`/api/admin/reports/summary?days=${days}${childId ? `&child_id=${childId}` : ''}`).then(setReport), [])
  useEffect(() => { Promise.all([loadChildren(), loadLibrary(), loadReport()]).catch((e) => setError(e.message)) }, [loadChildren, loadLibrary, loadReport])

  const action = async (work: () => Promise<unknown>, success: string, reload: () => Promise<unknown> = async () => {}) => {
    setError(''); setMessage('')
    try { await work(); await reload(); setMessage(success) } catch (e) { setError(e instanceof Error ? e.message : '操作失败') }
  }

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div><p className="eyebrow">管理中心</p><h1>内容与成长</h1></div>
        <nav>
          <button className={tab === 'children' ? 'active' : ''} onClick={() => setTab('children')}><Users />孩子档案</button>
          <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}><BookOpen />课程词库</button>
          <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}><FileUp />导入导出</button>
          <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}><BarChart3 />学习报告</button>
        </nav>
      </aside>
      <section className="admin-content">
        {message && <p className="notice success">{message}</p>}
        {error && <p className="notice error">{error}</p>}
        {tab === 'children' && <ChildrenPanel children={children} action={action} reload={loadChildren} />}
        {tab === 'library' && <LibraryPanel courses={courses} action={action} reload={loadLibrary} />}
        {tab === 'import' && <ImportPanel courses={courses} reload={loadLibrary} action={action} />}
        {tab === 'reports' && <ReportsPanel children={children} report={report} loadReport={loadReport} />}
      </section>
    </div>
  )
}

function ChildrenPanel({ children, action, reload }: { children: Child[]; action: Function; reload: () => Promise<unknown> }) {
  const [name, setName] = useState(''); const [pin, setPin] = useState('')
  const submit = (e: React.FormEvent) => { e.preventDefault(); void action(() => api('/api/admin/children', { method: 'POST', ...jsonBody({ name, pin, active: true }) }), '孩子档案已创建', reload); setName(''); setPin('') }
  return <><header className="section-title"><div><p className="eyebrow">孩子档案</p><h2>谁在练习？</h2><p>每个孩子都有独立的 PIN 和学习记录。</p></div></header>
    <form className="inline-form card" onSubmit={submit}><label>昵称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：小宇" required /></label><label>PIN<input value={pin} inputMode="numeric" pattern="\d{4,6}" onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="4–6 位数字" required /></label><button className="primary"><Plus />添加孩子</button></form>
    <div className="data-list">{children.map((child) => <article className="data-row" key={child.id}><div className="avatar">{child.name.slice(0, 1)}</div><div className="grow"><h3>{child.name}</h3><p>{child.attempts ?? 0} 条练习记录 · {child.active ? '可以登录' : '已停用'}</p></div><button className="ghost" onClick={() => { const next = window.prompt(`为 ${child.name} 设置新的 4–6 位 PIN`); if (next) void action(() => api(`/api/admin/children/${child.id}`, { method: 'PATCH', ...jsonBody({ pin: next }) }), 'PIN 已重置', reload) }}><RefreshCcw />重置 PIN</button><button className="ghost" onClick={() => void action(() => api(`/api/admin/children/${child.id}`, { method: 'PATCH', ...jsonBody({ active: !child.active }) }), child.active ? '档案已停用' : '档案已启用', reload)}>{child.active ? '停用' : '启用'}</button><button className="danger-button" onClick={() => window.confirm(`删除 ${child.name} 及全部成绩？此操作不可恢复。`) && void action(() => api(`/api/admin/children/${child.id}`, { method: 'DELETE' }), '档案已删除', reload)}><Trash2 /></button></article>)}</div>
  </>
}

function LibraryPanel({ courses, action, reload }: { courses: Course[]; action: Function; reload: () => Promise<unknown> }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('')
  const createCourse = (e: React.FormEvent) => { e.preventDefault(); void action(() => api('/api/admin/courses', { method: 'POST', ...jsonBody({ title, description, sort_order: courses.length, active: true }) }), '课程已创建', reload); setTitle(''); setDescription('') }
  const createLesson = (course: Course) => { const value = window.prompt('新关卡名称'); if (value) void action(() => api('/api/admin/lessons', { method: 'POST', ...jsonBody({ course_id: course.id, title: value, description: '', sort_order: course.lessons.length, active: true }) }), '关卡已创建', reload) }
  const createPrompt = (lesson: Lesson) => { const value = window.prompt('输入练习内容（支持英文、代码和换行）'); if (value) void action(() => api('/api/admin/prompts', { method: 'POST', ...jsonBody({ lesson_id: lesson.id, content: value, sort_order: lesson.prompts?.length ?? 0, active: true }) }), '练习内容已添加', reload) }
  return <><header className="section-title"><div><p className="eyebrow">课程词库</p><h2>设计练习路径</h2><p>按课程、关卡、练习条目组织内容。</p></div></header>
    <form className="inline-form card" onSubmit={createCourse}><label>课程名称<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label><label className="grow">说明<input value={description} onChange={(e) => setDescription(e.target.value)} /></label><button className="primary"><Plus />新建课程</button></form>
    <div className="library-tree">{courses.map((course) => <article className="library-course card" key={course.id}><header><div className="grow"><h3>{course.title} {!course.active && <em>已停用</em>}</h3><p>{course.description || '暂无说明'}</p></div><button className="ghost" onClick={() => { const value = window.prompt('课程名称', course.title); if (value) void action(() => api(`/api/admin/courses/${course.id}`, { method: 'PUT', ...jsonBody({ title: value, description: course.description, sort_order: course.sort_order ?? 0, active: course.active }) }), '课程已更新', reload) }}><Pencil />编辑</button><button className="ghost" onClick={() => createLesson(course)}><Plus />关卡</button><button className="danger-button" onClick={() => window.confirm('删除课程及其全部关卡？历史成绩会保留文本快照。') && void action(() => api(`/api/admin/courses/${course.id}`, { method: 'DELETE' }), '课程已删除', reload)}><Trash2 /></button></header>
      <div className="lesson-admin-list">{course.lessons.map((lesson) => <section key={lesson.id}><div className="lesson-admin-head"><div><strong>{lesson.title}</strong><small>{lesson.prompts?.length ?? 0} 条内容</small></div><button onClick={() => { const value = window.prompt('关卡名称', lesson.title); if (value) void action(() => api(`/api/admin/lessons/${lesson.id}`, { method: 'PUT', ...jsonBody({ course_id: course.id, title: value, description: lesson.description, sort_order: lesson.sort_order ?? 0, active: lesson.active }) }), '关卡已更新', reload) }}><Pencil /></button><button onClick={() => createPrompt(lesson)}><Plus /></button><button onClick={() => window.confirm('删除这个关卡？') && void action(() => api(`/api/admin/lessons/${lesson.id}`, { method: 'DELETE' }), '关卡已删除', reload)}><Trash2 /></button></div>
        <div className="prompt-list">{lesson.prompts?.map((prompt, index) => <div key={prompt.id}><code>{prompt.content.replace(/\n/g, ' ↵ ')}</code><span>{prompt.active ? '启用' : '停用'}</span><button onClick={() => { const value = window.prompt('编辑练习内容', prompt.content); if (value) void action(() => api(`/api/admin/prompts/${prompt.id}`, { method: 'PUT', ...jsonBody({ lesson_id: lesson.id, content: value, sort_order: prompt.sort_order ?? index, active: prompt.active }) }), '内容已更新', reload) }}><Pencil /></button><button onClick={() => void action(() => api(`/api/admin/prompts/${prompt.id}`, { method: 'PUT', ...jsonBody({ lesson_id: lesson.id, content: prompt.content, sort_order: prompt.sort_order ?? index, active: !prompt.active }) }), prompt.active ? '内容已停用' : '内容已启用', reload)}>{prompt.active ? '停用' : '启用'}</button><button onClick={() => window.confirm('删除这条练习？') && void action(() => api(`/api/admin/prompts/${prompt.id}`, { method: 'DELETE' }), '内容已删除', reload)}><Trash2 /></button></div>)}</div>
      </section>)}</div></article>)}</div>
  </>
}

function ImportPanel({ courses, reload, action }: { courses: Course[]; reload: () => Promise<unknown>; action: Function }) {
  const [format, setFormat] = useState('txt'); const [content, setContent] = useState(''); const [mode, setMode] = useState('append'); const [lessonId, setLessonId] = useState(''); const [preview, setPreview] = useState<any>(null)
  const lessons = courses.flatMap((course) => course.lessons)
  useEffect(() => { if (!lessonId && lessons[0]) setLessonId(String(lessons[0].id)) }, [lessonId, lessons])
  const payload = { format, content, mode, target_lesson_id: format === 'txt' ? Number(lessonId) : null }
  const readFile = async (file?: File) => { if (file) { setContent(await file.text()); const ext = file.name.split('.').pop()?.toLowerCase(); if (['txt', 'csv', 'json'].includes(ext ?? '')) setFormat(ext!) } }
  const previewImport = () => void action(async () => setPreview(await api('/api/admin/import/preview', { method: 'POST', ...jsonBody(payload) })), '预览完成')
  const commit = () => { if (mode === 'replace' && !window.confirm('替换模式会删除目标范围内现有词库，确认继续？')) return; void action(() => api('/api/admin/import', { method: 'POST', ...jsonBody(payload) }), '导入完成', reload) }
  return <><header className="section-title"><div><p className="eyebrow">导入与备份</p><h2>快速补充词库</h2><p>导入前先预览，确认无误后再写入。</p></div><a className="primary link-button" href="/api/admin/export"><Download />导出 JSON</a></header>
    <div className="card import-card"><div className="import-grid"><label>格式<select value={format} onChange={(e) => { setFormat(e.target.value); setPreview(null) }}><option value="txt">TXT（每行一条）</option><option value="csv">CSV</option><option value="json">JSON</option></select></label><label>模式<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="append">追加</option><option value="replace">替换</option></select></label>{format === 'txt' && <label>目标关卡<select value={lessonId} onChange={(e) => setLessonId(e.target.value)}>{lessons.map((lesson) => <option value={lesson.id} key={lesson.id}>{lesson.title}</option>)}</select></label>}<label className="file-picker"><FileUp />选择文件<input type="file" accept=".txt,.csv,.json" onChange={(e) => void readFile(e.target.files?.[0])} /></label></div><label>文件内容<textarea rows={14} value={content} onChange={(e) => { setContent(e.target.value); setPreview(null) }} placeholder="粘贴内容，或选择文件…" /></label><div className="button-row"><button className="ghost" onClick={previewImport} disabled={!content}>预览导入</button><button className="primary" onClick={commit} disabled={!preview?.valid}>确认导入</button></div>{preview && <div className={preview.valid ? 'import-preview success-box' : 'import-preview error-box'}><strong>{preview.valid ? '内容检查通过' : '内容需要修改'}</strong><p>{preview.course_count} 个课程 · {preview.lesson_count} 个关卡 · {preview.prompt_count} 条练习</p>{preview.errors?.map((item: string) => <div key={item}>{item}</div>)}</div>}</div>
  </>
}

function ReportsPanel({ children, report, loadReport }: { children: Child[]; report: Report | null; loadReport: (child: string, days: string) => Promise<unknown> }) {
  const [childId, setChildId] = useState(''); const [days, setDays] = useState('30')
  useEffect(() => { void loadReport(childId, days) }, [childId, days, loadReport])
  const query = `days=${days}${childId ? `&child_id=${childId}` : ''}`
  return <><header className="section-title"><div><p className="eyebrow">学习报告</p><h2>看见每天的进步</h2><p>速度、准确率和薄弱按键一目了然。</p></div><a className="ghost link-button" href={`/api/admin/reports/export.csv?${query}`}><Download />导出 CSV</a></header>
    <div className="report-filters card"><label>孩子<select value={childId} onChange={(e) => setChildId(e.target.value)}><option value="">全部孩子</option>{children.map((child) => <option value={child.id} key={child.id}>{child.name}</option>)}</select></label><label>时间范围<select value={days} onChange={(e) => setDays(e.target.value)}><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="365">最近一年</option></select></label></div>
    {report && <><div className="report-metrics"><div><span>练习次数</span><strong>{report.attempt_count}</strong></div><div><span>练习分钟</span><strong>{report.practice_minutes}</strong></div><div><span>平均速度</span><strong>{report.average_cpm} <small>CPM</small></strong></div><div><span>整体准确率</span><strong>{report.accuracy}%</strong></div></div><div className="report-columns"><section className="card"><h3>薄弱按键</h3>{report.weak_keys.length ? report.weak_keys.map((item) => <div className="weak-row" key={item.char}><kbd>{errorLabel(item.char)}</kbd><div><i style={{ width: `${Math.max(8, item.count / report.weak_keys[0].count * 100)}%` }} /></div><span>{item.count} 次</span></div>) : <p className="muted">还没有错误记录，继续保持！</p>}</section><section className="card"><h3>最近练习</h3><div className="attempt-table">{report.attempts.slice(0, 12).map((item) => <div key={item.id}><time>{new Date(item.created_at).toLocaleDateString()}</time><strong>{item.cpm} CPM</strong><span>{item.accuracy}%</span><span>{item.errors} 错</span></div>)}</div></section></div></>}
  </>
}

