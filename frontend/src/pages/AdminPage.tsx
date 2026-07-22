import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { BarChart3, BookOpen, ChevronDown, Download, FileQuestion, FileUp, GripVertical, Languages, Pencil, Plus, RefreshCcw, Trash2, Users } from 'lucide-react'
import { api, jsonBody } from '../api'
import type { Child, Course, Lesson, Prompt, QuestionSetSummary, WordSetSummary } from '../types'
import { AdminReportsPanel } from './AdminReportsPanel'
import { WordLibraryPanel } from './WordLibraryPanel'
import { QuestionLibraryPanel } from './QuestionLibraryPanel'

type Tab = 'children' | 'library' | 'words' | 'questions' | 'import' | 'reports'
type TransferTab = 'typing' | 'words' | 'questions'
type AdminAction = (work: () => Promise<unknown>, success: string, reload?: () => Promise<unknown>) => Promise<boolean>

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('children')
  const [children, setChildren] = useState<Child[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadChildren = useCallback(() => api<Child[]>('/api/admin/children').then(setChildren), [])
  const loadLibrary = useCallback(() => api<Course[]>('/api/admin/library').then(setCourses), [])
  useEffect(() => { Promise.all([loadChildren(), loadLibrary()]).catch((e) => setError(e.message)) }, [loadChildren, loadLibrary])

  const action = async (work: () => Promise<unknown>, success: string, reload: () => Promise<unknown> = async () => {}) => {
    setError(''); setMessage('')
    try { await work(); await reload(); setMessage(success); return true } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); return false }
  }

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div><p className="eyebrow">管理中心</p><h1>内容与成长</h1></div>
        <nav>
          <button className={tab === 'children' ? 'active' : ''} onClick={() => setTab('children')}><Users />学生档案</button>
          <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}><BookOpen />打字词库</button>
          <button className={tab === 'words' ? 'active' : ''} onClick={() => setTab('words')}><Languages />单词词库</button>
          <button className={tab === 'questions' ? 'active' : ''} onClick={() => setTab('questions')}><FileQuestion />习题题库</button>
          <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}><FileUp />导入导出</button>
          <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}><BarChart3 />学习报告</button>
        </nav>
      </aside>
      <section className="admin-content">
        {message && <p className="notice success">{message}</p>}
        {error && <p className="notice error">{error}</p>}
        {tab === 'children' && <ChildrenPanel children={children} action={action} reload={loadChildren} />}
        {tab === 'library' && <LibraryPanel courses={courses} action={action} reload={loadLibrary} />}
        {tab === 'words' && <WordLibraryPanel />}
        {tab === 'questions' && <QuestionLibraryPanel />}
        {tab === 'import' && <ImportPanel courses={courses} reload={loadLibrary} action={action} />}
        {tab === 'reports' && <AdminReportsPanel children={children} />}
      </section>
    </div>
  )
}

