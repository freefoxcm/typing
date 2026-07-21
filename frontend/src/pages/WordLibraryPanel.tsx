import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { ChevronDown, GripVertical, Pencil, Plus, RefreshCcw, Trash2 } from 'lucide-react'
import { api, jsonBody } from '../api'
import type { LlmStatus, WordEntry, WordSetSummary } from '../types'

const statusLabels: Record<string, string> = { ready: '就绪', pending: '等待', processing: '生成中', failed: '失败' }

type WordFormState = {
  mode: 'create' | 'edit'
  wordSetId: number
  wordSetTitle: string
  wordId?: number
  spelling: string
  phonetic: string
  meaning: string
  technicalMeaning: string
  active: boolean
}

export function reorderWordSetList(wordSets: WordSetSummary[], activeId: number, overId: number) {
  const oldIndex = wordSets.findIndex((item) => item.id === activeId)
  const newIndex = wordSets.findIndex((item) => item.id === overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return wordSets
  return arrayMove(wordSets, oldIndex, newIndex).map((item, index) => ({ ...item, sort_order: index }))
}

export function saveWordSetOrder(wordSets: WordSetSummary[]) {
  return api('/api/admin/word-sets/order', { method: 'PUT', ...jsonBody({ word_set_ids: wordSets.map((item) => item.id) }) })
}

function SortableWordSetCard({ item, expanded, disabled, children }: { item: WordSetSummary; expanded: boolean; disabled: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled })
  const constrainedTransform = transform ? { ...transform, x: 0 } : null
  return <article
    ref={setNodeRef}
    style={{ transform: CSS.Transform.toString(constrainedTransform), transition }}
    className={`card word-set-admin sortable-word-set library-disclosure-card${expanded ? ' expanded' : ' collapsed'}${isDragging ? ' is-dragging' : ''}`}
  >
    <button
      type="button"
      ref={setActivatorNodeRef}
      className="course-drag-handle word-set-drag-handle"
      disabled={disabled}
      {...attributes}
      {...listeners}
      aria-label={`拖动单词集 ${item.title} 调整顺序`}
      title="拖动调整顺序；键盘可用空格或回车拿起，方向键移动，再按空格或回车放下，Esc 取消"
    ><GripVertical aria-hidden="true" /></button>
    {children}
  </article>
}

