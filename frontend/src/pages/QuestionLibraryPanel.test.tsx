import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../api'
import { QuestionLibraryPanel } from './QuestionLibraryPanel'

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
    expect(screen.getByText('上传 PDF').closest('label')?.querySelector('input[type="file"]')).toBeDisabled()
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
    expect(await screen.findByText(/单选 15 · 多选 0 · 判断 10 · 编程 2 · 重试页 4/)).toBeInTheDocument()
    expect(screen.getByText('第 4 页需要人工核对')).toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: /编辑/ }))

    const answer = screen.getByLabelText('正确答案')
    expect(answer).toHaveValue('')
    expect(answer).toBeRequired()
    fireEvent.change(answer, { target: { value: 'false' } })
    expect(answer).toHaveValue('false')
  })
})