function ChildrenPanel({ children, action, reload }: { children: Child[]; action: AdminAction; reload: () => Promise<unknown> }) {
  const [name, setName] = useState(''); const [pin, setPin] = useState('')
  const submit = (e: React.FormEvent) => { e.preventDefault(); void action(() => api('/api/admin/children', { method: 'POST', ...jsonBody({ name, pin, active: true }) }), '学生档案已创建', reload); setName(''); setPin('') }
  return <><header className="section-title"><div><p className="eyebrow">学生档案</p><h2>谁在练习？</h2><p>每个学生都有独立的 PIN 和学习记录。</p></div></header>
    <form className="inline-form card" onSubmit={submit}><label>昵称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：小宇" required /></label><label>PIN<input value={pin} inputMode="numeric" pattern="\d{4,6}" onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="4–6 位数字" required /></label><button className="primary"><Plus />添加学生</button></form>
    <div className="data-list">{children.map((child) => <article className="data-row" key={child.id}><div className="avatar">{child.name.slice(0, 1)}</div><div className="grow"><h3>{child.name}</h3><p>{child.attempts ?? 0} 条练习记录 · {child.active ? '可以登录' : '已停用'}</p></div><button className="ghost" onClick={() => { const next = window.prompt(`为 ${child.name} 设置新的 4–6 位 PIN`); if (next) void action(() => api(`/api/admin/children/${child.id}`, { method: 'PATCH', ...jsonBody({ pin: next }) }), 'PIN 已重置', reload) }}><RefreshCcw />重置 PIN</button><button className="ghost" onClick={() => void action(() => api(`/api/admin/children/${child.id}`, { method: 'PATCH', ...jsonBody({ active: !child.active }) }), child.active ? '档案已停用' : '档案已启用', reload)}>{child.active ? '停用' : '启用'}</button><button className="danger-button" onClick={() => window.confirm(`删除 ${child.name} 及全部成绩？此操作不可恢复。`) && void action(() => api(`/api/admin/children/${child.id}`, { method: 'DELETE' }), '档案已删除', reload)}><Trash2 /></button></article>)}</div>
  </>
}

export function reorderCourseList(courses: Course[], activeId: number, overId: number) {
  const oldIndex = courses.findIndex((course) => course.id === activeId)
  const newIndex = courses.findIndex((course) => course.id === overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return courses
  return arrayMove(courses, oldIndex, newIndex).map((course, index) => ({ ...course, sort_order: index }))
}

export function saveCourseOrder(courses: Course[]) {
  return api('/api/admin/courses/order', { method: 'PUT', ...jsonBody({ course_ids: courses.map((course) => course.id) }) })
}

function SortableCourseCard({ course, expanded, disabled, children }: { course: Course; expanded: boolean; disabled: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: course.id, disabled })
  const constrainedTransform = transform ? { ...transform, x: 0 } : null
  return <article
    ref={setNodeRef}
    style={{ transform: CSS.Transform.toString(constrainedTransform), transition }}
    className={`library-course card sortable-course${expanded ? ' expanded' : ' collapsed'}${isDragging ? ' is-dragging' : ''}`}
  >
    <button
      type="button"
      ref={setActivatorNodeRef}
      className="course-drag-handle"
      disabled={disabled}
      {...attributes}
      {...listeners}
      aria-label={`拖动课程 ${course.title} 调整顺序`}
      title="拖动调整顺序；键盘可用空格或回车拿起，方向键移动，再按空格或回车放下，Esc 取消"
    ><GripVertical aria-hidden="true" /></button>
    {children}
  </article>
}

