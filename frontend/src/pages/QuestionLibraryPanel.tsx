import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Archive, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleStop, Code2, Copy, Eye, FileUp, GripVertical, LoaderCircle, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Play, Plus, RefreshCcw, Trash2, X } from 'lucide-react'
import { api, jsonBody } from '../api'
import type { AdminNotifier } from '../components/AdminToast'
import type { ExerciseQuestion, ExerciseQuestionType, ProgrammingCase, QuestionBlank, QuestionOption, QuestionSetSummary } from '../types'

type InvalidImportQuestion = { index: number; source_page: number; number?: string; errors: string[]; repair_attempted: boolean }
type JobProgress = { phase: string; label: string; percent: number; current?: number | null; total?: number | null; unit?: 'page' | 'batch' | 'question' | null; detail?: string; updated_at?: string }
type JobStatus = 'pending' | 'processing' | 'ready' | 'applied' | 'failed' | 'cancelled'
type ImportJob = { id: number; status: JobStatus; question_set_id?: number; page_count?: number; question_count?: number; source_filename?: string; error?: string; attempts: number; created_at: string; warnings?: string[]; counts?: Partial<Record<ExerciseQuestionType, number>>; retried_pages?: number[]; invalid_count?: number; invalid_questions?: InvalidImportQuestion[]; progress?: JobProgress }
type LlmStatus = { configured: boolean; base_url: string; model: string; reasoning_effort?: string | null; batch_pages: number }
type EditableQuestion = Omit<ExerciseQuestion, 'id'> & { id?: number }
type ReviewFilter = 'pending' | 'reviewed' | 'all'
type EditorState = { setId: number; setTitle: string; question: EditableQuestion; filter: ReviewFilter; queueIds: number[]; readOnly: boolean }
type ReferenceCasePreview = { id: number; status: string; stable: boolean; current_output: string; candidate_output: string; runs?: { status: string; stdout?: string; stderr?: string }[] }
type ReferencePreview = { job_id: string; question_id: number; status: string; stale: boolean; cases: ReferenceCasePreview[] }
type RecognitionChange = { status: 'matched' | 'added' | 'unmatched' | 'invalid'; question_id?: number | null; current?: ExerciseQuestion | null; candidate?: EditableQuestion | null; changed_fields: string[]; validation_errors?: string[]; repair_attempted?: boolean }
type RecognitionJob = { id: number; scope: 'set' | 'question'; status: JobStatus; target_set_id: number; target_question_id?: number | null; model: string; reasoning_effort?: string | null; attempts: number; error?: string; stale: boolean; progress?: JobProgress; result?: { title?: string; description?: string; changes?: RecognitionChange[]; diagnostics?: { warnings?: string[]; invalid_count?: number } }; created_at: string; updated_at?: string }

const labels: Record<ExerciseQuestionType, string> = {
  single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题', fill_blank: '填空题', programming: '编程题',
}
const ignoreNotification: AdminNotifier = () => {}

const blankQuestion = (sortOrder = 0): EditableQuestion => ({
  type: 'single_choice', stem_markdown: '', explanation_markdown: '', points: 2, sort_order: sortOrder,
  reviewed: false, correct_bool: true, source_page: null, source_end_page: null, source_section: '', source_number: '', recognition_confidence: null, recognition_warnings: [], source_asset_id: null, stem_image_asset_id: null, show_source_crop: false,
  options: [
    { label: 'A', content_markdown: '', correct: true, sort_order: 0 },
    { label: 'B', content_markdown: '', correct: false, sort_order: 1 },
  ],
  blanks: [],
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

const activeJobStatuses: JobStatus[] = ['pending', 'processing']
const jobStatus = (job: ImportJob) => job.status === 'ready' ? (job.warnings?.length ? '完成，需核对' : '识别完成') : job.status === 'processing' ? '正在识别' : job.status === 'pending' ? '等待识别' : job.status === 'cancelled' ? '已终止' : '识别失败'
const jobStatusClass = (job: ImportJob) => job.status === 'ready' && job.warnings?.length ? 'warning' : job.status
const recognitionStatusLabel = (status: JobStatus) => status === 'ready' ? '待确认' : status === 'processing' ? '识别中' : status === 'pending' ? '等待中' : status === 'failed' ? '失败' : status === 'cancelled' ? '已终止' : '已应用'
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
const questionMatchesFilter = (question: ExerciseQuestion, filter: ReviewFilter) => filter === 'all' || (filter === 'reviewed' ? question.reviewed : !question.reviewed)
const cloneQuestion = <T extends EditableQuestion>(question: T): T => JSON.parse(JSON.stringify(question)) as T

const progressUnitLabel: Record<string, string> = { page: '页', batch: '批', question: '题' }
const elapsedLabel = (value?: string) => {
  if (!value) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

function JobProgressView({ progress, status, compact = false }: { progress?: JobProgress; status: JobStatus; compact?: boolean }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? (status === 'ready' || status === 'applied' ? 100 : 0))))
  const counter = progress?.current != null && progress?.total != null
    ? `${progress.current} / ${progress.total}${progress.unit ? ` ${progressUnitLabel[progress.unit] || progress.unit}` : ''}`
    : ''
  const waiting = status === 'processing' && progress?.updated_at ? elapsedLabel(progress.updated_at) : ''
  return <div className={`job-progress-view${compact ? ' compact' : ''}`}>
    <div className="job-progress-heading"><strong>{progress?.label || (status === 'pending' ? '等待识别' : '正在识别')}</strong><span>{percent}%{counter ? ` · ${counter}` : ''}</span></div>
    <div className="job-progress-bar" role="progressbar" aria-label={progress?.label || '识别进度'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div>
    {!compact && <p>{progress?.detail || '任务正在后台处理'}{waiting ? ` · 本阶段已等待 ${waiting}` : ''}</p>}
  </div>
}

function QuestionSetActionsMenu({ item, recognitionJob, onUploadPdf, onRecognize, onArchive, onDelete }: {
  item: QuestionSetSummary
  recognitionJob?: RecognitionJob
  onUploadPdf: (file?: File) => Promise<void>
  onRecognize: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const recognitionActive = !!recognitionJob && activeJobStatuses.includes(recognitionJob.status)
  const recognitionPercent = Math.round(recognitionJob?.progress?.percent ?? 0)
  const draft = item.status === 'draft'
  const recognitionAvailable = draft && !!item.source_pdf_asset_id
  const draftOnlyReason = item.status === 'published' ? '请先将题套撤回为草稿' : '仅草稿题套可操作'
  const recognitionDisabledReason = !draft ? draftOnlyReason : !item.source_pdf_asset_id ? '请先上传原始 PDF' : recognitionActive ? '整套重新识别正在运行' : ''

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    if (!open) return
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
    first?.focus()
    const pointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true) }
    }
    document.addEventListener('pointerdown', pointerDown)
    document.addEventListener('keydown', keyDown)
    return () => {
      document.removeEventListener('pointerdown', pointerDown)
      document.removeEventListener('keydown', keyDown)
    }
  }, [close, open])

  const run = (callback: () => void) => { close(true); callback() }
  const navigateMenu = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
    if (!items.length) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return <div className="question-set-more" ref={rootRef}>
    <button ref={triggerRef} type="button" className="ghost icon-button question-set-more-trigger" aria-label={recognitionActive ? `更多操作，整套识别 ${recognitionPercent}%` : `更多操作 ${item.title}`} title="更多操作" aria-haspopup="menu" aria-expanded={open} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }} onClick={() => setOpen((current) => !current)}><MoreHorizontal />{recognitionActive && <RefreshCcw className="question-set-menu-activity is-spinning" />}</button>
    {open && <div className="question-set-menu" role="menu" aria-label={`${item.title}操作菜单`} ref={menuRef} onKeyDown={navigateMenu}>
      <button type="button" role="menuitem" disabled={!draft} title={draft ? '' : draftOnlyReason} onClick={() => fileRef.current?.click()}><FileUp /><span>{item.source_pdf_asset_id ? '替换原始 PDF' : '上传原始 PDF'}{!draft && <small>{draftOnlyReason}</small>}</span></button>
      <input ref={fileRef} className="question-set-menu-file" aria-label={`上传题套 ${item.title} 原始 PDF`} type="file" accept="application/pdf,.pdf" disabled={!draft} onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; close(); void onUploadPdf(file).finally(() => { input.value = '' }) }} />
      <button type="button" role="menuitem" disabled={!recognitionAvailable || recognitionActive} title={recognitionDisabledReason} onClick={() => run(onRecognize)}><RefreshCcw className={recognitionActive ? 'is-spinning' : ''} /><span>整套重新识别{recognitionActive ? <small>识别中 {recognitionPercent}%</small> : !draft ? <small>{draftOnlyReason}</small> : !item.source_pdf_asset_id ? <small>需要原始 PDF</small> : null}</span></button>
      {item.status !== 'archived' && <button type="button" role="menuitem" onClick={() => run(onArchive)}><Archive /><span>归档题套</span></button>}
      {item.status !== 'published' && <><div className="question-set-menu-separator" role="separator" /><button type="button" role="menuitem" className="danger" onClick={() => run(onDelete)}><Trash2 /><span>永久删除题套</span></button></>}
    </div>}
  </div>
}

