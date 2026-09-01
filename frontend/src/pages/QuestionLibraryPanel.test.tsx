import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api } from '../api'
import { QuestionLibraryPanel, reorderQuestionList, reorderQuestionSetList, saveQuestionOrder, saveQuestionSetOrder } from './QuestionLibraryPanel'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})

const mockedApi = vi.mocked(api)

describe('QuestionLibraryPanel', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/question-sets') return []
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      if (path === '/api/admin/exercise-reports/summary') return { session_count: 0, average_percent: 0, unresolved_wrong_count: 0 }
      return { id: 1 }
    })
  })

  it('disables PDF upload when the dedicated model is not configured', async () => {
    render(<QuestionLibraryPanel />)
    expect(await screen.findByText(/尚未配置 IMPORT_LLM/)).toBeInTheDocument()
    const disclosure = screen.getByRole('button', { name: /PDF 智能识别/ })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('上传 PDF')).not.toBeInTheDocument()
    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('上传 PDF').closest('label')?.querySelector('input[type="file"]')).toBeDisabled()
  })

  it('keeps learning statistics and score export out of the question library', async () => {
    render(<QuestionLibraryPanel />)
    await screen.findByText('题套、识别与自动判题')
    expect(screen.queryByText('平均得分率')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '导出习题成绩' })).not.toBeInTheDocument()
    expect(mockedApi.mock.calls.some(([path]) => path === '/api/admin/exercise-reports/summary')).toBe(false)
  })

  it('creates a manual draft question set', async () => {
    render(<QuestionLibraryPanel />)
    await screen.findByText('手动新建题套')
    fireEvent.change(screen.getByLabelText('题套名称'), { target: { value: '基础题库' } })
    fireEvent.change(screen.getByLabelText('说明'), { target: { value: '第一套' } })
    fireEvent.click(screen.getByRole('button', { name: /手动新建题套/ }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/admin/question-sets', expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: '基础题库', description: '第一套' }) })))
  })

  it('shows the import endpoint and upstream error details', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/question-sets') return []
      if (path === '/api/admin/question-imports') return [{ id: 1, status: 'failed', attempts: 3, created_at: '2026-07-21', error: '上游模型接口返回 HTTP 400；unknown model' }]
      if (path === '/api/admin/import-llm/status') return { configured: true, base_url: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3', batch_pages: 3 }
      if (path === '/api/admin/exercise-reports/summary') return { session_count: 0, average_percent: 0, unresolved_wrong_count: 0 }
      return { id: 1 }
    })

    render(<QuestionLibraryPanel />)

    expect(await screen.findByText(/MiniMax-M3 · https:\/\/api\.minimaxi\.com\/v1 · 每批 3 页/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /PDF 智能识别/ }))
    expect(screen.getByText(/unknown model/)).toBeInTheDocument()
  })

  it('shows recognition counts, focused retries, and warnings', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/question-sets') return []
      if (path === '/api/admin/question-imports') return [{ id: 2, status: 'ready', attempts: 1, created_at: '2026-07-21', page_count: 5, counts: { single_choice: 15, multiple_choice: 0, true_false: 10, programming: 2 }, retried_pages: [4], warnings: ['第 4 页需要人工核对'], invalid_count: 1, invalid_questions: [{ index: 8, source_page: 3, number: '8', errors: ['判断题缺少明确的正确答案'], repair_attempted: true }] }]
      if (path === '/api/admin/import-llm/status') return { configured: true, base_url: 'https://example.test/v1', model: 'vision', batch_pages: 3 }
      if (path === '/api/admin/exercise-reports/summary') return { session_count: 0, average_percent: 0, unresolved_wrong_count: 0 }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /PDF 智能识别/ }))
    expect(await screen.findByText('识别统计')).toBeInTheDocument()
    expect(screen.getByText('定向重试页：4')).toBeInTheDocument()
    expect(screen.getByText('15').parentElement).toHaveTextContent('单选题')
    expect(screen.getByText('第 4 页需要人工核对')).toBeInTheDocument()
    expect(screen.getByText('已导入但需人工补全（1）')).toBeInTheDocument()
    expect(screen.getByText(/判断题缺少明确的正确答案/)).toBeInTheDocument()
  })

  it('shows import progress with counters and cancels an active import after confirmation', async () => {
    const notify = vi.fn()
    let job = { id: 18, status: 'processing', attempts: 1, created_at: '2026-08-27', source_filename: '进度试卷.pdf', progress: { phase: 'batch_recognition', label: '正在批量识别', percent: 32, current: 2, total: 5, unit: 'batch', detail: '正在等待模型返回第 2/5 批', updated_at: new Date().toISOString() } }
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/admin/question-sets') return []
      if (path === '/api/admin/question-imports') return [job]
      if (path === '/api/admin/question-recognition-jobs') return []
      if (path === '/api/admin/import-llm/status') return { configured: true, base_url: 'https://example.test/v1', model: 'vision', batch_pages: 3 }
      if (path === '/api/admin/question-imports/18/cancel' && options?.method === 'POST') {
        job = { ...job, status: 'cancelled', progress: { ...job.progress, phase: 'cancelled', label: '已终止' } }
        return job
      }
      return { id: 1 }
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<QuestionLibraryPanel notify={notify} />)
    fireEvent.click(await screen.findByRole('button', { name: /PDF 智能识别/ }))
    const progress = await screen.findByRole('progressbar', { name: '正在批量识别' })
    expect(progress).toHaveAttribute('aria-valuenow', '32')
    expect(screen.getByText(/2 \/ 5 批/)).toBeInTheDocument()
    expect(screen.getByText(/正在等待模型返回第 2\/5 批/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /终止任务/ }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('确认终止这个识别任务'))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/admin/question-imports/18/cancel', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(notify).toHaveBeenCalledWith('success', '识别任务已终止，可稍后重新排队'))
    confirm.mockRestore()
  })

  it('shows re-recognition progress in the row, editor, and modal and can stop it', async () => {
    const question = { id: 61, question_set_id: 6, type: 'true_false' as const, stem_markdown: '进度判断题', explanation_markdown: '', points: 2, sort_order: 0, reviewed: false, correct_bool: true, source_asset_id: 10, show_source_crop: false, options: [], blanks: [], programming: null }
    let recognition = { id: 20, scope: 'question', status: 'processing', target_set_id: 6, target_question_id: 61, model: 'vision', attempts: 1, stale: false, created_at: '2026-08-27', progress: { phase: 'model_review', label: '正在重新识别本题', percent: 25, current: 1, total: 1, unit: 'question', detail: '正在等待模型返回单题识别结果', updated_at: new Date().toISOString() } }
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/admin/question-sets') return [{ id: 6, title: '进度题套', description: '', status: 'draft', source_pdf_asset_id: 9, question_count: 1, total_points: 2, counts: { true_false: 1 }, questions: [question] }]
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/question-recognition-jobs') return [recognition]
      if (path === '/api/admin/question-recognition-jobs/20') return recognition
      if (path === '/api/admin/import-llm/status') return { configured: true, base_url: 'https://example.test/v1', model: 'vision', batch_pages: 3 }
      if (path === '/api/admin/question-recognition-jobs/20/cancel' && options?.method === 'POST') {
        recognition = { ...recognition, status: 'cancelled', progress: { ...recognition.progress, phase: 'cancelled', label: '已终止' } }
        return recognition
      }
      return { id: 1 }
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '展开习题集 进度题套' }))
    expect(screen.getByRole('button', { name: /重新识别 25%/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }))
    expect(within(screen.getByRole('form', { name: '题目编辑器' })).getByRole('button', { name: /重新识别本题 25%/ })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: '正在重新识别本题' })).toHaveAttribute('aria-valuenow', '25')
    fireEvent.click(screen.getByRole('button', { name: /PDF 智能识别/ }))
    fireEvent.click(screen.getByRole('button', { name: /题目 #61/ }))
    const dialog = await screen.findByRole('dialog', { name: '重新识别预览' })
    expect(within(dialog).getByText(/正在等待模型返回单题识别结果/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /终止任务/ }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/admin/question-recognition-jobs/20/cancel', expect.objectContaining({ method: 'POST' })))
    confirm.mockRestore()
  })

  it('shows single-question recognition in the row and keeps invalid single results unapplied', async () => {
    const question = { id: 51, question_set_id: 5, type: 'true_false' as const, stem_markdown: '判断题', explanation_markdown: '', points: 2, sort_order: 0, reviewed: false, correct_bool: true, source_asset_id: 10, show_source_crop: false, options: [], blanks: [], programming: null }
    const noSourceQuestion = { ...question, id: 52, stem_markdown: '没有来源的题目', sort_order: 1, source_asset_id: null }
    const invalidJob = { id: 12, scope: 'question', status: 'ready', target_set_id: 5, target_question_id: 51, model: 'vision', attempts: 1, stale: false, created_at: '2026-08-27', result: { changes: [{ status: 'invalid', question_id: 51, current: question, candidate: { ...question, id: undefined, question_set_id: undefined, correct_bool: null }, changed_fields: ['correct_bool'], validation_errors: ['判断题缺少明确的正确答案'], repair_attempted: true }], diagnostics: { warnings: ['判断题缺少明确的正确答案'], invalid_count: 1 } } }
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/admin/question-sets') return [{ id: 5, title: '单题入口', description: '', status: 'draft', source_pdf_asset_id: null, question_count: 2, total_points: 4, counts: { true_false: 2 }, questions: [question, noSourceQuestion] }]
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/question-recognition-jobs') return []
      if (path === '/api/admin/import-llm/status') return { configured: true, base_url: 'https://example.test/v1', model: 'vision', batch_pages: 3 }
      if (path === '/api/admin/questions/51/re-recognition' && options?.method === 'POST') return invalidJob
      if (path === '/api/admin/question-recognition-jobs/12/retry' && options?.method === 'POST') return { ...invalidJob, status: 'pending' }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '展开习题集 单题入口' }))
    const triggers = screen.getAllByRole('button', { name: '重新识别' })
    expect(triggers[0]).toBeEnabled()
    expect(triggers[1]).toBeDisabled()
    fireEvent.click(triggers[0])
    const dialog = await screen.findByRole('dialog', { name: '重新识别预览' })
    expect(within(dialog).getByText('高清修复后仍未通过校验')).toBeInTheDocument()
    expect(within(dialog).getAllByText('判断题缺少明确的正确答案')).toHaveLength(2)
    expect(within(dialog).queryByRole('button', { name: /确认应用/ })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '重新识别' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/admin/question-recognition-jobs/12/retry', expect.objectContaining({ method: 'POST' })))
  })

  it('shows active whole-set recognition progress on the more menu', async () => {
    const setJob = { id: 44, scope: 'set', status: 'processing', target_set_id: 14, target_question_id: null, model: 'vision', attempts: 1, stale: false, created_at: '2026-08-30', progress: { phase: 'batch_recognition', label: '正在批量识别', percent: 42, current: 2, total: 5, unit: 'batch', detail: '', updated_at: new Date().toISOString() } }
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/question-sets') return [{ id: 14, title: '整套进度', description: '', status: 'draft', source_pdf_asset_id: 7, question_count: 0, total_points: 0, counts: {}, questions: [] }]
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/question-recognition-jobs') return [setJob]
      if (path === '/api/admin/import-llm/status') return { configured: true, base_url: 'https://example.test/v1', model: 'vision', batch_pages: 3 }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)
    const more = await screen.findByRole('button', { name: '更多操作，整套识别 42%' })
    expect(more.querySelector('.is-spinning')).not.toBeNull()
    fireEvent.click(more)
    const recognize = screen.getByRole('menuitem', { name: /整套重新识别识别中 42%/ })
    expect(recognize).toBeDisabled()
    expect(recognize).toHaveTextContent('42%')
  })

  it('starts set re-recognition and previews image and field differences before applying', async () => {
    const current = { id: 51, question_set_id: 5, type: 'true_false' as const, stem_markdown: '旧题面', explanation_markdown: '', points: 2, sort_order: 0, reviewed: true, correct_bool: true, source_asset_id: 10, show_source_crop: false, options: [], blanks: [], programming: null }
    const candidate = { ...current, id: undefined, question_set_id: undefined, stem_markdown: '新题面', reviewed: false, source_asset_id: 11 }
    const readyJob = { id: 9, scope: 'set', status: 'ready', target_set_id: 5, target_question_id: null, model: 'vision', reasoning_effort: 'high', attempts: 1, stale: false, created_at: '2026-08-27', result: { title: '重识别题套', changes: [{ status: 'matched', question_id: 51, current, candidate, changed_fields: ['stem_markdown', 'source_asset_id'] }], diagnostics: { warnings: [] } } }
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/admin/question-sets') return [{ id: 5, title: '重识别题套', description: '', status: 'draft', source_pdf_asset_id: 7, question_count: 1, total_points: 2, counts: { true_false: 1 }, questions: [current] }]
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/question-recognition-jobs') return [readyJob]
      if (path === '/api/admin/import-llm/status') return { configured: true, base_url: 'https://example.test/v1', model: 'vision', reasoning_effort: 'high', batch_pages: 3 }
      if (path === '/api/admin/question-sets/5/re-recognition' && options?.method === 'POST') return readyJob
      if (path === '/api/admin/question-recognition-jobs/9/apply' && options?.method === 'POST') return { ok: true }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '更多操作 重识别题套' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /整套重新识别/ }))
    const dialog = await screen.findByRole('dialog', { name: '重新识别预览' })
    expect(within(dialog).getByText(/思考级别：high/)).toBeInTheDocument()
    expect(within(dialog).getByAltText('当前原题截图')).toHaveAttribute('src', '/api/question-assets/10')
    expect(within(dialog).getByAltText('重新识别截图')).toHaveAttribute('src', '/api/question-assets/11')
    expect(within(dialog).getByText('旧题面')).toBeInTheDocument()
    expect(within(dialog).getByText('新题面')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /确认应用识别结果/ }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/admin/question-recognition-jobs/9/apply', expect.objectContaining({ method: 'POST' })))
  })

  it('filters the review queue by pending and reviewed state', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/question-sets') return [{
        id: 5, title: '复核题套', description: '', status: 'draft', question_count: 2, total_points: 4,
        counts: { true_false: 2 }, questions: [
          { id: 51, question_set_id: 5, type: 'true_false', stem_markdown: '等待复核题', points: 2, sort_order: 0, reviewed: false, correct_bool: true, options: [], programming: null },
          { id: 52, question_set_id: 5, type: 'true_false', stem_markdown: '已经复核题', points: 2, sort_order: 1, reviewed: true, correct_bool: true, options: [], programming: null },
        ],
      }]
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/question-recognition-jobs') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '展开习题集 复核题套' }))
    expect(screen.getByText('等待复核题')).toBeInTheDocument()
    expect(screen.queryByText('已经复核题')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '已复核 1' }))
    expect(screen.getByText('已经复核题')).toBeInTheDocument()
    expect(screen.queryByText('等待复核题')).not.toBeInTheDocument()
  })

  it('keeps review filters independent for each draft set and shows empty states', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/question-sets') return [
        { id: 5, title: '题套甲', description: '', status: 'draft', question_count: 2, total_points: 4, counts: { true_false: 2 }, questions: [
          { id: 51, question_set_id: 5, type: 'true_false', stem_markdown: '甲待复核', points: 2, sort_order: 0, reviewed: false, correct_bool: true, options: [], programming: null },
          { id: 52, question_set_id: 5, type: 'true_false', stem_markdown: '甲已复核', points: 2, sort_order: 1, reviewed: true, correct_bool: true, options: [], programming: null },
        ] },
        { id: 6, title: '题套乙', description: '', status: 'draft', question_count: 1, total_points: 2, counts: { true_false: 1 }, questions: [
          { id: 61, question_set_id: 6, type: 'true_false', stem_markdown: '乙待复核', points: 2, sort_order: 0, reviewed: false, correct_bool: true, options: [], programming: null },
        ] },
        { id: 7, title: '已发布题套', description: '', status: 'published', question_count: 0, total_points: 0, counts: {}, questions: [] },
      ]
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)
    await screen.findByText('题套甲')
    expect(screen.queryByRole('group', { name: '题套甲复核状态过滤' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '题套乙复核状态过滤' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开习题集 题套甲' }))
    fireEvent.click(screen.getByRole('button', { name: '展开习题集 题套乙' }))
    const firstFilter = screen.getByRole('group', { name: '题套甲复核状态过滤' })
    const secondFilter = screen.getByRole('group', { name: '题套乙复核状态过滤' })
    expect(screen.queryByRole('group', { name: '已发布题套复核状态过滤' })).not.toBeInTheDocument()

    fireEvent.click(within(firstFilter).getByRole('button', { name: '已复核 1' }))
    expect(await screen.findByText('甲已复核')).toBeInTheDocument()
    const firstSetCard = firstFilter.closest('article') as HTMLElement
    expect(within(firstSetCard).getByRole('button', { name: '拖动题目调整顺序' })).toBeDisabled()
    fireEvent.click(within(firstFilter).getByRole('button', { name: '全部 2' }))
    expect(within(firstSetCard).getAllByRole('button', { name: '拖动题目调整顺序' })[0]).not.toBeDisabled()
    fireEvent.click(within(firstFilter).getByRole('button', { name: '已复核 1' }))
    expect(within(secondFilter).getByRole('button', { name: '待复核 1' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(secondFilter).getByRole('button', { name: '已复核 0' }))
    expect(screen.getByText('当前题套没有已复核题目')).toBeInTheDocument()
    expect(within(firstFilter).getByRole('button', { name: '已复核 1' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '收起习题集 题套乙' }))
    expect(screen.queryByRole('group', { name: '题套乙复核状态过滤' })).not.toBeInTheDocument()
  })

  it('opens published questions in a read-only viewer and navigates within the set', async () => {
    const publishedQuestions = [
      { id: 91, question_set_id: 9, type: 'true_false' as const, stem_markdown: '已发布题目一', explanation_markdown: '解析一', points: 2, sort_order: 0, reviewed: true, correct_bool: true, source_asset_id: 44, show_source_crop: true, options: [], blanks: [], programming: null },
      { id: 92, question_set_id: 9, type: 'true_false' as const, stem_markdown: '已发布题目二', explanation_markdown: '解析二', points: 2, sort_order: 1, reviewed: true, correct_bool: false, source_asset_id: null, show_source_crop: false, options: [], blanks: [], programming: null },
    ]
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/question-sets') return [{ id: 9, title: '只读发布题套', description: '', status: 'published', question_count: 2, total_points: 4, counts: { true_false: 2 }, questions: publishedQuestions }]
      if (path === '/api/admin/question-imports' || path === '/api/admin/question-recognition-jobs') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '展开习题集 只读发布题套' }))
    const viewButtons = screen.getAllByRole('button', { name: '查看' })
    expect(viewButtons).toHaveLength(2)
    fireEvent.click(viewButtons[0])

    const viewer = screen.getByRole('form', { name: '题目查看器' })
    expect(viewer).toHaveAttribute('aria-readonly', 'true')
    expect(within(viewer).getByText('已发布题目仅供查看，如需修改请先撤回题套')).toBeInTheDocument()
    expect(within(viewer).queryByRole('button', { name: /保存/ })).not.toBeInTheDocument()
    expect(within(viewer).getByText('只读查看')).toBeInTheDocument()
    expect(within(viewer).getByLabelText('显示原题')).toBeDisabled()
    expect(within(viewer).getByRole('button', { name: '收起原题区域' })).toBeEnabled()
    expect(within(viewer).queryByRole('button', { name: '本地图片替换' })).not.toBeInTheDocument()
    expect(within(viewer).queryByRole('button', { name: '重新识别本题' })).not.toBeInTheDocument()
    expect(within(viewer).queryByRole('button', { name: /题干配图/ })).not.toBeInTheDocument()
    const stem = within(viewer).getByLabelText('题面')
    expect(stem).toHaveValue('已发布题目一')
    fireEvent.change(stem, { target: { value: '不应修改' } })
    expect(stem).toHaveValue('已发布题目一')

    fireEvent.click(within(viewer).getByRole('button', { name: /下一题/ }))
    expect(within(viewer).getByLabelText('题面')).toHaveValue('已发布题目二')
    expect(mockedApi.mock.calls.some(([, options]) => options?.method === 'PUT' || options?.method === 'POST' || options?.method === 'DELETE')).toBe(false)
  })

  it('navigates only inside the active set and keeps the editor open after saving a draft', async () => {
    const firstSetQuestions = [
      { id: 71, question_set_id: 7, type: 'true_false' as const, stem_markdown: '第一题', explanation_markdown: '', points: 2, sort_order: 0, reviewed: false, correct_bool: true, source_asset_id: 3, show_source_crop: false, options: [], blanks: [], programming: null },
      { id: 72, question_set_id: 7, type: 'true_false' as const, stem_markdown: '第二题', explanation_markdown: '', points: 2, sort_order: 1, reviewed: false, correct_bool: false, source_asset_id: null, show_source_crop: false, options: [], blanks: [], programming: null },
    ]
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/admin/question-sets') return [
        { id: 7, title: '当前题套', description: '', status: 'draft', question_count: 2, total_points: 4, counts: { true_false: 2 }, questions: firstSetQuestions },
        { id: 8, title: '其他题套', description: '', status: 'draft', question_count: 1, total_points: 2, counts: { true_false: 1 }, questions: [{ ...firstSetQuestions[0], id: 81, question_set_id: 8, stem_markdown: '不应进入的题目' }] },
      ]
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      if (path === '/api/admin/questions/71' && options?.method === 'PUT') return { ...firstSetQuestions[0], ...JSON.parse(String(options.body)) }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '展开习题集 当前题套' }))
    fireEvent.click(screen.getAllByRole('button', { name: /编辑/ })[0])
    expect(screen.getByRole('heading', { level: 2, name: '当前题套' })).toBeInTheDocument()
    expect(screen.getByText('第 1 / 2 题')).toBeInTheDocument()
    const sourceSwitch = screen.getByLabelText('显示原题')
    const sourceHeading = sourceSwitch.closest('.question-source-heading') as HTMLElement
    expect(sourceHeading).not.toBeNull()
    expect(within(sourceHeading).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      '本地图片替换',
      '重新识别本题',
      '收起原题区域',
    ])
    expect(screen.getByRole('form', { name: '题目编辑器' }).querySelector('.question-editor-header')).not.toHaveTextContent('收起原图')
    fireEvent.click(sourceSwitch)
    expect(sourceSwitch).toBeChecked()
    fireEvent.click(sourceSwitch)
    expect(sourceSwitch).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    expect(screen.getByLabelText('题面')).toHaveValue('第二题')
    expect(screen.queryByDisplayValue('不应进入的题目')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保存并完成复核/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '上一题' }))
    fireEvent.change(screen.getByLabelText('题面'), { target: { value: '第一题（已修改）' } })
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/admin/questions/71', expect.objectContaining({ method: 'PUT' })))
    expect(screen.getByRole('form', { name: '题目编辑器' })).toBeInTheDocument()
    expect(screen.getByLabelText('题面')).toHaveValue('第一题（已修改）')
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
  })

  it('persists the source panel state while reviewing the current set and protects dirty Escape', async () => {
    const questions = [
      { id: 91, question_set_id: 9, type: 'true_false' as const, stem_markdown: '一', explanation_markdown: '', points: 2, sort_order: 0, reviewed: false, correct_bool: true, source_asset_id: 4, show_source_crop: false, options: [], blanks: [], programming: null },
      { id: 92, question_set_id: 9, type: 'true_false' as const, stem_markdown: '二', explanation_markdown: '', points: 2, sort_order: 1, reviewed: false, correct_bool: true, source_asset_id: 5, show_source_crop: false, options: [], blanks: [], programming: null },
    ]
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/question-sets') return [{ id: 9, title: '折叠测试', description: '', status: 'draft', question_count: 2, total_points: 4, counts: { true_false: 2 }, questions }]
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      return { id: 1 }
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '展开习题集 折叠测试' }))
    fireEvent.click(screen.getAllByRole('button', { name: /编辑/ })[0])
    fireEvent.click(screen.getByRole('button', { name: '收起原题区域' }))
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    expect(screen.getByRole('form', { name: '题目编辑器' }).querySelector('.question-editor-body')).toHaveClass('source-collapsed')
    fireEvent.change(screen.getByLabelText('题面'), { target: { value: '二（修改）' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(confirm).toHaveBeenCalledWith('有尚未保存的修改，确认关闭？')
    expect(screen.getByRole('form', { name: '题目编辑器' })).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('uploads and removes a student-facing stem illustration without replacing the source screenshot', async () => {
    const question = { id: 95, question_set_id: 9, type: 'true_false' as const, stem_markdown: '带图判断题', explanation_markdown: '', points: 2, sort_order: 0, reviewed: false, correct_bool: true, source_asset_id: 4, stem_image_asset_id: null, show_source_crop: false, options: [], blanks: [], programming: null }
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/admin/question-sets') return [{ id: 9, title: '题干配图测试', description: '', status: 'draft', question_count: 1, total_points: 2, counts: { true_false: 1 }, questions: [question] }]
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      if (path === '/api/admin/questions/95/stem-image' && options?.method === 'PUT') return { ...question, stem_image_asset_id: 44 }
      if (path === '/api/admin/questions/95/stem-image' && options?.method === 'DELETE') return { ...question, stem_image_asset_id: null }
      return { id: 1 }
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '展开习题集 题干配图测试' }))
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }))
    const file = new File(['image'], 'diagram.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('选择题干配图'), { target: { files: [file] } })
    expect(await screen.findByAltText('题干配图预览')).toHaveAttribute('src', '/api/question-assets/44')
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/questions/95/stem-image', expect.objectContaining({ method: 'PUT', body: expect.any(FormData) }))
    expect(screen.getByRole('button', { name: '替换题干配图' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '移除题干配图' }))
    await waitFor(() => expect(screen.queryByAltText('题干配图预览')).not.toBeInTheDocument())
    expect(screen.getByText('当前没有题干配图')).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/questions/95/stem-image', expect.objectContaining({ method: 'DELETE' }))
    confirm.mockRestore()
  })

  it('uploads a source screenshot from the image toolbar and enables its student visibility switch', async () => {
    const question = { id: 96, question_set_id: 9, type: 'true_false' as const, stem_markdown: '缺少原图', explanation_markdown: '', points: 2, sort_order: 0, reviewed: false, correct_bool: true, source_asset_id: null, stem_image_asset_id: null, show_source_crop: false, options: [], blanks: [], programming: null }
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/admin/question-sets') return [{ id: 9, title: '原图上传测试', description: '', status: 'draft', source_pdf_asset_id: null, question_count: 1, total_points: 2, counts: { true_false: 1 }, questions: [question] }]
      if (path === '/api/admin/question-imports' || path === '/api/admin/question-recognition-jobs') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      if (path === '/api/admin/questions/96/source-image' && options?.method === 'PUT') return { ...question, source_asset_id: 45 }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '展开习题集 原图上传测试' }))
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }))
    expect(screen.queryByLabelText('显示原题')).not.toBeInTheDocument()
    const file = new File(['image'], 'source.webp', { type: 'image/webp' })
    fireEvent.change(screen.getByLabelText('选择原题图片'), { target: { files: [file] } })
    expect(await screen.findByAltText('原题截图')).toHaveAttribute('src', '/api/question-assets/45')
    expect(screen.getByRole('button', { name: '本地图片替换' })).toBeInTheDocument()
    expect(screen.getByLabelText('显示原题')).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/questions/96/source-image', expect.objectContaining({ method: 'PUT', body: expect.any(FormData) }))
  })

  it('keeps image upload and recognition icons disabled until a new question is saved', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/question-sets') return [{ id: 12, title: '新题测试', description: '', status: 'draft', source_pdf_asset_id: 8, question_count: 0, total_points: 0, counts: {}, questions: [] }]
      if (path === '/api/admin/question-imports' || path === '/api/admin/question-recognition-jobs') return []
      if (path === '/api/admin/import-llm/status') return { configured: true, base_url: 'https://example.test/v1', model: 'vision', batch_pages: 3 }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '题目' }))
    const editor = screen.getByRole('form', { name: '题目编辑器' })
    expect(within(editor).getByRole('button', { name: '上传原题图片' })).toBeDisabled()
    expect(within(editor).getByRole('button', { name: '重新识别本题' })).toBeDisabled()
    expect(within(editor).getByRole('button', { name: '上传题干配图' })).toBeDisabled()
    expect(within(editor).queryByLabelText('显示原题')).not.toBeInTheDocument()
  })

  it('reviews forward with the keyboard and closes after the last item in the set queue', async () => {
    const notify = vi.fn()
    const questions = [
      { id: 101, question_set_id: 10, type: 'true_false' as const, stem_markdown: '复核一', explanation_markdown: '', points: 2, sort_order: 0, reviewed: false, correct_bool: true, source_asset_id: null, show_source_crop: false, options: [], blanks: [], programming: null },
      { id: 102, question_set_id: 10, type: 'true_false' as const, stem_markdown: '复核二', explanation_markdown: '', points: 2, sort_order: 1, reviewed: false, correct_bool: true, source_asset_id: null, show_source_crop: false, options: [], blanks: [], programming: null },
    ]
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/admin/question-sets') return [{ id: 10, title: '快捷复核', description: '', status: 'draft', question_count: 2, total_points: 4, counts: { true_false: 2 }, questions }]
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      if (/^\/api\/admin\/questions\/\d+$/.test(path) && options?.method === 'PUT') return { ...questions.find((item) => path.endsWith(String(item.id))), ...JSON.parse(String(options.body)), reviewed: false }
      if (/^\/api\/admin\/questions\/\d+\/review$/.test(path)) return { ...questions.find((item) => path.includes(`/${item.id}/`)), reviewed: true }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel notify={notify} />)
    fireEvent.click(await screen.findByRole('button', { name: '展开习题集 快捷复核' }))
    fireEvent.click(screen.getAllByRole('button', { name: /编辑/ })[0])
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText('题面')).toHaveValue('复核二'))
    expect(screen.getByRole('button', { name: /保存并完成复核/ })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(screen.queryByRole('form', { name: '题目编辑器' })).not.toBeInTheDocument())
    expect(notify).toHaveBeenCalledWith('success', '当前过滤队列已复核完成')
    expect(mockedApi.mock.calls.filter(([path]) => /\/review$/.test(path))).toHaveLength(2)
  })

  it('reorders sets and questions and saves complete id lists', async () => {
    const sets = [
      { id: 1, title: 'A', description: '', status: 'draft' as const, question_count: 0, total_points: 0, counts: { single_choice: 0, multiple_choice: 0, true_false: 0, programming: 0 } },
      { id: 2, title: 'B', description: '', status: 'draft' as const, question_count: 0, total_points: 0, counts: { single_choice: 0, multiple_choice: 0, true_false: 0, programming: 0 } },
    ]
    const reorderedSets = reorderQuestionSetList(sets, 2, 1)
    expect(reorderedSets.map((item) => [item.id, item.sort_order])).toEqual([[2, 0], [1, 1]])
    await saveQuestionSetOrder(reorderedSets)
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/question-sets/order', expect.objectContaining({ body: JSON.stringify({ question_set_ids: [2, 1] }) }))

    const base = { question_set_id: 1, type: 'true_false' as const, stem_markdown: '题目', points: 2, reviewed: true, options: [], programming: null }
    const questions = [{ ...base, id: 10, sort_order: 0 }, { ...base, id: 11, sort_order: 1 }]
    const reorderedQuestions = reorderQuestionList(questions, 11, 10)
    expect(reorderedQuestions.map((item) => [item.id, item.sort_order])).toEqual([[11, 0], [10, 1]])
    await saveQuestionOrder(1, reorderedQuestions)
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/question-sets/1/questions/order', expect.objectContaining({ body: JSON.stringify({ question_ids: [11, 10] }) }))
  })

  it('requires an explicit answer when an imported true-false question has no answer', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/question-sets') return [{
        id: 2, title: '导入题套', description: '', status: 'draft', question_count: 1, total_points: 2,
        counts: { single_choice: 0, multiple_choice: 0, true_false: 1, programming: 0 },
        questions: [{
          id: 19, question_set_id: 2, type: 'true_false', stem_markdown: '判断题', explanation_markdown: '',
          points: 2, sort_order: 0, reviewed: false, correct_bool: null, source_page: 1,
          source_asset_id: null, show_source_crop: false, options: [], programming: null,
        }],
      }]
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      if (path === '/api/admin/exercise-reports/summary') return { session_count: 0, average_percent: 0, unresolved_wrong_count: 0 }
      return { id: 19 }
    })

    render(<QuestionLibraryPanel />)
    const setDisclosure = await screen.findByRole('button', { name: '展开习题集 导入题套' })
    expect(setDisclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('判断题')).not.toBeInTheDocument()
    fireEvent.click(setDisclosure)
    expect(setDisclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('判断题')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /编辑/ }))

    expect(screen.queryByLabelText('顺序')).not.toBeInTheDocument()
    const answer = screen.getByLabelText('正确答案')
    expect(answer).toHaveValue('')
    expect(answer).toBeRequired()
    fireEvent.change(answer, { target: { value: 'false' } })
    expect(answer).toHaveValue('false')
  })

  it('keeps bundle export out of the library and manages source PDFs from the more menu', async () => {
    const sets = [
      { id: 21, title: '可迁移草稿', description: '', status: 'draft', source_pdf_asset_id: null, question_count: 0, total_points: 0, counts: {}, questions: [] },
      { id: 22, title: '已发布迁移题套', description: '', status: 'published', source_pdf_asset_id: 8, question_count: 0, total_points: 0, counts: {}, questions: [] },
    ]
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/admin/question-sets') return sets
      if (path === '/api/admin/question-imports') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      if (path === '/api/admin/question-sets/21/source-pdf' && options?.method === 'PUT') return { ...sets[0], source_pdf_asset_id: 12 }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)
    await screen.findByText('可迁移草稿')
    expect(screen.queryByRole('button', { name: '导出迁移包' })).not.toBeInTheDocument()

    const draftMore = screen.getByRole('button', { name: '更多操作 可迁移草稿' })
    fireEvent.keyDown(draftMore, { key: 'ArrowDown' })
    const draftMenu = screen.getByRole('menu', { name: '可迁移草稿操作菜单' })
    expect(within(draftMenu).getByRole('menuitem', { name: /上传原始 PDF/ })).toHaveFocus()
    fireEvent.keyDown(draftMenu, { key: 'ArrowDown' })
    expect(within(draftMenu).getByRole('menuitem', { name: '归档题套' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: '可迁移草稿操作菜单' })).not.toBeInTheDocument()
    await waitFor(() => expect(draftMore).toHaveFocus())

    fireEvent.click(draftMore)
    const pdf = new File(['pdf'], 'paper.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('上传题套 可迁移草稿 原始 PDF'), { target: { files: [pdf] } })
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/admin/question-sets/21/source-pdf', expect.objectContaining({ method: 'PUT', body: expect.any(FormData) })))

    const publishedMore = screen.getByRole('button', { name: '更多操作 已发布迁移题套' })
    fireEvent.click(publishedMore)
    const publishedMenu = screen.getByRole('menu', { name: '已发布迁移题套操作菜单' })
    expect(within(publishedMenu).getByRole('menuitem', { name: /替换原始 PDF/ })).toBeDisabled()
    expect(within(publishedMenu).getByRole('menuitem', { name: /替换原始 PDF/ })).toHaveAttribute('title', '请先将题套撤回为草稿')
    expect(within(publishedMenu).queryByRole('menuitem', { name: /永久删除/ })).not.toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu', { name: '已发布迁移题套操作菜单' })).not.toBeInTheDocument()
  })

  it('shows status-specific primary actions and keeps row actions in the requested order', async () => {
    const programming = {
      id: 301, question_set_id: 31, type: 'programming', stem_markdown: '编程题', explanation_markdown: '', points: 10,
      sort_order: 0, reviewed: false, source_asset_id: 12, show_source_crop: false, options: [], blanks: [],
      programming: { input_markdown: '', output_markdown: '', constraints_markdown: '', starter_code: '', reference_solution: '', time_limit_ms: 1000, memory_limit_mb: 128, cases: [] },
    }
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/question-sets') return [
        { id: 31, title: '草稿操作题套', description: '', status: 'draft', source_pdf_asset_id: 10, question_count: 1, total_points: 10, counts: { programming: 1 }, questions: [programming] },
        { id: 32, title: '发布操作题套', description: '', status: 'published', source_pdf_asset_id: 11, question_count: 0, total_points: 0, counts: {}, questions: [] },
        { id: 33, title: '归档操作题套', description: '', status: 'archived', source_pdf_asset_id: 13, question_count: 0, total_points: 0, counts: {}, questions: [] },
      ]
      if (path === '/api/admin/question-imports' || path === '/api/admin/question-recognition-jobs') return []
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '', batch_pages: 3 }
      return { id: 1 }
    })
    render(<QuestionLibraryPanel />)

    const draftCard = (await screen.findByText('草稿操作题套')).closest('article') as HTMLElement
    const publishedCard = screen.getByText('发布操作题套').closest('article') as HTMLElement
    const archivedCard = screen.getByText('归档操作题套').closest('article') as HTMLElement
    expect(within(draftCard).getByRole('button', { name: '题目' })).toBeInTheDocument()
    expect(within(draftCard).getByRole('button', { name: '发布' })).toBeInTheDocument()
    const draftMainRow = draftCard.querySelector('.question-set-main-row') as HTMLElement
    expect(within(draftMainRow).getByRole('button', { name: '展开习题集 草稿操作题套' })).toBeInTheDocument()
    expect(within(draftMainRow).getByRole('button', { name: '题目' })).toBeInTheDocument()
    expect(within(draftMainRow).getByRole('button', { name: '发布' })).toBeInTheDocument()
    expect(within(draftCard).queryByRole('group', { name: '草稿操作题套复核状态过滤' })).not.toBeInTheDocument()
    expect(within(publishedCard).getByRole('button', { name: '撤回' })).toBeInTheDocument()
    expect(within(publishedCard).queryByRole('group', { name: /复核状态过滤/ })).not.toBeInTheDocument()
    expect(within(archivedCard).queryByRole('button', { name: '题目' })).not.toBeInTheDocument()
    expect(within(archivedCard).queryByRole('button', { name: '撤回' })).not.toBeInTheDocument()
    expect(within(archivedCard).getByRole('button', { name: '更多操作 归档操作题套' })).toBeInTheDocument()

    fireEvent.click(within(draftCard).getByRole('button', { name: '更多操作 草稿操作题套' }))
    const menu = within(draftCard).getByRole('menu', { name: '草稿操作题套操作菜单' })
    expect(within(menu).getByRole('menuitem', { name: /替换原始 PDF/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /整套重新识别/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '归档题套' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '永久删除题套' })).toBeInTheDocument()
    expect(within(menu).queryByText('导出迁移包')).not.toBeInTheDocument()
    fireEvent.pointerDown(document.body)

    fireEvent.click(within(draftCard).getByRole('button', { name: '展开习题集 草稿操作题套' }))
    expect(within(draftCard).getByRole('group', { name: '草稿操作题套复核状态过滤' })).toBeInTheDocument()
    const row = within(draftCard).getByText('编程题', { selector: 'p' }).closest('.sortable-question-row') as HTMLElement
    const generate = within(row).getByRole('button', { name: /生成输出/ })
    const edit = within(row).getByRole('button', { name: /编辑/ })
    const recognize = within(row).getByRole('button', { name: '重新识别' })
    const remove = within(row).getByRole('button', { name: '删除题目 1' })
    const buttons: HTMLElement[] = [...row.querySelectorAll('button')]
    expect(buttons.indexOf(generate)).toBeLessThan(buttons.indexOf(edit))
    expect(buttons.indexOf(edit)).toBeLessThan(buttons.indexOf(recognize))
    expect(buttons.indexOf(recognize)).toBeLessThan(buttons.indexOf(remove))
    expect(recognize).toHaveTextContent('')
  })
})