function LibraryPanel({ courses, action, reload }: { courses: Course[]; action: AdminAction; reload: () => Promise<unknown> }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('')
  const [orderedCourses, setOrderedCourses] = useState(courses)
  const [activeCourseId, setActiveCourseId] = useState<number | null>(null)
  const [reordering, setReordering] = useState(false)
  const [expandedCourses, setExpandedCourses] = useState<Set<number>>(() => new Set())
  const [expandedLessons, setExpandedLessons] = useState<Set<number>>(() => new Set())
  useEffect(() => setOrderedCourses(courses), [courses])
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const activeCourse = useMemo(() => orderedCourses.find((course) => course.id === activeCourseId), [activeCourseId, orderedCourses])
  const toggleCourse = (courseId: number) => setExpandedCourses((current) => {
    const next = new Set(current)
    if (next.has(courseId)) next.delete(courseId); else next.add(courseId)
    return next
  })
  const toggleLesson = (lessonId: number) => setExpandedLessons((current) => {
    const next = new Set(current)
    if (next.has(lessonId)) next.delete(lessonId); else next.add(lessonId)
    return next
  })
  const createCourse = (e: React.FormEvent) => { e.preventDefault(); void action(() => api('/api/admin/courses', { method: 'POST', ...jsonBody({ title, description, sort_order: courses.length, active: true }) }), '课程已创建', reload); setTitle(''); setDescription('') }
  const createLesson = (course: Course) => { const value = window.prompt('新关卡名称'); if (value) void action(() => api('/api/admin/lessons', { method: 'POST', ...jsonBody({ course_id: course.id, title: value, description: '', sort_order: course.lessons.length, active: true }) }), '关卡已创建', reload) }
  const createPrompt = (lesson: Lesson) => { const value = window.prompt('输入练习内容（支持英文、代码和换行）'); if (value) void action(() => api('/api/admin/prompts', { method: 'POST', ...jsonBody({ lesson_id: lesson.id, content: value, sort_order: lesson.prompts?.length ?? 0, active: true }) }), '练习内容已添加', reload) }
  const finishReorder = async ({ active, over }: DragEndEvent) => {
    setActiveCourseId(null)
    if (!over || reordering) return
    const previous = orderedCourses
    const next = reorderCourseList(previous, Number(active.id), Number(over.id))
    if (next === previous) return
    setOrderedCourses(next)
    setReordering(true)
    const saved = await action(
      () => saveCourseOrder(next),
      '课程顺序已保存',
      reload,
    )
    if (!saved) {
      setOrderedCourses(previous)
      try { await reload() } catch { /* action 已显示原始保存错误 */ }
    }
    setReordering(false)
  }
  return <><header className="section-title"><div><p className="eyebrow">打字词库</p><h2>设计练习路径</h2><p>按课程、关卡、练习条目组织内容。</p></div></header>
    <form className="inline-form card" onSubmit={createCourse}><label>课程名称<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label><label className="grow">说明<input value={description} onChange={(e) => setDescription(e.target.value)} /></label><button className="primary"><Plus />新建课程</button></form>
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ screenReaderInstructions: { draggable: '聚焦拖动手柄后，按空格键或回车键拿起课程，使用上下方向键移动，按空格键或回车键放下，按 Esc 取消。' } }}
      onDragStart={({ active }) => setActiveCourseId(Number(active.id))}
      onDragCancel={() => setActiveCourseId(null)}
      onDragEnd={(event) => void finishReorder(event)}
    >
    <SortableContext items={orderedCourses.map((course) => course.id)} strategy={verticalListSortingStrategy}>
    <div className={`library-tree${reordering ? ' is-reordering' : ''}`} aria-busy={reordering}>{orderedCourses.map((course) => {
      const courseExpanded = expandedCourses.has(course.id)
      const lessonsId = `admin-course-${course.id}-lessons`
      return <SortableCourseCard course={course} expanded={courseExpanded} disabled={reordering || orderedCourses.length < 2} key={course.id}><header>
        <button type="button" className="course-disclosure grow" aria-expanded={courseExpanded} aria-controls={lessonsId} aria-label={`${courseExpanded ? '收起' : '展开'}课程 ${course.title}`} onClick={() => toggleCourse(course.id)}><ChevronDown className="disclosure-chevron" /><div><h3>{course.title} {!course.active && <em>已停用</em>}</h3><p>{course.description || '暂无说明'}</p></div></button>
        <button type="button" className="ghost" onClick={() => { const value = window.prompt('课程名称', course.title); if (value) void action(() => api(`/api/admin/courses/${course.id}`, { method: 'PUT', ...jsonBody({ title: value, description: course.description, sort_order: course.sort_order ?? 0, active: course.active }) }), '课程已更新', reload) }}><Pencil />编辑</button><button type="button" className="ghost" onClick={() => createLesson(course)}><Plus />关卡</button><button type="button" className="danger-button" aria-label={`删除课程 ${course.title}`} onClick={() => window.confirm('删除课程及其全部关卡？历史成绩会保留文本快照。') && void action(() => api(`/api/admin/courses/${course.id}`, { method: 'DELETE' }), '课程已删除', reload)}><Trash2 /></button>
      </header>
      {courseExpanded && <div className="lesson-admin-list" id={lessonsId}>{course.lessons.map((lesson) => {
        const lessonExpanded = expandedLessons.has(lesson.id)
        const promptsId = `admin-lesson-${lesson.id}-prompts`
        return <section className={lessonExpanded ? 'expanded' : 'collapsed'} key={lesson.id}><div className="lesson-admin-head">
          <button type="button" className="lesson-disclosure" aria-expanded={lessonExpanded} aria-controls={promptsId} aria-label={`${lessonExpanded ? '收起' : '展开'}关卡 ${lesson.title}`} onClick={() => toggleLesson(lesson.id)}><ChevronDown className="disclosure-chevron" /><div><strong>{lesson.title}</strong><small>{lesson.prompts?.length ?? 0} 条内容</small></div></button>
          <button type="button" aria-label={`编辑关卡 ${lesson.title}`} onClick={() => { const value = window.prompt('关卡名称', lesson.title); if (value) void action(() => api(`/api/admin/lessons/${lesson.id}`, { method: 'PUT', ...jsonBody({ course_id: course.id, title: value, description: lesson.description, sort_order: lesson.sort_order ?? 0, active: lesson.active }) }), '关卡已更新', reload) }}><Pencil /></button><button type="button" aria-label={`为关卡 ${lesson.title} 添加练习`} onClick={() => createPrompt(lesson)}><Plus /></button><button type="button" aria-label={`删除关卡 ${lesson.title}`} onClick={() => window.confirm('删除这个关卡？') && void action(() => api(`/api/admin/lessons/${lesson.id}`, { method: 'DELETE' }), '关卡已删除', reload)}><Trash2 /></button>
        </div>
        {lessonExpanded && <div className="prompt-list" id={promptsId}>{lesson.prompts?.map((prompt, index) => <div key={prompt.id}><code>{prompt.content.replace(/\n/g, ' ↵ ')}</code><span>{prompt.active ? '启用' : '停用'}</span><button type="button" aria-label="编辑练习内容" onClick={() => { const value = window.prompt('编辑练习内容', prompt.content); if (value) void action(() => api(`/api/admin/prompts/${prompt.id}`, { method: 'PUT', ...jsonBody({ lesson_id: lesson.id, content: value, sort_order: prompt.sort_order ?? index, active: prompt.active }) }), '内容已更新', reload) }}><Pencil /></button><button type="button" onClick={() => void action(() => api(`/api/admin/prompts/${prompt.id}`, { method: 'PUT', ...jsonBody({ lesson_id: lesson.id, content: prompt.content, sort_order: prompt.sort_order ?? index, active: !prompt.active }) }), prompt.active ? '内容已停用' : '内容已启用', reload)}>{prompt.active ? '停用' : '启用'}</button><button type="button" aria-label="删除练习内容" onClick={() => window.confirm('删除这条练习？') && void action(() => api(`/api/admin/prompts/${prompt.id}`, { method: 'DELETE' }), '内容已删除', reload)}><Trash2 /></button></div>)}</div>}
      </section>})}</div>}
      </SortableCourseCard>
    })}</div>
    </SortableContext>
    <DragOverlay>{activeCourse && <div className="course-drag-overlay card"><GripVertical aria-hidden="true" /><div><strong>{activeCourse.title}</strong><small>{activeCourse.description || '暂无说明'}</small></div></div>}</DragOverlay>
    </DndContext>
  </>
}

