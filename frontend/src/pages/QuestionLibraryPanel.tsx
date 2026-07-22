import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Archive, CheckCircle2, ChevronDown, Code2, Copy, FileUp, GripVertical, Pencil, Play, Plus, RefreshCcw, Trash2, X } from 'lucide-react'
import { api, jsonBody } from '../api'
import type { ExerciseQuestion, ExerciseQuestionType, ProgrammingCase, QuestionOption, QuestionSetSummary } from '../types'

type ImportJob = { id: number; status: string; question_set_id?: number; page_count?: number; question_count?: number; source_filename?: string; error?: string; attempts: number; created_at: string; warnings?: string[]; counts?: Partial<Record<ExerciseQuestionType, number>>; retried_pages?: number[] }
type LlmStatus = { configured: boolean; base_url: string; model: string; batch_pages: number }
type EditableQuestion = Omit<ExerciseQuestion, 'id'> & { id?: number }

const labels: Record<ExerciseQuestionType, string> = {
  single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题', programming: '编程题',
}

const blankQuestion = (sortOrder = 0): EditableQuestion => ({
  type: 'single_choice', stem_markdown: '', explanation_markdown: '', points: 2, sort_order: sortOrder,
  reviewed: false, correct_bool: true, source_page: null, source_asset_id: null, show_source_crop: false,
  options: [
    { label: 'A', content_markdown: '', correct: true, sort_order: 0 },
    { label: 'B', content_markdown: '', correct: false, sort_order: 1 },
  ],
  programming: null,
})

const blankProgram = () => ({
  input_markdown: '', output_markdown: '', constraints_markdown: '', starter_code: '', reference_solution: '',
  time_limit_ms: 1000, memory_limit_mb: 128, cases: [] as ProgrammingCase[],
})

export function reorderQuestionSetList(sets: QuestionSetSummary[], activeId: number, overId: number) {
  const oldIndex = sets.findIndex((item) => item.id === activeId)
  const newIndex = sets.findIndex((item) => item.id === overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return sets
  return arrayMove(sets, oldIndex, newIndex).map((item, index) => ({ ...item, sort_order: index }))
}

export function reorderQuestionList(questions: ExerciseQuestion[], activeId: number, overId: number) {
  const oldIndex = questions.findIndex((item) => item.id === activeId)
  const newIndex = questions.findIndex((item) => item.id === overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return questions
  return arrayMove(questions, oldIndex, newIndex).map((item, index) => ({ ...item, sort_order: index }))
}

export function saveQuestionSetOrder(sets: QuestionSetSummary[]) {
  return api('/api/admin/question-sets/order', { method: 'PUT', ...jsonBody({ question_set_ids: sets.map((item) => item.id) }) })
}

export function saveQuestionOrder(setId: number, questions: ExerciseQuestion[]) {
  return api(`/api/admin/question-sets/${setId}/questions/order`, { method: 'PUT', ...jsonBody({ question_ids: questions.map((item) => item.id) }) })
}

function SortableSetCard({ item, expanded, disabled, children }: { item: QuestionSetSummary; expanded: boolean; disabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled })
  const constrainedTransform = transform ? { ...transform, x: 0 } : null
  return <article id={`question-set-${item.id}`} ref={setNodeRef} style={{ transform: CSS.Transform.toString(constrainedTransform), transition }} className={`card question-set-admin sortable-question-set library-disclosure-card${expanded ? ' expanded' : ' collapsed'}${isDragging ? ' is-dragging' : ''}`}>
    <button type="button" ref={setActivatorNodeRef} className="question-set-drag-handle" disabled={disabled} {...attributes} {...listeners} aria-label={`拖动题套 ${item.title} 调整顺序`} title="拖动调整顺序；也可用键盘操作"><GripVertical /></button>
    {children}
  </article>
}

function SortableQuestionRow({ question, disabled, children }: { question: ExerciseQuestion; disabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: question.id, disabled })
  const constrainedTransform = transform ? { ...transform, x: 0 } : null
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(constrainedTransform), transition }} className={`sortable-question-row${isDragging ? ' is-dragging' : ''}`}>
    <button type="button" ref={setActivatorNodeRef} className="question-drag-handle" disabled={disabled} {...attributes} {...listeners} aria-label="拖动题目调整顺序" title={disabled ? '请先撤回题套再调整题目顺序' : '拖动调整题目顺序；也可用键盘操作'}><GripVertical /></button>
    {children}
  </div>
}