export function WordLibraryPanel() {
  const [sets, setSets] = useState<WordSetSummary[]>([])
  const [llm, setLlm] = useState<LlmStatus | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [wordForm, setWordForm] = useState<WordFormState | null>(null)
  const [wordFormError, setWordFormError] = useState('')
  const [wordFormSubmitting, setWordFormSubmitting] = useState(false)
  const [activeWordSetId, setActiveWordSetId] = useState<number | null>(null)
  const [reordering, setReordering] = useState(false)
  const wordFormTrigger = useRef<HTMLButtonElement | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const activeWordSet = useMemo(() => sets.find((item) => item.id === activeWordSetId), [activeWordSetId, sets])

  const load = useCallback(async () => {
    const [wordSets, llmStatus] = await Promise.all([api<WordSetSummary[]>('/api/admin/word-sets'), api<LlmStatus>('/api/admin/llm/status')])
    setSets(wordSets); setLlm(llmStatus)
  }, [])
  useEffect(() => { void load().catch((e) => setError(e.message)) }, [load])

  const action = async (work: () => Promise<unknown>, success: string) => {
    setError(''); setMessage('')
    try { await work(); await load(); setMessage(success); return true } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); return false }
  }
  const createSet = (event: React.FormEvent) => {
    event.preventDefault()
    void action(() => api('/api/admin/word-sets', { method: 'POST', ...jsonBody({ title, description, sort_order: sets.length, active: true }) }), '单词集已创建')
      .then((ok) => { if (ok) { setTitle(''); setDescription('') } })
  }
  const openCreateWord = (wordSet: WordSetSummary, trigger: HTMLButtonElement) => {
    wordFormTrigger.current = trigger
    setWordFormError('')
    setWordForm({ mode: 'create', wordSetId: wordSet.id, wordSetTitle: wordSet.title, spelling: '', phonetic: '', meaning: '', technicalMeaning: '', active: true })
  }
  const openEditWord = (word: WordEntry, wordSet: WordSetSummary, trigger: HTMLButtonElement) => {
    wordFormTrigger.current = trigger
    setWordFormError('')
    setWordForm({
      mode: 'edit', wordSetId: word.word_set_id ?? wordSet.id, wordSetTitle: wordSet.title, wordId: word.id, spelling: word.spelling,
      phonetic: word.phonetic, meaning: word.meaning_zh, technicalMeaning: word.technical_meaning_zh, active: word.active ?? true,
    })
  }
  const finishWordForm = () => {
    const trigger = wordFormTrigger.current
    setWordForm(null); setWordFormError(''); setWordFormSubmitting(false)
    window.setTimeout(() => trigger?.focus(), 0)
  }
  const submitWordForm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!wordForm || wordFormSubmitting) return
    setWordFormSubmitting(true); setWordFormError(''); setError(''); setMessage('')
    const payload = {
      word_set_id: wordForm.wordSetId, spelling: wordForm.spelling, phonetic: wordForm.phonetic,
      meaning_zh: wordForm.meaning, technical_meaning_zh: wordForm.technicalMeaning, active: wordForm.active,
    }
    try {
      await api(wordForm.mode === 'create' ? '/api/admin/words' : `/api/admin/words/${wordForm.wordId}`, {
        method: wordForm.mode === 'create' ? 'POST' : 'PUT', ...jsonBody(payload),
      })
      setExpanded((current) => new Set(current).add(wordForm.wordSetId))
      setMessage(wordForm.mode === 'create' ? '单词已添加' : '单词已更新')
      finishWordForm()
      void load().catch((e) => setError(e instanceof Error ? e.message : '刷新失败'))
    } catch (e) {
      setWordFormError(e instanceof Error ? e.message : '操作失败')
      setWordFormSubmitting(false)
    }
  }
  const finishReorder = async ({ active, over }: DragEndEvent) => {
    setActiveWordSetId(null)
    if (!over || reordering) return
    const previous = sets
    const next = reorderWordSetList(previous, Number(active.id), Number(over.id))
    if (next === previous) return
    setSets(next); setReordering(true)
    const saved = await action(() => saveWordSetOrder(next), '单词集顺序已保存')
    if (!saved) {
      setSets(previous)
      try { await load() } catch { /* action 已显示原始保存错误 */ }
    }
    setReordering(false)
  }

  return <>
    {message && <p className="notice success">{message}</p>}{error && <p className="notice error">{error}</p>}
    <header className="section-title"><div><p className="eyebrow">单词词库</p><h2>管理记忆词表</h2><p>完整词条可立即练习，缺失资料会自动排队补全。</p></div><button className="ghost" onClick={() => void load()}><RefreshCcw />刷新状态</button></header>
    <div className={`llm-status card ${llm?.configured ? 'configured' : 'not-configured'}`}><strong>LLM {llm?.configured ? '已配置' : '未配置'}</strong><span>{llm?.configured ? `${llm.model} · ${llm.base_url}` : '请在 .env 中设置 LLM_API_KEY 和 LLM_MODEL，重启后自动处理等待项。'}</span></div>
    <form className="inline-form card" onSubmit={createSet}><label>单词集名称<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label><label className="grow">说明<input value={description} onChange={(e) => setDescription(e.target.value)} /></label><button className="primary"><Plus />新建单词集</button></form>
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ screenReaderInstructions: { draggable: '聚焦拖动手柄后，按空格键或回车键拿起单词集，使用上下方向键移动，按空格键或回车键放下，按 Esc 取消。' } }}
      onDragStart={({ active }) => setActiveWordSetId(Number(active.id))}
      onDragCancel={() => setActiveWordSetId(null)}
      onDragEnd={(event) => void finishReorder(event)}
    >
    <SortableContext items={sets.map((item) => item.id)} strategy={verticalListSortingStrategy}>
    <div className={`word-set-admin-list${reordering ? ' is-reordering' : ''}`} aria-busy={reordering}>{sets.map((item, index) => {
      const open = expanded.has(item.id)
      return <SortableWordSetCard item={item} expanded={open} disabled={reordering || sets.length < 2} key={item.id}><header>
        <button className="course-disclosure word-set-disclosure grow" aria-expanded={open} aria-label={`${open ? '收起' : '展开'}单词集 ${item.title}`} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next })}><ChevronDown className="disclosure-chevron" /><div><h3>{item.title} {!item.active && <em>已停用</em>}</h3><p>{item.description || '暂无说明'} · {item.word_count} 词</p></div></button>
        <div className="word-status-counts">{Object.entries(item.status_counts ?? {}).map(([status, count]) => <span className={`status-${status}`} key={status}>{statusLabels[status] ?? status} {count}</span>)}</div>
        <button aria-label={`向单词集 ${item.title} 添加单词`} title="添加单词" onClick={(event) => openCreateWord(item, event.currentTarget)}><Plus /></button>
        <button aria-label={`编辑单词集 ${item.title}`} onClick={() => { const value = window.prompt('单词集名称', item.title); if (value) void action(() => api(`/api/admin/word-sets/${item.id}`, { method: 'PUT', ...jsonBody({ title: value, description: item.description, sort_order: item.sort_order ?? index, active: item.active }) }), '单词集已更新') }}><Pencil /></button>
        <button onClick={() => void action(() => api(`/api/admin/word-sets/${item.id}`, { method: 'PUT', ...jsonBody({ title: item.title, description: item.description, sort_order: item.sort_order ?? index, active: !item.active }) }), item.active ? '单词集已停用' : '单词集已启用')}>{item.active ? '停用' : '启用'}</button>
        <button className="danger-button" aria-label={`删除单词集 ${item.title}`} onClick={() => window.confirm('删除单词集及全部词条？历史成绩会保留拼写快照。') && void action(() => api(`/api/admin/word-sets/${item.id}`, { method: 'DELETE' }), '单词集已删除')}><Trash2 /></button>
      </header>{open && <div className="word-admin-table">
        {(item.status_counts?.failed ?? 0) > 0 && <button className="ghost retry-all" onClick={() => void action(() => api(`/api/admin/word-sets/${item.id}/retry-failed`, { method: 'POST' }), '失败词条已重新排队')}><RefreshCcw />重试本集失败项</button>}
        {item.words?.map((word) => <div key={word.id}><code>{word.spelling}</code><span>{word.phonetic || '待补音标'}</span><p>{word.meaning_zh || '待补释义'}</p><i className={`word-status status-${word.enrichment_status}`}>{statusLabels[word.enrichment_status ?? ''] ?? word.enrichment_status}</i>{word.enrichment_error && <small title={word.enrichment_error}>查看错误</small>}<button aria-label={`编辑单词 ${word.spelling}`} onClick={(event) => openEditWord(word, item, event.currentTarget)}><Pencil /></button><button onClick={() => void action(() => api(`/api/admin/words/${word.id}`, { method: 'PUT', ...jsonBody({ word_set_id: word.word_set_id, spelling: word.spelling, phonetic: word.phonetic, meaning_zh: word.meaning_zh, technical_meaning_zh: word.technical_meaning_zh, active: !word.active }) }), word.active ? '单词已停用' : '单词已启用')}>{word.active ? '停用' : '启用'}</button>{word.enrichment_status === 'failed' && <button aria-label={`重试单词 ${word.spelling}`} onClick={() => void action(() => api(`/api/admin/words/${word.id}/retry`, { method: 'POST' }), '单词已重新排队')}><RefreshCcw /></button>}<button className="danger-button" aria-label={`删除单词 ${word.spelling}`} onClick={() => window.confirm(`删除 ${word.spelling}？`) && void action(() => api(`/api/admin/words/${word.id}`, { method: 'DELETE' }), '单词已删除')}><Trash2 /></button></div>)}
      </div>}</SortableWordSetCard>
    })}</div>
    </SortableContext>
    <DragOverlay>{activeWordSet && <div className="course-drag-overlay word-set-drag-overlay card"><GripVertical aria-hidden="true" /><div><strong>{activeWordSet.title}</strong><small>{activeWordSet.description || '暂无说明'}</small></div></div>}</DragOverlay>
    </DndContext>
    {wordForm && <WordFormModal
      form={wordForm}
      error={wordFormError}
      submitting={wordFormSubmitting}
      onChange={(changes) => setWordForm((current) => current ? { ...current, ...changes } : current)}
      onClose={() => { if (!wordFormSubmitting) finishWordForm() }}
      onSubmit={submitWordForm}
    />}
  </>
}

