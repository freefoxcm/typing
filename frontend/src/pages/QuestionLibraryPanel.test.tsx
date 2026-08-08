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
      if (path === '/api/admin/question-imports') return [{ id: 2, status: 'ready', attempts: 1, created_at: '2026-07-21', page_count: 5, counts: { single_choice: 15, multiple_choice: 0, true_false: 10, programming: 2 }, retried_pages: [4], warnings: ['第 4 页需要人工核对'] }]
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
    const firstFilter = await screen.findByRole('group', { name: '题套甲复核状态过滤' })
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
    const sourceSwitch = screen.getByLabelText('向学生显示原题截图')
    expect(sourceSwitch.closest('.question-source-heading')).not.toBeNull()
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

  it('reviews forward with the keyboard and closes after the last item in the set queue', async () => {
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
    render(<QuestionLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '展开习题集 快捷复核' }))
    fireEvent.click(screen.getAllByRole('button', { name: /编辑/ })[0])
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText('题面')).toHaveValue('复核二'))
    expect(screen.getByRole('button', { name: /保存并完成复核/ })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(screen.queryByRole('form', { name: '题目编辑器' })).not.toBeInTheDocument())
    expect(screen.getByText('当前过滤队列已复核完成')).toBeInTheDocument()
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
})
