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
      if (path === '/api/admin/import-llm/status') return { configured: false, base_url: '', model: '' }
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
      if (path === '/api/admin/import-llm/status') return { configured: true, base_url: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3' }
      if (path === '/api/admin/exercise-reports/summary') return { session_count: 0, average_percent: 0, unresolved_wrong_count: 0 }
      return { id: 1 }
    })

    render(<QuestionLibraryPanel />)

    expect(await screen.findByText(/MiniMax-M3 · https:\/\/api\.minimaxi\.com\/v1/)).toBeInTheDocument()
    expect(screen.getByText(/unknown model/)).toBeInTheDocument()
  })
})