export function QuestionLibraryPanel({ notify = ignoreNotification }: { notify?: AdminNotifier }) {
  const [sets, setSets] = useState<QuestionSetSummary[]>([])
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [llm, setLlm] = useState<LlmStatus | null>(null)
  const [loadError, setLoadError] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [expandedJobs, setExpandedJobs] = useState<Set<number> | null>(null)
  const [importPanelOpen, setImportPanelOpen] = useState(false)
  const [expandedSets, setExpandedSets] = useState<Set<number>>(new Set())
  const [showAllJobs, setShowAllJobs] = useState(false)
  const [reorderingSets, setReorderingSets] = useState(false)
  const [reorderingQuestionSetId, setReorderingQuestionSetId] = useState<number | null>(null)
  const [activeSetId, setActiveSetId] = useState<number | null>(null)
  const [reviewFilters, setReviewFilters] = useState<Record<number, ReviewFilter>>({})
  const [referencePreview, setReferencePreview] = useState<ReferencePreview | null>(null)
  const [recognitionJobs, setRecognitionJobs] = useState<RecognitionJob[]>([])
  const [recognitionPreviewId, setRecognitionPreviewId] = useState<number | null>(null)
  const [recognitionDetail, setRecognitionDetail] = useState<RecognitionJob | null>(null)
  const [cancellingJobs, setCancellingJobs] = useState<Set<string>>(new Set())
  const knownJobIds = useRef<Set<number>>(new Set())
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const reload = useCallback(async () => {
    const [setItems, importItems, status, recognitionItems] = await Promise.all([
      api<QuestionSetSummary[]>('/api/admin/question-sets'),
      api<ImportJob[]>('/api/admin/question-imports'),
      api<LlmStatus>('/api/admin/import-llm/status'),
      api<RecognitionJob[]>('/api/admin/question-recognition-jobs'),
    ])
    setSets(setItems); setJobs(importItems); setLlm(status); setRecognitionJobs(Array.isArray(recognitionItems) ? recognitionItems : [])
    setExpandedJobs((current) => {
      const next = new Set(current ?? [])
      importItems.forEach((job, index) => {
        if (!knownJobIds.current.has(job.id) && (index === 0 || activeJobStatuses.includes(job.status))) next.add(job.id)
      })
      knownJobIds.current = new Set(importItems.map((job) => job.id))
      return next
    })
  }, [])

  useEffect(() => { void reload().then(() => setLoadError('')).catch((e) => setLoadError(e.message)) }, [reload])
  const activeJobs = useMemo(() => jobs.some((job) => activeJobStatuses.includes(job.status)) || recognitionJobs.some((job) => activeJobStatuses.includes(job.status)), [jobs, recognitionJobs])
  useEffect(() => {
    if (!activeJobs) return
    const timer = window.setInterval(() => void reload().catch(() => {}), 2500)
    return () => window.clearInterval(timer)
  }, [activeJobs, reload])
  useEffect(() => {
    if (recognitionPreviewId == null) return
    const summary = recognitionJobs.find((item) => item.id === recognitionPreviewId)
    if (!summary) return
    if (recognitionDetail?.id === summary.id && recognitionDetail.status === summary.status && (summary.status !== 'ready' || recognitionDetail.result)) return
    void api<RecognitionJob>(`/api/admin/question-recognition-jobs/${summary.id}`).then(setRecognitionDetail).catch((e) => notify('error', e instanceof Error ? e.message : '读取重新识别结果失败'))
  }, [notify, recognitionDetail?.id, recognitionDetail?.result, recognitionDetail?.status, recognitionJobs, recognitionPreviewId])

  const action = async (work: () => Promise<unknown>, success: string) => {
    try { await work(); await reload(); notify('success', success); return true } catch (e) { notify('error', e instanceof Error ? e.message : '操作失败'); return false }
  }

  const createSet = (event: React.FormEvent) => {
    event.preventDefault()
    void action(() => api('/api/admin/question-sets', { method: 'POST', ...jsonBody({ title, description }) }), '题套草稿已创建').then((ok) => {
      if (ok) { setTitle(''); setDescription('') }
    })
  }

  const uploadPdf = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try {
      const body = new FormData(); body.append('file', file)
      await api('/api/admin/question-imports', { method: 'POST', body })
      await reload(); notify('success', 'PDF 已进入识别队列')
    } catch (e) { notify('error', e instanceof Error ? e.message : '上传失败') } finally { setUploading(false) }
  }

  const uploadSetSourcePdf = async (set: QuestionSetSummary, file?: File) => {
    if (!file) return
    const body = new FormData(); body.append('file', file)
    await action(
      () => api(`/api/admin/question-sets/${set.id}/source-pdf`, { method: 'PUT', body }),
      `题套《${set.title}》原始 PDF 已更新，全部题目已恢复为待复核`,
    )
  }

  const setReviewFilterForSet = (setId: number, filter: ReviewFilter) => {
    setReviewFilters((current) => ({ ...current, [setId]: filter }))
    setExpandedSets((current) => new Set(current).add(setId))
  }

  const cancelJob = async (kind: 'import' | 'recognition', jobId: number) => {
    const key = `${kind}-${jobId}`
    if (cancellingJobs.has(key) || !window.confirm('确认终止这个识别任务？当前模型请求会被取消，已生成但未完成的结果不会应用。')) return
    setCancellingJobs((current) => new Set(current).add(key))
    try {
      const path = kind === 'import' ? `/api/admin/question-imports/${jobId}/cancel` : `/api/admin/question-recognition-jobs/${jobId}/cancel`
      await action(() => api(path, { method: 'POST' }), '识别任务已终止，可稍后重新排队')
    } finally {
      setCancellingJobs((current) => { const next = new Set(current); next.delete(key); return next })
    }
  }

  const openQuestionEditor = (set: QuestionSetSummary, question: ExerciseQuestion) => {
    const readOnly = set.status !== 'draft'
    const filter = readOnly ? 'all' : (reviewFilters[set.id] ?? 'pending')
    const queueIds = (set.questions || []).filter((item) => questionMatchesFilter(item, filter)).map((item) => item.id)
    setEditor({ setId: set.id, setTitle: set.title, question: cloneQuestion(question), filter, queueIds, readOnly })
  }

  const openNewQuestion = (set: QuestionSetSummary) => {
    setEditor({ setId: set.id, setTitle: set.title, question: blankQuestion(set.questions?.length ?? 0), filter: reviewFilters[set.id] ?? 'pending', queueIds: [], readOnly: false })
  }

  const saveQuestion = async (question: EditableQuestion, review = false, advance = false) => {
    if (!editor) return
    const path = question.id ? `/api/admin/questions/${question.id}` : `/api/admin/question-sets/${editor.setId}/questions`
    try {
      let saved = await api<ExerciseQuestion>(path, { method: question.id ? 'PUT' : 'POST', ...jsonBody(question) })
      if (review) saved = await api<ExerciseQuestion>(`/api/admin/questions/${saved.id}/review`, { method: 'PATCH', ...jsonBody({ reviewed: true }) })
      const currentIndex = editor.queueIds.indexOf(saved.id)
      const nextId = advance && currentIndex >= 0 ? editor.queueIds[currentIndex + 1] : undefined
      const next = nextId == null ? undefined : sets.find((item) => item.id === editor.setId)?.questions?.find((item) => item.id === nextId)
      await reload()
      if (advance) {
        if (next) setEditor((current) => current ? { ...current, question: cloneQuestion(next) } : current)
        else setEditor(null)
      } else if (question.id) {
        setEditor((current) => current ? { ...current, question: cloneQuestion(saved) } : current)
      } else {
        setEditor(null)
      }
      notify('success', review ? (next ? '已复核，已进入当前题套的下一题' : '当前过滤队列已复核完成') : (question.id ? '题目草稿已保存' : '题目已添加'))
    } catch (e) { notify('error', e instanceof Error ? e.message : '题目保存失败') }
  }

  const navigateEditor = (offset: number) => {
    if (!editor?.question.id) return
    const index = editor.queueIds.indexOf(editor.question.id)
    if (index < 0) return
    const nextId = editor.queueIds[index + offset]
    const next = sets.find((item) => item.id === editor.setId)?.questions?.find((item) => item.id === nextId)
    if (next) setEditor((current) => current ? { ...current, question: cloneQuestion(next) } : current)
  }

  const uploadSourceImage = async (questionId: number, file: File) => {
    const body = new FormData(); body.append('file', file)
    const updated = await api<ExerciseQuestion>(`/api/admin/questions/${questionId}/source-image`, { method: 'PUT', body })
    setEditor((current) => current ? { ...current, question: cloneQuestion(updated) } : current)
    await reload(); notify('success', '原题图片已替换，题目已恢复为待复核')
    return updated
  }

  const uploadStemImage = async (questionId: number, file: File) => {
    const body = new FormData(); body.append('file', file)
    const updated = await api<ExerciseQuestion>(`/api/admin/questions/${questionId}/stem-image`, { method: 'PUT', body })
    setEditor((current) => current ? { ...current, question: cloneQuestion(updated) } : current)
    await reload(); notify('success', '题干配图已更新，题目已恢复为待复核')
    return updated
  }

  const removeStemImage = async (questionId: number) => {
    const updated = await api<ExerciseQuestion>(`/api/admin/questions/${questionId}/stem-image`, { method: 'DELETE' })
    setEditor((current) => current ? { ...current, question: cloneQuestion(updated) } : current)
    await reload(); notify('success', '题干配图已移除，题目已恢复为待复核')
    return updated
  }

  const startRecognition = async (path: string) => {
    notify('info', '正在创建重新识别任务…')
    try {
      const job = await api<RecognitionJob>(path, { method: 'POST' })
      setRecognitionPreviewId(job.id)
      setRecognitionDetail(job)
      await reload()
      notify('success', job.scope === 'set' ? '整套题目已进入重新识别队列' : '当前题目已进入重新识别队列')
    } catch (e) { notify('error', e instanceof Error ? e.message : '创建重新识别任务失败') }
  }

  const retryRecognition = async (jobId: number) => {
    const ok = await action(() => api(`/api/admin/question-recognition-jobs/${jobId}/retry`, { method: 'POST' }), '重新识别任务已重新排队')
    if (ok) setRecognitionPreviewId(jobId)
  }

  const applyRecognition = async (jobId: number) => {
    const ok = await action(() => api(`/api/admin/question-recognition-jobs/${jobId}/apply`, { method: 'POST' }), '重新识别结果已应用，相关题目已恢复为待复核')
    if (ok) {
      setRecognitionPreviewId(null)
      setRecognitionDetail(null)
      setEditor(null)
    }
  }

  const openRecognitionPreview = async (jobId: number) => {
    setRecognitionPreviewId(jobId)
    try { setRecognitionDetail(await api<RecognitionJob>(`/api/admin/question-recognition-jobs/${jobId}`)) }
    catch (e) { notify('error', e instanceof Error ? e.message : '读取重新识别结果失败') }
  }

  const generateOutputs = async (questionId: number) => {
    notify('info', '正在提交参考程序…')
    try {
      const queued = await api<{ job_id: string }>(`/api/admin/questions/${questionId}/reference-output`, { method: 'POST' })
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        const status = await api<ReferencePreview>(`/api/admin/reference-output/${queued.job_id}`)
        if (status.status !== 'queued') {
          setReferencePreview(status)
          const failed = status.cases.filter((item) => item.status !== 'AC' || !item.stable).length
          if (failed) notify('error', `${failed} 个测试点运行失败或两次输出不一致，不能应用这些输出`)
          else notify('success', '候选输出已生成，请预览差异后确认')
          return
        }
      }
      notify('info', '生成仍在进行，可稍后刷新查看')
    } catch (e) { notify('error', e instanceof Error ? e.message : '生成失败') }
  }

  const applyReferenceOutputs = async () => {
    if (!referencePreview) return
    const caseIds = referencePreview.cases.filter((item) => item.status === 'AC' && item.stable).map((item) => item.id)
    if (!caseIds.length) return
    const ok = await action(() => api(`/api/admin/reference-output/${referencePreview.job_id}/apply`, { method: 'POST', ...jsonBody({ case_ids: caseIds }) }), '稳定输出已应用；隐藏测试点需重新确认')
    if (ok) setReferencePreview(null)
  }

  const finishSetReorder = async ({ active, over }: DragEndEvent) => {
    setActiveSetId(null)
    if (!over || reorderingSets) return
    const previous = sets
    const next = reorderQuestionSetList(previous, Number(active.id), Number(over.id))
    if (next === previous) return
    setSets(next); setReorderingSets(true)
    try {
      await saveQuestionSetOrder(next)
      notify('success', '题套顺序已保存')
    } catch (e) {
      setSets(previous); notify('error', e instanceof Error ? e.message : '题套顺序保存失败')
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
    setSets(next); setReorderingQuestionSetId(setId)
    try {
      await saveQuestionOrder(setId, nextQuestions)
      notify('success', '题目顺序已保存')
    } catch (e) {
      setSets(previous); notify('error', e instanceof Error ? e.message : '题目顺序保存失败')
      try { await reload() } catch { /* 保留原始错误 */ }
    } finally { setReorderingQuestionSetId(null) }
  }

  const visibleJobs = showAllJobs ? jobs : jobs.slice(0, 10)
  const activeSet = sets.find((item) => item.id === activeSetId)
  const editorQueueIndex = editor?.question.id ? editor.queueIds.indexOf(editor.question.id) : -1
  const recognitionSummary = recognitionJobs.find((item) => item.id === recognitionPreviewId)
  const recognitionPreview = recognitionDetail?.id === recognitionPreviewId
    ? { ...recognitionDetail, ...recognitionSummary, result: recognitionDetail.result }
    : recognitionSummary ?? null
  const editorRecognitionJob = editor?.question.id ? recognitionJobs.find((job) => job.target_set_id === editor.setId && (job.target_question_id == null || job.target_question_id === editor.question.id) && activeJobStatuses.includes(job.status)) : undefined

  return <>
    <header className="section-title"><div><p className="eyebrow">习题题库</p><h2>题套、识别与自动判题</h2><p>PDF 识别结果先进入草稿，逐题复核后再发布给学生。</p></div></header>
    {loadError && <p className="notice error" role="alert">{loadError}</p>}
    <section className={`card pdf-import-card library-disclosure-card${importPanelOpen ? ' expanded' : ' collapsed'}`}>
      <header className="pdf-import-heading"><button type="button" className="course-disclosure pdf-import-disclosure" aria-expanded={importPanelOpen} aria-label={`${importPanelOpen ? '收起' : '展开'} PDF 智能识别`} onClick={() => setImportPanelOpen((current) => !current)}><ChevronDown className="disclosure-chevron" /><div><h3>PDF 智能识别</h3><p>{llm?.configured ? `已配置 ${llm.model} · ${llm.base_url} · 每批 ${llm.batch_pages} 页 · 思考级别：${llm.reasoning_effort || '模型默认'}` : '尚未配置 IMPORT_LLM 模型，PDF 导入不可用。'}</p></div></button>
      {importPanelOpen && <label className={`file-picker${!llm?.configured ? ' disabled' : ''}`}><FileUp />{uploading ? '正在上传…' : '上传 PDF'}<input type="file" accept="application/pdf,.pdf" disabled={!llm?.configured || uploading} onChange={(e) => void uploadPdf(e.target.files?.[0])} /></label>}
      </header>
      {importPanelOpen && jobs.length > 0 && <div className="import-job-list">{visibleJobs.map((job) => {
        const open = expandedJobs?.has(job.id) ?? false
        return <article className={`import-job-card ${jobStatusClass(job)}`} key={job.id}>
          <header><button type="button" className="import-job-disclosure" aria-expanded={open} onClick={() => setExpandedJobs((current) => { const next = new Set(current ?? []); if (next.has(job.id)) next.delete(job.id); else next.add(job.id); return next })}><ChevronDown /><span><strong>{job.source_filename || `任务 #${job.id}`}</strong><small>任务 #{job.id} · {formatTime(job.created_at)}{job.page_count ? ` · ${job.page_count} 页` : ''}{job.question_count != null ? ` · ${job.question_count} 题` : ''}</small></span><i className={`import-status ${jobStatusClass(job)}`}>{jobStatus(job)}</i></button>
            <div className="import-job-actions">{activeJobStatuses.includes(job.status) && <button className="ghost danger-button" disabled={cancellingJobs.has(`import-${job.id}`)} onClick={() => void cancelJob('import', job.id)}><CircleStop />{cancellingJobs.has(`import-${job.id}`) ? '正在终止…' : '终止任务'}</button>}{['failed', 'cancelled'].includes(job.status) && <button className="ghost" onClick={() => void action(() => api(`/api/admin/question-imports/${job.id}/retry`, { method: 'POST' }), '已重新排队')}><RefreshCcw />重新识别</button>}{job.status === 'ready' && job.question_set_id && <button className="ghost" onClick={() => document.getElementById(`question-set-${job.question_set_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>查看草稿题套</button>}</div>
          </header>
          {open && <div className="import-job-details">
            {job.progress && <JobProgressView progress={job.progress} status={job.status} />}
            <section><h4>识别统计</h4><div className="import-count-grid">{Object.entries(labels).map(([type, label]) => <span key={type}><strong>{job.counts?.[type as ExerciseQuestionType] ?? 0}</strong>{label}</span>)}</div>{job.retried_pages?.length ? <p>定向重试页：{job.retried_pages.join('、')}</p> : <p>没有发生页面重试</p>}</section>
            {!!job.invalid_count && <section className="import-invalid-panel"><h4>已导入但需人工补全（{job.invalid_count}）</h4><p>这些题目已保留在草稿中，补齐答案或结构后才能复核发布。</p><ol>{job.invalid_questions?.map((item) => <li key={`${item.index}-${item.source_page}`}><strong>第 {item.source_page} 页{item.number ? ` · 题号 ${item.number}` : ` · 第 ${item.index} 个候选`}</strong><span>{item.errors.join('；')}{item.repair_attempted ? '（已尝试高清修复）' : ''}</span></li>)}</ol></section>}
            {!!job.warnings?.length && <section className="import-warning-panel"><h4>需要核对（{job.warnings.length}）</h4><ol>{job.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ol></section>}
            {job.status === 'cancelled' && <p className="notice warning">{job.error || '管理员手动终止'}</p>}
            {job.error && job.status !== 'cancelled' && <section className="import-error-panel"><div><h4>错误详情</h4><button type="button" className="ghost" onClick={() => void navigator.clipboard?.writeText(job.error || '').then(() => notify('success', '错误信息已复制')).catch(() => notify('error', '无法复制错误信息'))}><Copy />复制错误</button></div><pre>{job.error}</pre></section>}
          </div>}
        </article>
      })}{jobs.length > 10 && <button type="button" className="ghost import-show-all" onClick={() => setShowAllJobs((current) => !current)}>{showAllJobs ? '收起历史任务' : `显示全部 ${jobs.length} 项`}</button>}</div>}
      {importPanelOpen && recognitionJobs.length > 0 && <div className="recognition-job-strip"><h4>重新识别任务</h4>{recognitionJobs.slice(0, 10).map((job) => <div className={`recognition-job-row ${job.status}`} key={job.id}><button type="button" className="ghost recognition-job-open" onClick={() => void openRecognitionPreview(job.id)}><RefreshCcw className={activeJobStatuses.includes(job.status) ? 'is-spinning' : ''} /><span>{job.scope === 'set' ? `题套 #${job.target_set_id}` : `题目 #${job.target_question_id}`}</span><em>{recognitionStatusLabel(job.status)}{activeJobStatuses.includes(job.status) ? ` ${Math.round(job.progress?.percent ?? 0)}%` : ''}</em>{activeJobStatuses.includes(job.status) && <JobProgressView progress={job.progress} status={job.status} compact />}</button>{activeJobStatuses.includes(job.status) && <button type="button" className="ghost danger-button recognition-job-cancel" aria-label={`终止${job.scope === 'set' ? `题套 ${job.target_set_id}` : `题目 ${job.target_question_id}`}重新识别`} disabled={cancellingJobs.has(`recognition-${job.id}`)} onClick={() => void cancelJob('recognition', job.id)}><CircleStop /></button>}</div>)}</div>}
    </section>
    <form className="inline-form card" onSubmit={createSet}><label>题套名称<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label><label className="grow">说明<input value={description} onChange={(e) => setDescription(e.target.value)} /></label><button className="primary"><Plus />手动新建题套</button></form>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={({ active }) => setActiveSetId(Number(active.id))} onDragCancel={() => setActiveSetId(null)} onDragEnd={(event) => void finishSetReorder(event)}>
    <SortableContext items={sets.map((item) => item.id)} strategy={verticalListSortingStrategy}>
    <div className={`question-set-admin-list${reorderingSets ? ' is-reordering' : ''}`} aria-busy={reorderingSets}>{sets.map((set) => {
      const setOpen = expandedSets.has(set.id)
      const reviewFilter = reviewFilters[set.id] ?? 'pending'
      const pendingCount = (set.questions || []).filter((question) => !question.reviewed).length
      const reviewedCount = (set.questions || []).filter((question) => question.reviewed).length
      const visibleQuestions = set.status !== 'draft' ? (set.questions || []) : (set.questions || []).filter((question) => questionMatchesFilter(question, reviewFilter))
      const setRecognitionJob = recognitionJobs.find((job) => job.target_set_id === set.id && job.target_question_id == null && activeJobStatuses.includes(job.status))
      return <SortableSetCard item={set} expanded={setOpen} disabled={reorderingSets || sets.length < 2} key={set.id}>
      <header className="question-set-header">
        <div className="question-set-main-row">
          <button type="button" className="course-disclosure question-set-disclosure grow" aria-expanded={setOpen} aria-label={`${setOpen ? '收起' : '展开'}习题集 ${set.title}`} onClick={() => setExpandedSets((current) => { const next = new Set(current); if (next.has(set.id)) next.delete(set.id); else next.add(set.id); return next })}><ChevronDown className="disclosure-chevron" /><div><div className="question-set-title-row"><h3>{set.title}</h3><span className={`status-pill ${set.status}`}>{set.status === 'published' ? '已发布' : set.status === 'draft' ? '草稿' : '已归档'}</span></div><p>{set.description || '暂无说明'}</p><small>{set.question_count} 题 · {set.total_points} 分 · 单选 {set.counts.single_choice ?? 0} · 多选 {set.counts.multiple_choice ?? 0} · 判断 {set.counts.true_false ?? 0} · 填空 {set.counts.fill_blank ?? 0} · 编程 {set.counts.programming ?? 0}</small></div></button>
          <div className="question-set-primary-actions">
            {set.status === 'draft' && <><button type="button" className="ghost" onClick={() => openNewQuestion(set)}><Plus />题目</button><button type="button" className="primary" onClick={() => void action(() => api(`/api/admin/question-sets/${set.id}/publish`, { method: 'POST' }), '题套已发布')}><CheckCircle2 />发布</button></>}
            {set.status === 'published' && <button type="button" className="ghost" onClick={() => void action(() => api(`/api/admin/question-sets/${set.id}/unpublish`, { method: 'POST' }), '题套已撤回为草稿')}>撤回</button>}
            <QuestionSetActionsMenu
              item={set}
              recognitionJob={setRecognitionJob}
              onUploadPdf={(file) => uploadSetSourcePdf(set, file)}
              onRecognize={() => void startRecognition(`/api/admin/question-sets/${set.id}/re-recognition`)}
              onArchive={() => { if (window.confirm('归档后学生不能再开始该题套，确认继续？')) void action(() => api(`/api/admin/question-sets/${set.id}/archive`, { method: 'POST' }), '题套已归档') }}
              onDelete={() => { if (window.confirm('永久删除该题套？题目、测试点、错题记录、PDF、截图和对应导入记录都会删除；历史成绩仍会保留。')) void action(() => api(`/api/admin/question-sets/${set.id}`, { method: 'DELETE' }), '题套已永久删除') }}
            />
          </div>
        </div>
        {set.status === 'draft' && setOpen && <div className="question-set-review-row"><div className="review-filter" role="group" aria-label={`${set.title}复核状态过滤`}>{([
          ['pending', `待复核 ${pendingCount}`], ['reviewed', `已复核 ${reviewedCount}`], ['all', `全部 ${pendingCount + reviewedCount}`],
        ] as [ReviewFilter, string][]).map(([value, label]) => <button type="button" className={reviewFilter === value ? 'selected' : ''} aria-pressed={reviewFilter === value} onClick={() => setReviewFilterForSet(set.id, value)} key={value}>{label}</button>)}</div></div>}
      </header>
      {setOpen && visibleQuestions.length > 0 && <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void finishQuestionReorder(set.id, event)}><SortableContext items={visibleQuestions.map((question) => question.id)} strategy={verticalListSortingStrategy}><div className="question-admin-list">{visibleQuestions.map((question) => {
        const recognitionAvailable = !!question.source_asset_id || !!set.source_pdf_asset_id
        const recognitionJob = recognitionJobs.find((job) => job.target_set_id === set.id && (job.target_question_id == null || job.target_question_id === question.id) && activeJobStatuses.includes(job.status))
        const recognitionPending = !!recognitionJob
        return <SortableQuestionRow question={question} disabled={reviewFilter !== 'all' || set.status !== 'draft' || reorderingQuestionSetId != null} key={question.id}>
        <span className="question-number">{question.sort_order + 1}</span><div className="grow"><strong>{labels[question.type]} · {question.points} 分 {question.reviewed ? '· 已复核' : '· 待复核'}</strong><p>{question.stem_markdown.slice(0, 100)}</p>{!!question.recognition_warnings?.length && <small className="recognition-warning">识别提示：{question.recognition_warnings[0]}</small>}</div>
        {question.type === 'programming' && set.status === 'draft' && <button className="ghost" title="用参考程序生成候选输出" onClick={() => void generateOutputs(question.id)}><Play />生成输出</button>}
        {set.status === 'draft' && <><button className="ghost" onClick={() => openQuestionEditor(set, question)}><Pencil />编辑</button><button className="ghost icon-button question-recognition-trigger" aria-label={recognitionJob ? `重新识别 ${Math.round(recognitionJob.progress?.percent ?? 0)}%` : '重新识别'} title={recognitionAvailable ? (recognitionJob ? `正在重新识别本题：${Math.round(recognitionJob.progress?.percent ?? 0)}%` : '从当前原图或题套 PDF 重新识别本题') : '当前题目没有原图，题套也没有保留原始 PDF'} disabled={!recognitionAvailable || recognitionPending} onClick={() => void startRecognition(`/api/admin/questions/${question.id}/re-recognition`)}><RefreshCcw className={recognitionPending ? 'is-spinning' : ''} /></button><button className="danger-button" aria-label={`删除题目 ${question.sort_order + 1}`} onClick={() => window.confirm('删除这道题？') && void action(() => api(`/api/admin/questions/${question.id}`, { method: 'DELETE' }), '题目已删除')}><Trash2 /></button></>}
        {set.status !== 'draft' && <button className="ghost" onClick={() => openQuestionEditor(set, question)}><Eye />查看</button>}
      </SortableQuestionRow>})}</div></SortableContext></DndContext>}
      {setOpen && visibleQuestions.length === 0 && <div className="question-filter-empty">{set.status === 'draft' ? `当前题套没有${reviewFilter === 'pending' ? '待复核' : reviewFilter === 'reviewed' ? '已复核' : ''}题目` : '当前题套暂无题目'}</div>}
    </SortableSetCard>})}</div>
    </SortableContext>
    <DragOverlay>{activeSet && <div className="question-set-drag-overlay card"><GripVertical /><div><strong>{activeSet.title}</strong><small>{activeSet.question_count} 题 · {activeSet.total_points} 分</small></div></div>}</DragOverlay>
    </DndContext>
    {editor && <QuestionEditor key={`editor-${editor.setId}`} value={editor.question} setTitle={editor.setTitle} readOnly={editor.readOnly} currentPosition={editorQueueIndex >= 0 ? editorQueueIndex + 1 : 0} queueSize={editor.queueIds.length} canPrevious={!!editor.question.id && editorQueueIndex > 0} canNext={!!editor.question.id && editorQueueIndex >= 0 && editorQueueIndex < editor.queueIds.length - 1} onCancel={() => setEditor(null)} onSave={(value) => saveQuestion(value)} onSaveReviewNext={(value) => saveQuestion(value, true, true)} onNavigate={navigateEditor} onUploadImage={uploadSourceImage} onUploadStemImage={uploadStemImage} onRemoveStemImage={removeStemImage} onRecognize={(questionId) => startRecognition(`/api/admin/questions/${questionId}/re-recognition`)} recognitionAvailable={!!editor.question.source_asset_id || !!sets.find((set) => set.id === editor.setId)?.source_pdf_asset_id} recognitionPending={!!editorRecognitionJob} recognitionProgress={editorRecognitionJob?.progress} recognitionStatus={editorRecognitionJob?.status} />}
    {referencePreview && <ReferenceOutputModal preview={referencePreview} onCancel={() => setReferencePreview(null)} onApply={() => void applyReferenceOutputs()} />}
    {recognitionPreview && <RecognitionPreviewModal job={recognitionPreview} onCancel={() => { setRecognitionPreviewId(null); setRecognitionDetail(null) }} onApply={() => void applyRecognition(recognitionPreview.id)} onRetry={() => void retryRecognition(recognitionPreview.id)} onStop={() => void cancelJob('recognition', recognitionPreview.id)} stopping={cancellingJobs.has(`recognition-${recognitionPreview.id}`)} />}
  </>
}

function QuestionEditor({ value, setTitle, readOnly, currentPosition, queueSize, canPrevious, canNext, onCancel, onSave, onSaveReviewNext, onNavigate, onUploadImage, onUploadStemImage, onRemoveStemImage, onRecognize, recognitionAvailable, recognitionPending, recognitionProgress, recognitionStatus }: { value: EditableQuestion; setTitle: string; readOnly: boolean; currentPosition: number; queueSize: number; canPrevious: boolean; canNext: boolean; onCancel: () => void; onSave: (value: EditableQuestion) => Promise<void>; onSaveReviewNext: (value: EditableQuestion) => Promise<void>; onNavigate: (offset: number) => void; onUploadImage: (questionId: number, file: File) => Promise<ExerciseQuestion>; onUploadStemImage: (questionId: number, file: File) => Promise<ExerciseQuestion>; onRemoveStemImage: (questionId: number) => Promise<ExerciseQuestion>; onRecognize: (questionId: number) => Promise<void>; recognitionAvailable: boolean; recognitionPending: boolean; recognitionProgress?: JobProgress; recognitionStatus?: JobStatus }) {
  const [question, setQuestion] = useState<EditableQuestion>(() => cloneQuestion(value))
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingStemImage, setUploadingStemImage] = useState(false)
  const [removingStemImage, setRemovingStemImage] = useState(false)
  const [sourceCollapsed, setSourceCollapsed] = useState(false)
  const [saving, setSaving] = useState(false)
  const sourceImageInputRef = useRef<HTMLInputElement>(null)
  const stemImageInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => setQuestion(cloneQuestion(value)), [value])
  const dirty = JSON.stringify(question) !== JSON.stringify(value)
  const updateOption = (index: number, patch: Partial<QuestionOption>) => setQuestion((current) => ({ ...current, reviewed: false, options: current.options.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }))
  const updateCase = (index: number, patch: Partial<ProgrammingCase>) => setQuestion((current) => ({ ...current, reviewed: false, programming: current.programming ? { ...current.programming, cases: current.programming.cases.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) } : null }))
  const changeType = (type: ExerciseQuestionType) => setQuestion((current) => ({
    ...current, type, reviewed: false,
    options: type === 'single_choice' || type === 'multiple_choice' ? (current.options.length >= 2 ? current.options : blankQuestion().options) : [],
    blanks: type === 'fill_blank' ? ((current.blanks || []).length ? current.blanks : [{ position: 1, accepted_answers: [''] }]) : [],
    programming: type === 'programming' ? (current.programming || blankProgram()) : null,
    correct_bool: type === 'true_false' ? (current.correct_bool ?? true) : null,
    points: type === 'programming' && current.points === 2 ? 25 : current.points,
  }))
  const close = useCallback(() => { if (!dirty || window.confirm('有尚未保存的修改，确认关闭？')) onCancel() }, [dirty, onCancel])
  const navigate = (offset: number) => { if (!dirty || window.confirm('有尚未保存的修改，确认切换题目？')) onNavigate(offset) }
  const recognize = () => { if (question.id && (!dirty || window.confirm('重新识别基于已保存内容，未保存修改不会进入识别任务。确认继续？'))) void onRecognize(question.id) }
  const save = async (review = false) => {
    if (readOnly || saving) return
    setSaving(true)
    try { await (review ? onSaveReviewNext(question) : onSave(question)) } finally { setSaving(false) }
  }
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return }
      if (!(event.ctrlKey || event.metaKey) || readOnly || saving) return
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void save(false) }
      if (event.key === 'Enter' && question.id) { event.preventDefault(); void save(true) }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [close, question, readOnly, saving])
  return <div className="modal-backdrop question-editor-backdrop" role="presentation"><form className={`question-editor-modal card${readOnly ? ' readonly' : ''}`} aria-label={readOnly ? '题目查看器' : '题目编辑器'} aria-readonly={readOnly} onSubmit={(e) => { e.preventDefault(); void save(false) }} onChangeCapture={(event) => { if (readOnly) { event.preventDefault(); event.stopPropagation() } }} onClickCapture={(event) => { const target = event.target as HTMLElement; if (readOnly && target.closest('.question-editor-body input,.question-editor-body select,.question-editor-body textarea,.question-editor-body button,.question-editor-body .file-picker') && !target.closest('.source-panel-collapse')) { event.preventDefault(); event.stopPropagation() } }} onKeyDownCapture={(event) => { if (readOnly && (event.target as HTMLElement).closest('.question-editor-body') && !['Tab', 'Escape'].includes(event.key)) event.preventDefault() }}>
    <header className="question-editor-header"><div><p className="eyebrow">{readOnly ? '题目查看' : '题目编辑'}</p><div className="question-editor-title-row"><h2>{setTitle}</h2><span className={`status-pill ${question.reviewed ? 'published' : 'draft'}`}>{question.reviewed ? '已复核' : '待复核'}</span>{readOnly && <span className="status-pill readonly">只读</span>}{question.id && queueSize > 0 && <span className="question-editor-position">第 {currentPosition} / {queueSize} 题</span>}</div><p>{readOnly ? '已发布题目仅供查看，如需修改请先撤回题套' : question.id ? '校对题面与答案后完成复核' : '添加一道新题目'}</p></div><div className="question-editor-header-actions"><button type="button" className="ghost editor-close" aria-label="关闭" title="关闭（Esc）" onClick={close}><X /></button></div></header>
    <div className={`question-editor-body${sourceCollapsed ? ' source-collapsed' : ''}`}>
      <aside className="question-source-panel">{sourceCollapsed ? <button type="button" className="source-panel-rail source-panel-collapse" aria-label="展开原题区域" title="展开原题区域" onClick={() => setSourceCollapsed(false)}><PanelLeftOpen /><span>原题</span></button> : <>
        <div className="question-source-heading image-panel-heading"><h3>原题截图</h3><div className="image-toolbar-actions">
          {question.source_asset_id && <label className="source-visibility-toggle" title="开启后学生会看到整张原题截图；只有局部图形请使用右侧的题干配图"><input type="checkbox" aria-label="显示原题" checked={question.show_source_crop ?? false} disabled={readOnly} onChange={(e) => setQuestion({ ...question, show_source_crop: e.target.checked, reviewed: false })} /><span>显示原题</span></label>}
          {!readOnly && <><button type="button" className="ghost icon-button image-toolbar-button" aria-label={question.source_asset_id ? '本地图片替换' : '上传原题图片'} title={!question.id ? '请先保存题目' : question.source_asset_id ? '本地图片替换' : '上传原题图片'} disabled={!question.id || uploadingImage} onClick={() => sourceImageInputRef.current?.click()}>{uploadingImage ? <LoaderCircle className="is-spinning" /> : <FileUp />}</button><input ref={sourceImageInputRef} type="file" hidden aria-label={question.source_asset_id ? '选择替换原题图片' : '选择原题图片'} accept="image/png,image/jpeg,image/webp" disabled={!question.id || uploadingImage} onChange={async (event) => { const file = event.target.files?.[0]; if (!file || !question.id) return; setUploadingImage(true); try { const updated = await onUploadImage(question.id, file); setQuestion(cloneQuestion(updated)) } finally { setUploadingImage(false); event.target.value = '' } }} />
            <button type="button" className="ghost icon-button image-toolbar-button recognition-image-button" aria-label={recognitionPending ? `重新识别本题 ${Math.round(recognitionProgress?.percent ?? 0)}%` : '重新识别本题'} title={!question.id ? '请先保存题目' : recognitionAvailable ? '基于当前图片或题套原 PDF 重新识别' : '当前题目没有原图，题套也没有保留原始 PDF'} disabled={!question.id || !recognitionAvailable || recognitionPending} onClick={recognize}><RefreshCcw className={recognitionPending ? 'is-spinning' : ''} />{recognitionPending && <span className="image-action-badge">{Math.round(recognitionProgress?.percent ?? 0)}%</span>}</button></>}
          <button type="button" className="ghost icon-button image-toolbar-button source-panel-collapse" aria-label="收起原题区域" title="收起原题区域" onClick={() => setSourceCollapsed(true)}><PanelLeftClose /></button>
        </div></div>
        <div className="question-source-canvas">{question.source_asset_id ? <img className="question-source-preview" src={`/api/question-assets/${question.source_asset_id}`} alt="原题截图" /> : <p className="notice">当前题目没有原题图片</p>}</div>
        <div className="question-source-meta">{recognitionPending && <JobProgressView progress={recognitionProgress} status={recognitionStatus ?? 'processing'} />}{question.recognition_confidence != null && <p className="recognition-confidence">识别置信度：<strong>{Math.round(question.recognition_confidence * 100)}%</strong></p>}{question.recognition_warnings?.map((warning) => <p className="notice warning" key={warning}>{warning}</p>)}</div>
      </>}</aside><div className="question-editor-fields">
      <section className="question-editor-section"><h3>基础信息</h3><div className="question-basic-grid"><label>题型<select value={question.type} onChange={(e) => changeType(e.target.value as ExerciseQuestionType)}>{Object.entries(labels).map(([type, label]) => <option value={type} key={type}>{label}</option>)}</select></label><label>分值<input type="number" min="1" value={question.points} onChange={(e) => setQuestion({ ...question, points: Number(e.target.value), reviewed: false })} /></label></div></section>
      <section className="question-editor-section"><h3>题目内容</h3><label>题面<textarea className="question-stem-input" rows={8} value={question.stem_markdown} onChange={(e) => setQuestion({ ...question, stem_markdown: e.target.value, reviewed: false })} required /></label><div className="stem-image-editor"><div className="section-title image-panel-heading"><div><h4>题干配图</h4><p>仅上传题目必需的图形；学生答题时显示在题面下方，不会显示整张原题。</p></div>{!readOnly && <div className="stem-image-actions image-toolbar-actions"><button type="button" className="ghost icon-button image-toolbar-button" aria-label={question.stem_image_asset_id ? '替换题干配图' : '上传题干配图'} title={!question.id ? '请先保存题目' : question.stem_image_asset_id ? '替换题干配图' : '上传题干配图'} disabled={!question.id || uploadingStemImage || removingStemImage} onClick={() => stemImageInputRef.current?.click()}>{uploadingStemImage ? <LoaderCircle className="is-spinning" /> : <FileUp />}</button><input ref={stemImageInputRef} type="file" hidden aria-label="选择题干配图" accept="image/png,image/jpeg,image/webp" disabled={!question.id || uploadingStemImage || removingStemImage} onChange={async (event) => { const file = event.target.files?.[0]; if (!file || !question.id) return; setUploadingStemImage(true); try { const updated = await onUploadStemImage(question.id, file); setQuestion(cloneQuestion(updated)) } finally { setUploadingStemImage(false); event.target.value = '' } }} />{question.stem_image_asset_id && <button type="button" className="danger-button icon-button image-toolbar-button image-toolbar-danger" aria-label="移除题干配图" title="移除题干配图" disabled={uploadingStemImage || removingStemImage} onClick={async () => { if (!question.id || !window.confirm('移除题干配图？原题截图仍会保留。')) return; setRemovingStemImage(true); try { const updated = await onRemoveStemImage(question.id); setQuestion(cloneQuestion(updated)) } finally { setRemovingStemImage(false) } }}>{removingStemImage ? <LoaderCircle className="is-spinning" /> : <Trash2 />}</button>}</div>}</div>{question.stem_image_asset_id ? <img className="stem-image-preview" src={`/api/question-assets/${question.stem_image_asset_id}`} alt="题干配图预览" /> : <p className="muted">{question.id ? '当前没有题干配图' : '请先保存题目，再上传题干配图'}</p>}</div></section>
      <section className="question-editor-section"><h3>答案设置</h3>{(question.type === 'single_choice' || question.type === 'multiple_choice') && <section className="option-editor"><h4>选择题答案</h4>{question.options.map((option, index) => <div key={index}><input aria-label={`选项 ${index + 1} 标签`} value={option.label} onChange={(e) => updateOption(index, { label: e.target.value })} /><textarea aria-label={`选项 ${index + 1} 内容`} rows={2} value={option.content_markdown} onChange={(e) => updateOption(index, { content_markdown: e.target.value })} required /><label className="check-label"><input type={question.type === 'single_choice' ? 'radio' : 'checkbox'} name="correct-option" checked={option.correct ?? false} onChange={(e) => setQuestion((current) => ({ ...current, reviewed: false, options: current.options.map((item, itemIndex) => ({ ...item, correct: question.type === 'single_choice' ? itemIndex === index : itemIndex === index ? e.target.checked : item.correct })) }))} />正确</label><button type="button" className="danger-button" aria-label={`删除选项 ${index + 1}`} onClick={() => setQuestion({ ...question, reviewed: false, options: question.options.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 /></button></div>)}<button type="button" className="ghost" onClick={() => setQuestion({ ...question, reviewed: false, options: [...question.options, { label: String.fromCharCode(65 + question.options.length), content_markdown: '', correct: false, sort_order: question.options.length }] })}><Plus />添加选项</button></section>}
      {question.type === 'true_false' && <label>正确答案<select required value={question.correct_bool == null ? '' : String(question.correct_bool)} onChange={(e) => setQuestion({ ...question, correct_bool: e.target.value === '' ? null : e.target.value === 'true', reviewed: false })}><option value="" disabled>请选择正确答案</option><option value="true">正确</option><option value="false">错误</option></select></label>}
      {question.type === 'fill_blank' && <FillBlankEditor question={question} setQuestion={setQuestion} />}
      {question.type === 'programming' && question.programming && <ProgrammingEditor program={question.programming} setProgram={(programming) => setQuestion({ ...question, programming, reviewed: false })} updateCase={updateCase} />}</section>
      <section className="question-editor-section"><h3>答案解析</h3><label>解析内容<textarea rows={5} value={question.explanation_markdown ?? ''} onChange={(e) => setQuestion({ ...question, explanation_markdown: e.target.value, reviewed: false })} /></label></section>
    </div></div><footer className="question-editor-footer">{question.id ? <div className="question-editor-navigation"><button type="button" className="ghost" disabled={!canPrevious || saving} onClick={() => navigate(-1)}><ChevronLeft />上一题</button><span>{queueSize > 0 ? `${currentPosition} / ${queueSize}` : '当前题目'}</span><button type="button" className="ghost" disabled={!canNext || saving} onClick={() => navigate(1)}>下一题<ChevronRight /></button></div> : <span className="muted">新建题目</span>}{readOnly ? <span className="question-editor-readonly-note">只读查看</span> : <div className="question-editor-save-actions">{question.id ? <><button type="submit" className="ghost" disabled={saving} title="保存草稿（Ctrl/Cmd+S）">{saving ? '正在保存…' : '保存草稿'}<kbd>Ctrl+S</kbd></button><button type="button" className="primary" disabled={saving} title="保存并复核（Ctrl/Cmd+Enter）" onClick={() => void save(true)}><CheckCircle2 />{canNext ? '保存并复核下一题' : '保存并完成复核'}<kbd>Ctrl+Enter</kbd></button></> : <button type="submit" className="primary" disabled={saving}>{saving ? '正在保存…' : '保存题目'}</button>}</div>}</footer>
  </form></div>
}

function FillBlankEditor({ question, setQuestion }: { question: EditableQuestion; setQuestion: React.Dispatch<React.SetStateAction<EditableQuestion>> }) {
  const addBlank = () => setQuestion((current) => {
    const position = (current.blanks || []).length + 1
    return { ...current, reviewed: false, stem_markdown: `${current.stem_markdown}${current.stem_markdown && !current.stem_markdown.endsWith(' ') ? ' ' : ''}{{${position}}}`, blanks: [...(current.blanks || []), { position, accepted_answers: [''] }] }
  })
  const update = (index: number, patch: Partial<QuestionBlank>) => setQuestion((current) => ({ ...current, reviewed: false, blanks: (current.blanks || []).map((blank, blankIndex) => blankIndex === index ? { ...blank, ...patch } : blank) }))
  const remove = (index: number) => setQuestion((current) => {
    const currentBlanks = current.blanks || []
    const remaining = currentBlanks.filter((_, blankIndex) => blankIndex !== index).map((blank, blankIndex) => ({ ...blank, position: blankIndex + 1 }))
    let stem = current.stem_markdown.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), '')
    for (let old = index + 2; old <= currentBlanks.length; old += 1) stem = stem.replace(new RegExp(`\\{\\{${old}\\}\\}`, 'g'), `{{${old - 1}}}`)
    return { ...current, reviewed: false, stem_markdown: stem, blanks: remaining }
  })
  return <section className="fill-blank-editor"><div className="section-title"><h3>填空答案</h3><button type="button" className="ghost" onClick={addBlank}><Plus />插入填空</button></div>{(question.blanks || []).map((blank, index) => <div className="blank-editor-row" key={blank.position}><strong>第 {blank.position} 空</strong><textarea rows={2} aria-label={`第 ${blank.position} 空可接受答案`} value={(blank.accepted_answers || []).join('\n')} onChange={(event) => update(index, { accepted_answers: event.target.value.split('\n') })} placeholder="每行一个可接受答案" /><button type="button" className="danger-button" onClick={() => remove(index)}><Trash2 /></button></div>)}</section>
}

function ProgrammingEditor({ program, setProgram, updateCase }: { program: NonNullable<EditableQuestion['programming']>; setProgram: (program: NonNullable<EditableQuestion['programming']>) => void; updateCase: (index: number, patch: Partial<ProgrammingCase>) => void }) {
  return <section className="program-editor"><div className="section-title"><div><h3><Code2 />编程规格</h3></div></div>
    <div className="question-editor-grid"><label>时间限制（ms）<input type="number" min="100" max="5000" value={program.time_limit_ms} onChange={(e) => setProgram({ ...program, time_limit_ms: Number(e.target.value) })} /></label><label>内存限制（MB）<input type="number" min="32" max="512" value={program.memory_limit_mb} onChange={(e) => setProgram({ ...program, memory_limit_mb: Number(e.target.value) })} /></label></div>
    <label>输入格式<textarea rows={3} value={program.input_markdown} onChange={(e) => setProgram({ ...program, input_markdown: e.target.value })} /></label><label>输出格式<textarea rows={3} value={program.output_markdown} onChange={(e) => setProgram({ ...program, output_markdown: e.target.value })} /></label><label>数据范围<textarea rows={3} value={program.constraints_markdown} onChange={(e) => setProgram({ ...program, constraints_markdown: e.target.value })} /></label><label>初始代码<textarea className="code-input" rows={5} value={program.starter_code} onChange={(e) => setProgram({ ...program, starter_code: e.target.value })} /></label><label>参考程序<textarea className="code-input" rows={10} value={program.reference_solution ?? ''} onChange={(e) => setProgram({ ...program, reference_solution: e.target.value })} /></label>
    <h3>测试点</h3>{program.cases.map((item, index) => <div className="case-editor" key={item.id ?? index}><div><strong>{item.is_sample ? '公开样例' : '隐藏测试点'}</strong><label className="check-label"><input type="checkbox" checked={item.is_sample} onChange={(e) => updateCase(index, { is_sample: e.target.checked, weight: e.target.checked ? 0 : item.weight })} />公开</label>{!item.is_sample && <label className="check-label"><input type="checkbox" checked={item.confirmed ?? false} onChange={(e) => updateCase(index, { confirmed: e.target.checked })} />已确认</label>}</div><label>输入<textarea className="code-input" rows={3} value={item.input_data} onChange={(e) => updateCase(index, { input_data: e.target.value, confirmed: false })} /></label><label>期望输出<textarea className="code-input" rows={3} value={item.expected_output} onChange={(e) => updateCase(index, { expected_output: e.target.value, confirmed: false })} /></label>{!item.is_sample && <label>权重<input type="number" min="0" value={item.weight} onChange={(e) => updateCase(index, { weight: Number(e.target.value), confirmed: false })} /></label>}<button type="button" className="danger-button" onClick={() => setProgram({ ...program, cases: program.cases.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 />删除测试点</button></div>)}
    <button type="button" className="ghost" onClick={() => setProgram({ ...program, cases: [...program.cases, { input_data: '', expected_output: '', is_sample: false, weight: 0, confirmed: false, note: '' }] })}><Plus />添加测试点</button>
  </section>
}

const recognitionFieldLabels: Record<string, string> = {
  type: '题型', stem_markdown: '题面', explanation_markdown: '解析', points: '分值', correct_bool: '判断答案',
  source_page: '来源页', source_end_page: '结束页', options: '选项与答案', blanks: '填空答案', programming: '编程规格', source_asset_id: '原题图片',
}

const recognitionValue = (value: unknown) => {
  if (value == null || value === '') return '（空）'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function RecognitionPreviewModal({ job, onCancel, onApply, onRetry, onStop, stopping }: { job: RecognitionJob; onCancel: () => void; onApply: () => void; onRetry: () => void; onStop: () => void; stopping: boolean }) {
  const changes = job.result?.changes ?? []
  const matched = changes.filter((item) => item.status === 'matched').length
  const added = changes.filter((item) => item.status === 'added').length
  const unmatched = changes.filter((item) => item.status === 'unmatched').length
  const invalid = changes.filter((item) => item.status === 'invalid').length
  const onlyInvalid = changes.length > 0 && invalid === changes.length
  return <div className="modal-backdrop" role="presentation"><section className="question-editor-modal card recognition-preview-modal" role="dialog" aria-modal="true" aria-label="重新识别预览">
    <header><div><p className="eyebrow">{job.scope === 'set' ? '整套重新识别' : '单题重新识别'}</p><h2>{job.status === 'ready' ? '确认识别差异' : job.status === 'failed' ? '重新识别失败' : job.status === 'cancelled' ? '重新识别已终止' : job.status === 'applied' ? '结果已应用' : '模型正在识别'}</h2><p>{job.model} · 思考级别：{job.reasoning_effort || '模型默认'}</p></div><button type="button" className="ghost" aria-label="关闭" onClick={onCancel}><X /></button></header>
    {activeJobStatuses.includes(job.status) && <div className="recognition-progress"><RefreshCcw className="is-spinning" /><JobProgressView progress={job.progress} status={job.status} /><p>可以关闭窗口，任务会在后台继续运行。</p><div className="button-row"><button type="button" className="ghost" onClick={onCancel}>关闭窗口</button><button type="button" className="ghost danger-button" disabled={stopping} onClick={onStop}><CircleStop />{stopping ? '正在终止…' : '终止任务'}</button></div></div>}
    {['failed', 'cancelled'].includes(job.status) && <><p className={`notice ${job.status === 'failed' ? 'error' : 'warning'}`}>{job.error || (job.status === 'cancelled' ? '管理员手动终止' : '模型请求失败')}</p>{job.progress && <JobProgressView progress={job.progress} status={job.status} />}<div className="button-row"><button type="button" className="ghost" onClick={onCancel}>关闭</button><button type="button" className="primary" onClick={onRetry}><RefreshCcw />重新排队</button></div></>}
    {job.status === 'ready' && <>
      {job.stale && <p className="notice error">识别期间题目内容、图片或排序发生了变化，当前结果已过期，请重新创建任务。</p>}
      <div className="recognition-summary"><span><strong>{matched}</strong>匹配更新</span><span><strong>{added}</strong>新增题目</span><span><strong>{unmatched}</strong>保留旧题</span><span><strong>{invalid}</strong>无效候选</span><span><strong>{job.result?.diagnostics?.warnings?.length ?? 0}</strong>识别警告</span></div>
      {!!job.result?.diagnostics?.warnings?.length && <details className="recognition-job-warnings"><summary>查看整套识别警告</summary><ul>{job.result.diagnostics.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></details>}
      <div className="recognition-change-list">{changes.map((change, index) => <details className={`recognition-change ${change.status}`} open={job.scope === 'question' || change.status === 'invalid'} key={`${change.status}-${change.question_id ?? index}`}><summary><strong>{change.status === 'added' ? '新增题目' : change.status === 'unmatched' ? '未匹配旧题（保留）' : change.status === 'invalid' ? (change.question_id ? `题目 ${change.question_id} · 结果无效` : '无效新增题（跳过）') : `题目 ${change.question_id}`}</strong><span>{change.status === 'unmatched' ? '不删除，恢复待复核' : change.status === 'invalid' ? (change.question_id ? '保留原题' : '不会创建') : `${change.changed_fields.length} 项变化`}</span></summary><div className="recognition-change-body">
        {(change.current?.source_asset_id || change.candidate?.source_asset_id) && <div className="recognition-image-compare"><figure><figcaption>当前图片</figcaption>{change.current?.source_asset_id ? <img src={`/api/question-assets/${change.current.source_asset_id}`} alt="当前原题截图" /> : <p>无</p>}</figure><figure><figcaption>候选图片</figcaption>{change.candidate?.source_asset_id ? <img src={`/api/question-assets/${change.candidate.source_asset_id}`} alt="重新识别截图" /> : <p>未生成可靠截图，将保留旧图</p>}</figure></div>}
        {change.changed_fields.filter((field) => field !== 'source_asset_id').map((field) => <section className="recognition-field-diff" key={field}><h4>{recognitionFieldLabels[field] || field}</h4><div><label>当前值<pre>{recognitionValue(change.current?.[field as keyof ExerciseQuestion])}</pre></label><label>候选值<pre>{recognitionValue(change.candidate?.[field as keyof EditableQuestion])}</pre></label></div></section>)}
        {change.status === 'unmatched' && <p className="notice warning">模型没有找到对应题目。应用后该题仍会保留，并加入人工复核警告。</p>}
        {change.status === 'invalid' && <div className="notice error recognition-validation-errors"><strong>{change.repair_attempted ? '高清修复后仍未通过校验' : '候选结果未通过校验'}</strong><ul>{change.validation_errors?.map((error, errorIndex) => <li key={`${error}-${errorIndex}`}>{error}</li>)}</ul><p>{change.question_id ? '应用整套结果时将保留原题，并恢复为待复核。' : '该候选不会创建为新题目。'}</p></div>}
      </div></details>)}</div>
      <div className="button-row"><button type="button" className="ghost" onClick={onCancel}>暂不应用</button>{onlyInvalid && <button type="button" className="ghost" onClick={onRetry}><RefreshCcw />重新识别</button>}{!(job.scope === 'question' && onlyInvalid) && <button type="button" className="primary" disabled={job.stale} onClick={onApply}><CheckCircle2 />确认应用识别结果</button>}</div>
    </>}
  </section></div>
}

function ReferenceOutputModal({ preview, onCancel, onApply }: { preview: ReferencePreview; onCancel: () => void; onApply: () => void }) {
  const applicable = preview.cases.filter((item) => item.status === 'AC' && item.stable)
  return <div className="modal-backdrop" role="presentation"><section className="question-editor-modal card reference-output-modal" role="dialog" aria-modal="true" aria-label="候选输出预览"><header><div><p className="eyebrow">编程题输出</p><h2>两次运行与差异预览</h2></div><button type="button" className="ghost" aria-label="关闭" onClick={onCancel}><X /></button></header>{preview.stale && <p className="notice error">参考程序或测试输入已修改，请关闭后重新生成。</p>}<p className="notice">系统会忽略换行格式、行尾空格和末尾空行；其他字符与大小写必须一致。随机数、时间或无序集合可能导致输出不稳定。</p><div className="reference-preview-list">{preview.cases.map((item, index) => <article className={item.stable && item.status === 'AC' ? 'stable' : 'unstable'} key={item.id}><header><strong>测试点 {index + 1}</strong><span>{item.stable && item.status === 'AC' ? '两次输出一致' : `不可应用：${item.status}`}</span></header><div><label>当前输出<pre>{item.current_output || '（空）'}</pre></label><label>候选输出<pre>{item.candidate_output || '（空）'}</pre></label></div>{!item.stable && item.runs && <details><summary>查看两次运行</summary>{item.runs.map((run, runIndex) => <pre key={runIndex}>第 {runIndex + 1} 次 · {run.status}\n{run.stdout || run.stderr || '（空）'}</pre>)}</details>}</article>)}</div><div className="button-row"><button type="button" className="ghost" onClick={onCancel}>取消</button><button type="button" className="primary" disabled={preview.stale || !applicable.length} onClick={onApply}>确认应用 {applicable.length} 个稳定输出</button></div></section></div>
}