function ImportPanel({ courses, reload, action }: { courses: Course[]; reload: () => Promise<unknown>; action: AdminAction }) {
  const [transferTab, setTransferTab] = useState<TransferTab>('typing')
  const [format, setFormat] = useState('txt'); const [content, setContent] = useState(''); const [mode, setMode] = useState('append'); const [lessonId, setLessonId] = useState(''); const [preview, setPreview] = useState<any>(null)
  const [wordSets, setWordSets] = useState<WordSetSummary[]>([]); const [wordSetsLoading, setWordSetsLoading] = useState(true); const [wordSetsError, setWordSetsError] = useState(''); const [wordSetId, setWordSetId] = useState('')
  const [wordFormat, setWordFormat] = useState('txt'); const [wordContent, setWordContent] = useState(''); const [wordMode, setWordMode] = useState('append'); const [wordPreview, setWordPreview] = useState<any>(null)
  const [questionSets, setQuestionSets] = useState<QuestionSetSummary[]>([])
  const [questionFormat, setQuestionFormat] = useState('txt'); const [questionContent, setQuestionContent] = useState(''); const [questionMode, setQuestionMode] = useState('create'); const [questionSetId, setQuestionSetId] = useState(''); const [questionPreview, setQuestionPreview] = useState<any>(null)
  const lessons = courses.flatMap((course) => course.lessons)
  const draftQuestionSets = questionSets.filter((item) => item.status === 'draft')
  const transferTabs: TransferTab[] = ['typing', 'words', 'questions']
  useEffect(() => { if (!lessonId && lessons[0]) setLessonId(String(lessons[0].id)) }, [lessonId, lessons])
  useEffect(() => {
    void api<WordSetSummary[]>('/api/admin/word-sets')
      .then((items) => { setWordSets(items); setWordSetsError(''); setWordSetsLoading(false) })
      .catch((error) => { setWordSetsError(error instanceof Error ? error.message : '单词集加载失败'); setWordSetsLoading(false) })
  }, [])
  useEffect(() => {
    setWordSetId((current) => wordSets.some((item) => String(item.id) === current) ? current : (wordSets[0] ? String(wordSets[0].id) : ''))
  }, [wordSets])
  const loadQuestionSets = useCallback(() => api<QuestionSetSummary[]>('/api/admin/question-sets').then((items) => {
    setQuestionSets(items)
    const drafts = items.filter((item) => item.status === 'draft')
    setQuestionSetId((current) => drafts.some((item) => String(item.id) === current) ? current : (drafts[0] ? String(drafts[0].id) : ''))
  }), [])
  useEffect(() => { void loadQuestionSets().catch(() => setQuestionSets([])) }, [loadQuestionSets])
  const payload = { format, content, mode, target_lesson_id: format === 'txt' ? Number(lessonId) : null }
  const wordPayload = { word_set_id: Number(wordSetId), format: wordFormat, mode: wordMode, content: wordContent }
  const questionPayload = { format: questionFormat, content: questionContent, mode: questionMode, target_question_set_id: questionMode === 'append' ? Number(questionSetId) : null }
  const readFile = async (file?: File) => { if (file) { setContent(await file.text()); setPreview(null); const ext = file.name.split('.').pop()?.toLowerCase(); if (['txt', 'csv', 'json'].includes(ext ?? '')) setFormat(ext!) } }
  const readWordFile = async (file?: File) => { if (file) { setWordContent(await file.text()); setWordPreview(null); const ext = file.name.split('.').pop()?.toLowerCase(); if (['txt', 'csv', 'json'].includes(ext ?? '')) setWordFormat(ext!) } }
  const readQuestionFile = async (file?: File) => { if (file) { setQuestionContent(await file.text()); setQuestionPreview(null); const ext = file.name.split('.').pop()?.toLowerCase(); if (['txt', 'csv', 'json'].includes(ext ?? '')) setQuestionFormat(ext!) } }
  const previewImport = () => void action(async () => setPreview(await api('/api/admin/import/preview', { method: 'POST', ...jsonBody(payload) })), '预览完成')
  const commit = () => { if (mode === 'replace' && !window.confirm('替换模式会删除目标范围内现有词库，确认继续？')) return; void action(() => api('/api/admin/import', { method: 'POST', ...jsonBody(payload) }), '导入完成', reload) }
  const previewWordImport = () => void action(async () => setWordPreview(await api('/api/admin/word-import/preview', { method: 'POST', ...jsonBody(wordPayload) })), '预览完成')
  const commitWordImport = () => {
    if (wordMode === 'replace' && !window.confirm('替换模式会删除该单词集的现有词条，确认继续？')) return
    void action(() => api('/api/admin/word-import', { method: 'POST', ...jsonBody(wordPayload) }), '单词导入完成').then((ok) => { if (ok) setWordPreview(null) })
  }
  const previewQuestionImport = () => void action(async () => setQuestionPreview(await api('/api/admin/exercise-import/preview', { method: 'POST', ...jsonBody(questionPayload) })), '习题预览完成')
  const commitQuestionImport = () => void action(() => api('/api/admin/exercise-import', { method: 'POST', ...jsonBody(questionPayload) }), '习题导入完成').then((ok) => {
    if (ok) { setQuestionPreview(null); void loadQuestionSets() }
  })
  const selectTransferTab = (next: TransferTab, focus = false) => {
    setTransferTab(next)
    if (focus) window.setTimeout(() => document.getElementById(`${next}-transfer-tab`)?.focus(), 0)
  }
  const handleTransferTabKeyDown = (event: React.KeyboardEvent, current: TransferTab) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = transferTabs.indexOf(current)
    const next = transferTabs[event.key === 'Home' ? 0 : event.key === 'End' ? transferTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + transferTabs.length) % transferTabs.length]
    selectTransferTab(next, true)
  }
  return <><header className="section-title"><div><p className="eyebrow">导入导出</p><h2>迁移与备份词库</h2><p>导入前先预览，确认无误后再写入。</p></div></header>
    <div className="transfer-tabs" role="tablist" aria-label="选择导入导出词库">
      <button id="typing-transfer-tab" role="tab" aria-selected={transferTab === 'typing'} aria-controls="typing-transfer-panel" tabIndex={transferTab === 'typing' ? 0 : -1} onClick={() => selectTransferTab('typing')} onKeyDown={(event) => handleTransferTabKeyDown(event, 'typing')}><BookOpen />打字词库</button>
      <button id="words-transfer-tab" role="tab" aria-selected={transferTab === 'words'} aria-controls="words-transfer-panel" tabIndex={transferTab === 'words' ? 0 : -1} onClick={() => selectTransferTab('words')} onKeyDown={(event) => handleTransferTabKeyDown(event, 'words')}><Languages />单词词库</button>
      <button id="questions-transfer-tab" role="tab" aria-selected={transferTab === 'questions'} aria-controls="questions-transfer-panel" tabIndex={transferTab === 'questions' ? 0 : -1} onClick={() => selectTransferTab('questions')} onKeyDown={(event) => handleTransferTabKeyDown(event, 'questions')}><FileQuestion />习题题库</button>
    </div>
    {transferTab === 'typing' && <section className="transfer-panel" id="typing-transfer-panel" role="tabpanel" aria-labelledby="typing-transfer-tab"><header className="section-title"><div><p className="eyebrow">打字词库</p><h2>导入课程与练习</h2></div><a className="primary link-button" href="/api/admin/export"><Download />导出打字词库</a></header>
      <div className="card import-card"><div className="import-grid"><label>格式<select value={format} onChange={(e) => { setFormat(e.target.value); setPreview(null) }}><option value="txt">TXT（每行一条）</option><option value="csv">CSV</option><option value="json">JSON</option></select></label><label>模式<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="append">追加</option><option value="replace">替换</option></select></label>{format === 'txt' && <label>目标关卡<select value={lessonId} onChange={(e) => setLessonId(e.target.value)}>{lessons.map((lesson) => <option value={lesson.id} key={lesson.id}>{lesson.title}</option>)}</select></label>}<label className="file-picker"><FileUp />选择文件<input aria-label="选择打字词库文件" type="file" accept=".txt,.csv,.json" onChange={(e) => void readFile(e.target.files?.[0])} /></label></div><label>文件内容<textarea aria-label="打字词库文件内容" rows={14} value={content} onChange={(e) => { setContent(e.target.value); setPreview(null) }} placeholder="粘贴内容，或选择文件…" /></label><div className="button-row"><button className="ghost" onClick={previewImport} disabled={!content}>预览打字词库</button><button className="primary" onClick={commit} disabled={!preview?.valid}>导入打字词库</button></div>{preview && <div className={preview.valid ? 'import-preview success-box' : 'import-preview error-box'}><strong>{preview.valid ? '内容检查通过' : '内容需要修改'}</strong><p>{preview.course_count} 个课程 · {preview.lesson_count} 个关卡 · {preview.prompt_count} 条练习</p>{preview.errors?.map((item: string) => <div key={item}>{item}</div>)}</div>}</div>
    </section>}
    {transferTab === 'words' && <section className="transfer-panel" id="words-transfer-panel" role="tabpanel" aria-labelledby="words-transfer-tab"><header className="section-title"><div><p className="eyebrow">单词词库</p><h2>导入单词与释义</h2></div><a className="primary link-button" href="/api/admin/word-export"><Download />导出单词词库</a></header>
      {wordSetsLoading && <div className="card transfer-empty"><p>正在加载单词集…</p></div>}
      {!wordSetsLoading && wordSetsError && <p className="notice error">{wordSetsError}</p>}
      {!wordSetsLoading && !wordSetsError && wordSets.length === 0 && <div className="card transfer-empty"><strong>暂无可导入的单词集</strong><p>请先在单词词库创建单词集。</p></div>}
      {!wordSetsLoading && wordSets.length > 0 && <div className="card import-card"><div className="import-grid"><label>目标单词集<select value={wordSetId} onChange={(e) => setWordSetId(e.target.value)}>{wordSets.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label>格式<select value={wordFormat} onChange={(e) => { setWordFormat(e.target.value); setWordPreview(null) }}><option value="txt">TXT</option><option value="csv">CSV</option><option value="json">JSON</option></select></label><label>模式<select value={wordMode} onChange={(e) => setWordMode(e.target.value)}><option value="append">追加/更新</option><option value="replace">替换本集</option></select></label><label className="file-picker"><FileUp />选择文件<input aria-label="选择单词词库文件" type="file" accept=".txt,.csv,.json" onChange={(e) => void readWordFile(e.target.files?.[0])} /></label></div><label>文件内容<textarea aria-label="单词词库文件内容" rows={10} value={wordContent} onChange={(e) => { setWordContent(e.target.value); setWordPreview(null) }} placeholder={wordFormat === 'csv' ? 'word,phonetic,meaning_zh,technical_meaning_zh,active' : '粘贴内容，或选择文件…'} /></label><div className="button-row"><button className="ghost" onClick={previewWordImport} disabled={!wordContent}>预览单词词库</button><button className="primary" onClick={commitWordImport} disabled={!wordPreview?.valid}>导入单词词库</button></div>{wordPreview && <div className={wordPreview.valid ? 'import-preview success-box' : 'import-preview error-box'}><strong>{wordPreview.valid ? '内容检查通过' : '内容需要修改'}</strong><p>共 {wordPreview.word_count} 词 · 新增 {wordPreview.created_count} · 更新 {wordPreview.updated_count} · 待补全 {wordPreview.queued_count}</p>{wordPreview.errors?.map((item: string) => <div key={item}>{item}</div>)}</div>}</div>}
    </section>}
    {transferTab === 'questions' && <section className="transfer-panel" id="questions-transfer-panel" role="tabpanel" aria-labelledby="questions-transfer-tab"><header className="section-title"><div><p className="eyebrow">习题题库</p><h2>导入结构化习题</h2><p>导入内容始终进入草稿，复核后才能发布。</p></div></header>
      <div className="card import-card"><div className="import-grid"><label>格式<select value={questionFormat} onChange={(e) => { setQuestionFormat(e.target.value); setQuestionPreview(null) }}><option value="txt">TXT（客观题）</option><option value="csv">CSV（客观题）</option><option value="json">JSON（全部题型）</option></select></label><label>模式<select aria-label="习题导入模式" value={questionMode} onChange={(e) => { setQuestionMode(e.target.value); setQuestionPreview(null) }}><option value="create">新建草稿题套</option><option value="append">追加到草稿题套</option></select></label>{questionMode === 'append' && <label>目标题套<select aria-label="习题目标题套" value={questionSetId} onChange={(e) => { setQuestionSetId(e.target.value); setQuestionPreview(null) }}>{draftQuestionSets.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}<label className="file-picker"><FileUp />选择文件<input aria-label="选择习题题库文件" type="file" accept=".txt,.csv,.json" onChange={(e) => void readQuestionFile(e.target.files?.[0])} /></label></div>
      {questionMode === 'append' && !draftQuestionSets.length && <p className="notice error">暂无可追加的草稿题套，请改用新建模式。</p>}
      <details className="import-guide"><summary>查看 {questionFormat.toUpperCase()} 格式示例</summary><pre>{questionFormat === 'txt' ? '题套：基础判断与选择\n说明：客观题示例\n类型：单选\n题目：Python 中用于输出的函数是？\nA. print\nB. input\n答案：A\n解析：print 用于输出。\n分值：2\n---\n类型：判断\n题目：列表是可变对象。\n答案：正确\n分值：2' : questionFormat === 'csv' ? 'set_title,set_description,type,stem_markdown,options_json,answer,explanation_markdown,points\nPython 基础,客观题,单选题,用于输出的函数,"[{""label"":""A"",""content"":""print""},{""label"":""B"",""content"":""input""}]",A,print 用于输出,2' : '{\n  "version": 1,\n  "question_sets": [{\n    "title": "Python 基础",\n    "description": "结构化题套",\n    "questions": [{\n      "type": "true_false",\n      "stem_markdown": "列表是可变对象。",\n      "correct_bool": true,\n      "points": 2,\n      "sort_order": 0,\n      "options": []\n    }]\n  }]\n}'}</pre><p>TXT/CSV 支持单选、多选和判断题；编程题请使用 JSON。缩进续行会并入上一字段。</p></details>
      <label>文件内容<textarea aria-label="习题题库文件内容" rows={14} value={questionContent} onChange={(e) => { setQuestionContent(e.target.value); setQuestionPreview(null) }} placeholder="粘贴内容，或选择文件…" /></label><div className="button-row"><button className="ghost" onClick={previewQuestionImport} disabled={!questionContent || (questionMode === 'append' && !questionSetId)}>预览习题题库</button><button className="primary" onClick={commitQuestionImport} disabled={!questionPreview?.valid}>导入习题题库</button></div>{questionPreview && <div className={questionPreview.valid ? 'import-preview success-box' : 'import-preview error-box'}><strong>{questionPreview.valid ? '内容检查通过' : '内容需要修改'}</strong><p>{questionPreview.question_set_count} 个题套 · {questionPreview.question_count} 道题 · 单选 {questionPreview.counts?.single_choice ?? 0} · 多选 {questionPreview.counts?.multiple_choice ?? 0} · 判断 {questionPreview.counts?.true_false ?? 0} · 编程 {questionPreview.counts?.programming ?? 0}</p>{questionPreview.target && <p>将追加到：{questionPreview.target.title}</p>}{questionPreview.warnings?.map((item: string) => <div key={item}>{item}</div>)}{questionPreview.errors?.map((item: string) => <div key={item}>{item}</div>)}</div>}</div>
    </section>}
  </>
}