const jobStatus = (job: ImportJob) => job.status === 'ready' ? (job.warnings?.length ? '完成，需核对' : '识别完成') : job.status === 'processing' ? '正在识别' : job.status === 'pending' ? '等待识别' : '识别失败'
const jobStatusClass = (job: ImportJob) => job.status === 'ready' && job.warnings?.length ? 'warning' : job.status
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

export function QuestionLibraryPanel() {
  const [sets, setSets] = useState<QuestionSetSummary[]>([])
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [llm, setLlm] = useState<LlmStatus | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [editor, setEditor] = useState<{ setId: number; question: EditableQuestion } | null>(null)
  const [expandedJobs, setExpandedJobs] = useState<Set<number> | null>(null)
  const [importPanelOpen, setImportPanelOpen] = useState(false)
  const [expandedSets, setExpandedSets] = useState<Set<number>>(new Set())
  const [showAllJobs, setShowAllJobs] = useState(false)
  const [reorderingSets, setReorderingSets] = useState(false)
  const [reorderingQuestionSetId, setReorderingQuestionSetId] = useState<number | null>(null)
  const [activeSetId, setActiveSetId] = useState<number | null>(null)
  const knownJobIds = useRef<Set<number>>(new Set())
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const reload = useCallback(async () => {
    const [setItems, importItems, status] = await Promise.all([
      api<QuestionSetSummary[]>('/api/admin/question-sets'),
      api<ImportJob[]>('/api/admin/question-imports'),
      api<LlmStatus>('/api/admin/import-llm/status'),
    ])
    setSets(setItems); setJobs(importItems); setLlm(status)
    setExpandedJobs((current) => {
      const next = new Set(current ?? [])
      importItems.forEach((job, index) => {
        if (!knownJobIds.current.has(job.id) && (index === 0 || ['pending', 'processing'].includes(job.status))) next.add(job.id)
      })
      knownJobIds.current = new Set(importItems.map((job) => job.id))
      return next
    })
  }, [])

  useEffect(() => { void reload().catch((e) => setError(e.message)) }, [reload])
  const activeJobs = useMemo(() => jobs.some((job) => ['pending', 'processing'].includes(job.status)), [jobs])
  useEffect(() => {
    if (!activeJobs) return
    const timer = window.setInterval(() => void reload().catch(() => {}), 2500)
    return () => window.clearInterval(timer)
  }, [activeJobs, reload])

  const action = async (work: () => Promise<unknown>, success: string) => {
    setError(''); setMessage('')
    try { await work(); await reload(); setMessage(success); return true } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); return false }
  }

  const createSet = (event: React.FormEvent) => {
    event.preventDefault()
    void action(() => api('/api/admin/question-sets', { method: 'POST', ...jsonBody({ title, description }) }), '题套草稿已创建').then((ok) => {
      if (ok) { setTitle(''); setDescription('') }
    })
  }

  const uploadPdf = async (file?: File) => {
    if (!file) return
    setUploading(true); setError(''); setMessage('')
    try {
      const body = new FormData(); body.append('file', file)
      await api('/api/admin/question-imports', { method: 'POST', body })
      await reload(); setMessage('PDF 已进入识别队列')
    } catch (e) { setError(e instanceof Error ? e.message : '上传失败') } finally { setUploading(false) }
  }

  const saveQuestion = async (question: EditableQuestion) => {
    if (!editor) return
    const path = question.id ? `/api/admin/questions/${question.id}` : `/api/admin/question-sets/${editor.setId}/questions`
    const ok = await action(() => api(path, { method: question.id ? 'PUT' : 'POST', ...jsonBody(question) }), question.id ? '题目已保存' : '题目已添加')
    if (ok) setEditor(null)
  }

  const generateOutputs = async (questionId: number) => {
    setError(''); setMessage('正在提交参考程序…')
    try {
      const queued = await api<{ job_id: string }>(`/api/admin/questions/${questionId}/reference-output`, { method: 'POST' })
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        const status = await api<{ status: string; cases?: { status: string }[] }>(`/api/admin/reference-output/${queued.job_id}`)
        if (status.status !== 'queued') {
          await reload()
          const failed = status.cases?.filter((item) => item.status !== 'AC').length ?? 0
          if (failed) setError(`参考程序在 ${failed} 个测试点上运行失败，请检查输入格式和参考程序`)
          else setMessage('样例和候选测试点输出已生成，请校对并确认')
          return
        }
      }
      setMessage('生成仍在进行，可稍后刷新查看')
    } catch (e) { setError(e instanceof Error ? e.message : '生成失败') }
  }

  const finishSetReorder = async ({ active, over }: DragEndEvent) => {
    setActiveSetId(null)
    if (!over || reorderingSets) return
    const previous = sets
    const next = reorderQuestionSetList(previous, Number(active.id), Number(over.id))
    if (next === previous) return
    setSets(next); setReorderingSets(true); setError(''); setMessage('')
    try {
      await saveQuestionSetOrder(next)
      setMessage('题套顺序已保存')
    } catch (e) {
      setSets(previous); setError(e instanceof Error ? e.message : '题套顺序保存失败')
      try { await reload() } catch { /* 保留原始错误 */ }
    } finally { setReorderingSets(false) }
  }

  const finishQuestionReorder = async (setId: number, { active, over }: DragEndEvent) => {
    if (!over || reorderingQuestionSetId != null) return
    const previous = sets
    const currentSet = previous.find((item) => item.id === setId)
    if (!currentSet?.questions) return
    const nextQuestions = reorderQuestionList(currentSet.questions, Number(active.id), Number(over.id))
    if (nextQuestions === currentSet.questions) return
    const next = previous.map((item) => item.id === setId ? { ...item, questions: nextQuestions } : item)
    setSets(next); setReorderingQuestionSetId(setId); setError(''); setMessage('')
    try {
      await saveQuestionOrder(setId, nextQuestions)
      setMessage('题目顺序已保存')
    } catch (e) {
      setSets(previous); setError(e instanceof Error ? e.message : '题目顺序保存失败')
      try { await reload() } catch { /* 保留原始错误 */ }
    } finally { setReorderingQuestionSetId(null) }
  }

  const visibleJobs = showAllJobs ? jobs : jobs.slice(0, 10)
  const activeSet = sets.find((item) => item.id === activeSetId)

  return <>
    <header className="section-title"><div><p className="eyebrow">习题题库</p><h2>题套、识别与自动判题</h2><p>PDF 识别结果先进入草稿，逐题复核后再发布给学生。</p></div></header>
    {message && <p className="notice success">{message}</p>}{error && <p className="notice error">{error}</p>}
    <section className={`card pdf-import-card library-disclosure-card${importPanelOpen ? ' expanded' : ' collapsed'}`}>
      <header className="pdf-import-heading"><button type="button" className="course-disclosure pdf-import-disclosure" aria-expanded={importPanelOpen} aria-label={`${importPanelOpen ? '收起' : '展开'} PDF 智能识别`} onClick={() => setImportPanelOpen((current) => !current)}><ChevronDown className="disclosure-chevron" /><div><h3>PDF 智能识别</h3><p>{llm?.configured ? `已配置 ${llm.model} · ${llm.base_url} · 每批 ${llm.batch_pages} 页` : '尚未配置 IMPORT_LLM 模型，PDF 导入不可用。'}</p></div></button>
      {importPanelOpen && <label className={`file-picker${!llm?.configured ? ' disabled' : ''}`}><FileUp />{uploading ? '正在上传…' : '上传 PDF'}<input type="file" accept="application/pdf,.pdf" disabled={!llm?.configured || uploading} onChange={(e) => void uploadPdf(e.target.files?.[0])} /></label>}
      </header>
      {importPanelOpen && jobs.length > 0 && <div className="import-job-list">{visibleJobs.map((job) => {
        const open = expandedJobs?.has(job.id) ?? false
        return <article className={`import-job-card ${jobStatusClass(job)}`} key={job.id}>
          <header><button type="button" className="import-job-disclosure" aria-expanded={open} onClick={() => setExpandedJobs((current) => { const next = new Set(current ?? []); if (next.has(job.id)) next.delete(job.id); else next.add(job.id); return next })}><ChevronDown /><span><strong>{job.source_filename || `任务 #${job.id}`}</strong><small>任务 #{job.id} · {formatTime(job.created_at)}{job.page_count ? ` · ${job.page_count} 页` : ''}{job.question_count != null ? ` · ${job.question_count} 题` : ''}</small></span><i className={`import-status ${jobStatusClass(job)}`}>{jobStatus(job)}</i></button>
            <div className="import-job-actions">{job.status === 'failed' && <button className="ghost" onClick={() => void action(() => api(`/api/admin/question-imports/${job.id}/retry`, { method: 'POST' }), '已重新排队')}><RefreshCcw />重新识别</button>}{job.status === 'ready' && job.question_set_id && <button className="ghost" onClick={() => document.getElementById(`question-set-${job.question_set_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>查看草稿题套</button>}</div>
          </header>
          {open && <div className="import-job-details">
            <section><h4>识别统计</h4><div className="import-count-grid">{Object.entries(labels).map(([type, label]) => <span key={type}><strong>{job.counts?.[type as ExerciseQuestionType] ?? 0}</strong>{label}</span>)}</div>{job.retried_pages?.length ? <p>定向重试页：{job.retried_pages.join('、')}</p> : <p>没有发生页面重试</p>}</section>
            {!!job.warnings?.length && <section className="import-warning-panel"><h4>需要核对（{job.warnings.length}）</h4><ol>{job.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ol></section>}
            {job.error && <section className="import-error-panel"><div><h4>错误详情</h4><button type="button" className="ghost" onClick={() => void navigator.clipboard?.writeText(job.error || '').then(() => setMessage('错误信息已复制')).catch(() => setError('无法复制错误信息'))}><Copy />复制错误</button></div><pre>{job.error}</pre></section>}
          </div>}
        </article>
      })}{jobs.length > 10 && <button type="button" className="ghost import-show-all" onClick={() => setShowAllJobs((current) => !current)}>{showAllJobs ? '收起历史任务' : `显示全部 ${jobs.length} 项`}</button>}</div>}
    </section>
    <form className="inline-form card" onSubmit={createSet}><label>题套名称<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label><label className="grow">说明<input value={description} onChange={(e) => setDescription(e.target.value)} /></label><button className="primary"><Plus />手动新建题套</button></form>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={({ active }) => setActiveSetId(Number(active.id))} onDragCancel={() => setActiveSetId(null)} onDragEnd={(event) => void finishSetReorder(event)}>
    <SortableContext items={sets.map((item) => item.id)} strategy={verticalListSortingStrategy}>
    <div className={`question-set-admin-list${reorderingSets ? ' is-reordering' : ''}`} aria-busy={reorderingSets}>{sets.map((set) => {
      const setOpen = expandedSets.has(set.id)
      return <SortableSetCard item={set} expanded={setOpen} disabled={reorderingSets || sets.length < 2} key={set.id}>
      <header><button type="button" className="course-disclosure question-set-disclosure grow" aria-expanded={setOpen} aria-label={`${setOpen ? '收起' : '展开'}习题集 ${set.title}`} onClick={() => setExpandedSets((current) => { const next = new Set(current); if (next.has(set.id)) next.delete(set.id); else next.add(set.id); return next })}><ChevronDown className="disclosure-chevron" /><div><div className="question-set-title-row"><h3>{set.title}</h3><span className={`status-pill ${set.status}`}>{set.status === 'published' ? '已发布' : set.status === 'draft' ? '草稿' : '已归档'}</span></div><p>{set.description || '暂无说明'}</p><small>{set.question_count} 题 · {set.total_points} 分 · 单选 {set.counts.single_choice ?? 0} · 多选 {set.counts.multiple_choice ?? 0} · 判断 {set.counts.true_false ?? 0} · 编程 {set.counts.programming ?? 0}</small></div></button>
        {set.status === 'draft' && <><button className="ghost" onClick={() => setEditor({ setId: set.id, question: blankQuestion(set.questions?.length ?? 0) })}><Plus />题目</button><button className="primary" onClick={() => void action(() => api(`/api/admin/question-sets/${set.id}/publish`, { method: 'POST' }), '题套已发布')}><CheckCircle2 />发布</button></>}
        {set.status === 'published' && <button className="ghost" onClick={() => void action(() => api(`/api/admin/question-sets/${set.id}/unpublish`, { method: 'POST' }), '题套已撤回为草稿')}>撤回</button>}
        {set.status !== 'archived' && <button className="ghost" aria-label="归档题套" onClick={() => window.confirm('归档后学生不能再开始该题套，确认继续？') && void action(() => api(`/api/admin/question-sets/${set.id}/archive`, { method: 'POST' }), '题套已归档')}><Archive /></button>}
        {set.status !== 'published' && <button className="danger-button" aria-label={`永久删除题套 ${set.title}`} onClick={() => window.confirm('永久删除该题套？题目、测试点、错题记录、PDF、截图和对应导入记录都会删除；历史成绩仍会保留。') && void action(() => api(`/api/admin/question-sets/${set.id}`, { method: 'DELETE' }), '题套已永久删除')}><Trash2 /></button>}
      </header>
      {setOpen && set.questions && set.questions.length > 0 && <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void finishQuestionReorder(set.id, event)}><SortableContext items={set.questions.map((question) => question.id)} strategy={verticalListSortingStrategy}><div className="question-admin-list">{set.questions.map((question, index) => <SortableQuestionRow question={question} disabled={set.status !== 'draft' || reorderingQuestionSetId != null} key={question.id}>
        <span className="question-number">{index + 1}</span><div className="grow"><strong>{labels[question.type]} · {question.points} 分 {question.reviewed ? '· 已复核' : '· 待复核'}</strong><p>{question.stem_markdown.slice(0, 100)}</p></div>
        {question.type === 'programming' && set.status === 'draft' && <button className="ghost" title="用参考程序生成候选输出" onClick={() => void generateOutputs(question.id)}><Play />生成输出</button>}
        {set.status === 'draft' && <><button className="ghost" onClick={() => setEditor({ setId: set.id, question: JSON.parse(JSON.stringify(question)) })}><Pencil />编辑</button><button className="danger-button" onClick={() => window.confirm('删除这道题？') && void action(() => api(`/api/admin/questions/${question.id}`, { method: 'DELETE' }), '题目已删除')}><Trash2 /></button></>}
      </SortableQuestionRow>)}</div></SortableContext></DndContext>}
    </SortableSetCard>})}</div>
    </SortableContext>
    <DragOverlay>{activeSet && <div className="question-set-drag-overlay card"><GripVertical /><div><strong>{activeSet.title}</strong><small>{activeSet.question_count} 题 · {activeSet.total_points} 分</small></div></div>}</DragOverlay>
    </DndContext>
    {editor && <QuestionEditor value={editor.question} onCancel={() => setEditor(null)} onSave={(value) => void saveQuestion(value)} />}
  </>
}

function QuestionEditor({ value, onCancel, onSave }: { value: EditableQuestion; onCancel: () => void; onSave: (value: EditableQuestion) => void }) {
  const [question, setQuestion] = useState<EditableQuestion>(() => JSON.parse(JSON.stringify(value)))
  const updateOption = (index: number, patch: Partial<QuestionOption>) => setQuestion((current) => ({ ...current, options: current.options.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }))
  const updateCase = (index: number, patch: Partial<ProgrammingCase>) => setQuestion((current) => ({ ...current, programming: current.programming ? { ...current.programming, cases: current.programming.cases.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) } : null }))
  const changeType = (type: ExerciseQuestionType) => setQuestion((current) => ({
    ...current, type, reviewed: false,
    options: type === 'single_choice' || type === 'multiple_choice' ? (current.options.length >= 2 ? current.options : blankQuestion().options) : [],
    programming: type === 'programming' ? (current.programming || blankProgram()) : null,
    correct_bool: type === 'true_false' ? (current.correct_bool ?? true) : null,
    points: type === 'programming' && current.points === 2 ? 25 : current.points,
  }))
  return <div className="modal-backdrop" role="presentation"><form className="question-editor-modal card" onSubmit={(e) => { e.preventDefault(); onSave(question) }}>
    <header><div><p className="eyebrow">题目编辑</p><h2>{question.id ? '校对题目' : '添加题目'}</h2></div><button type="button" className="ghost" aria-label="关闭" onClick={onCancel}><X /></button></header>
    <div className="question-editor-grid"><label>题型<select value={question.type} onChange={(e) => changeType(e.target.value as ExerciseQuestionType)}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>分值<input type="number" min="1" value={question.points} onChange={(e) => setQuestion({ ...question, points: Number(e.target.value) })} /></label><label className="check-label"><input type="checkbox" checked={question.reviewed ?? false} onChange={(e) => setQuestion({ ...question, reviewed: e.target.checked })} />已人工复核</label></div>
    <label>题面<textarea rows={7} value={question.stem_markdown} onChange={(e) => setQuestion({ ...question, stem_markdown: e.target.value, reviewed: false })} required /></label>
    {question.source_asset_id && <label className="check-label"><input type="checkbox" checked={question.show_source_crop ?? false} onChange={(e) => setQuestion({ ...question, show_source_crop: e.target.checked })} />向学生显示原题截图</label>}
    {question.show_source_crop && question.source_asset_id && <img className="question-source-preview" src={`/api/question-assets/${question.source_asset_id}`} alt="原题截图" />}
    {(question.type === 'single_choice' || question.type === 'multiple_choice') && <section className="option-editor"><h3>选项与答案</h3>{question.options.map((option, index) => <div key={index}><input aria-label={`选项 ${index + 1} 标签`} value={option.label} onChange={(e) => updateOption(index, { label: e.target.value })} /><textarea aria-label={`选项 ${index + 1} 内容`} rows={2} value={option.content_markdown} onChange={(e) => updateOption(index, { content_markdown: e.target.value })} required /><label className="check-label"><input type={question.type === 'single_choice' ? 'radio' : 'checkbox'} name="correct-option" checked={option.correct ?? false} onChange={(e) => setQuestion((current) => ({ ...current, reviewed: false, options: current.options.map((item, itemIndex) => ({ ...item, correct: question.type === 'single_choice' ? itemIndex === index : itemIndex === index ? e.target.checked : item.correct })) }))} />正确</label><button type="button" className="danger-button" onClick={() => setQuestion({ ...question, options: question.options.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 /></button></div>)}<button type="button" className="ghost" onClick={() => setQuestion({ ...question, options: [...question.options, { label: String.fromCharCode(65 + question.options.length), content_markdown: '', correct: false, sort_order: question.options.length }] })}><Plus />添加选项</button></section>}
    {question.type === 'true_false' && <label>正确答案<select required value={question.correct_bool == null ? '' : String(question.correct_bool)} onChange={(e) => setQuestion({ ...question, correct_bool: e.target.value === '' ? null : e.target.value === 'true', reviewed: false })}><option value="" disabled>请选择正确答案</option><option value="true">正确</option><option value="false">错误</option></select></label>}
    {question.type === 'programming' && question.programming && <ProgrammingEditor program={question.programming} setProgram={(programming) => setQuestion({ ...question, programming, reviewed: false })} updateCase={updateCase} />}
    <label>答案解析<textarea rows={5} value={question.explanation_markdown ?? ''} onChange={(e) => setQuestion({ ...question, explanation_markdown: e.target.value })} /></label>
    <div className="button-row"><button type="button" className="ghost" onClick={onCancel}>取消</button><button className="primary">保存题目</button></div>
  </form></div>
}

function ProgrammingEditor({ program, setProgram, updateCase }: { program: NonNullable<EditableQuestion['programming']>; setProgram: (program: NonNullable<EditableQuestion['programming']>) => void; updateCase: (index: number, patch: Partial<ProgrammingCase>) => void }) {
  return <section className="program-editor"><div className="section-title"><div><h3><Code2 />编程规格</h3></div></div>
    <div className="question-editor-grid"><label>时间限制（ms）<input type="number" min="100" max="5000" value={program.time_limit_ms} onChange={(e) => setProgram({ ...program, time_limit_ms: Number(e.target.value) })} /></label><label>内存限制（MB）<input type="number" min="32" max="512" value={program.memory_limit_mb} onChange={(e) => setProgram({ ...program, memory_limit_mb: Number(e.target.value) })} /></label></div>
    <label>输入格式<textarea rows={3} value={program.input_markdown} onChange={(e) => setProgram({ ...program, input_markdown: e.target.value })} /></label><label>输出格式<textarea rows={3} value={program.output_markdown} onChange={(e) => setProgram({ ...program, output_markdown: e.target.value })} /></label><label>数据范围<textarea rows={3} value={program.constraints_markdown} onChange={(e) => setProgram({ ...program, constraints_markdown: e.target.value })} /></label><label>初始代码<textarea className="code-input" rows={5} value={program.starter_code} onChange={(e) => setProgram({ ...program, starter_code: e.target.value })} /></label><label>参考程序<textarea className="code-input" rows={10} value={program.reference_solution ?? ''} onChange={(e) => setProgram({ ...program, reference_solution: e.target.value })} /></label>
    <h3>测试点</h3>{program.cases.map((item, index) => <div className="case-editor" key={item.id ?? index}><div><strong>{item.is_sample ? '公开样例' : '隐藏测试点'}</strong><label className="check-label"><input type="checkbox" checked={item.is_sample} onChange={(e) => updateCase(index, { is_sample: e.target.checked, weight: e.target.checked ? 0 : item.weight })} />公开</label>{!item.is_sample && <label className="check-label"><input type="checkbox" checked={item.confirmed ?? false} onChange={(e) => updateCase(index, { confirmed: e.target.checked })} />已确认</label>}</div><label>输入<textarea className="code-input" rows={3} value={item.input_data} onChange={(e) => updateCase(index, { input_data: e.target.value, confirmed: false })} /></label><label>期望输出<textarea className="code-input" rows={3} value={item.expected_output} onChange={(e) => updateCase(index, { expected_output: e.target.value, confirmed: false })} /></label>{!item.is_sample && <label>权重<input type="number" min="0" value={item.weight} onChange={(e) => updateCase(index, { weight: Number(e.target.value), confirmed: false })} /></label>}<button type="button" className="danger-button" onClick={() => setProgram({ ...program, cases: program.cases.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 />删除测试点</button></div>)}
    <button type="button" className="ghost" onClick={() => setProgram({ ...program, cases: [...program.cases, { input_data: '', expected_output: '', is_sample: false, weight: 0, confirmed: false, note: '' }] })}><Plus />添加测试点</button>
  </section>
}