function WordFormModal({ form, error, submitting, onChange, onClose, onSubmit }: {
  form: WordFormState
  error: string
  submitting: boolean
  onChange: (changes: Partial<WordFormState>) => void
  onClose: () => void
  onSubmit: (event: React.FormEvent) => void
}) {
  const titleId = 'word-form-title'
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div className="word-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="word-modal card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header><div><p className="eyebrow">{form.mode === 'create' ? '添加单词' : '编辑单词'}</p><h2 id={titleId}>{form.mode === 'create' ? `向「${form.wordSetTitle}」添加单词` : `编辑 ${form.spelling}`}</h2><p>目标单词集：{form.wordSetTitle}</p></div></header>
      <form onSubmit={onSubmit}>
        {error && <p className="notice error" role="alert">{error}</p>}
        <label>单词或术语<input autoFocus value={form.spelling} maxLength={120} onChange={(event) => onChange({ spelling: event.target.value })} required /></label>
        <label>美式音标<input value={form.phonetic} maxLength={160} onChange={(event) => onChange({ phonetic: event.target.value })} placeholder="可留空，由 LLM 补全" /></label>
        <label>常用中文释义<textarea rows={3} value={form.meaning} maxLength={2000} onChange={(event) => onChange({ meaning: event.target.value })} placeholder="可留空，由 LLM 补全" /></label>
        <label>计算机领域释义<textarea rows={3} value={form.technicalMeaning} maxLength={2000} onChange={(event) => onChange({ technicalMeaning: event.target.value })} placeholder="没有可留空" /></label>
        <div className="button-row"><button type="button" className="ghost" onClick={onClose} disabled={submitting}>取消</button><button className="primary" disabled={submitting}>{submitting ? '正在保存…' : form.mode === 'create' ? '添加单词' : '保存修改'}</button></div>
      </form>
    </section>
  </div>
}
