import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { api } from '../api'
import type { ExerciseSession } from '../types'
import { ExercisePage } from './ExercisePage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})

const mockedApi = vi.mocked(api)
const activeSession: ExerciseSession = {
  id: 7, title: 'Python 一级', mode: 'set', status: 'in_progress', score: null, max_score: 2,
  items: [{
    id: 71, sort_order: 0, points: 2,
    question: {
      id: 3, type: 'single_choice', stem_markdown: 'Python 的输入函数是？', points: 2, sort_order: 0, options: [
        { id: 31, label: 'A', content_markdown: 'print', sort_order: 0 },
        { id: 32, label: 'B', content_markdown: 'input', sort_order: 1 },
      ],
    },
    answer: { selected_option_ids: [], bool_answer: null, code: '', status: 'unanswered' },
  }],
}

function renderPage() {
  return render(<MemoryRouter initialEntries={['/exercise/7']}><Routes><Route path="/exercise/:sessionId" element={<ExercisePage />} /></Routes></MemoryRouter>)
}

describe('ExercisePage', () => {
  beforeEach(() => mockedApi.mockReset())

  it('renders objective questions and autosaves the selected answer', async () => {
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/sessions/7' ? activeSession : { ok: true })
    renderPage()
    await screen.findByText('Python 的输入函数是？')
    fireEvent.click(screen.getByText('input'))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/exercises/sessions/7/answers/71',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ selected_option_ids: [32], bool_answer: null, code: '' }) }),
    ))
  })

  it('shows solutions and awarded points only for a completed session', async () => {
    const completed: ExerciseSession = JSON.parse(JSON.stringify(activeSession))
    completed.status = 'completed'; completed.score = 2
    completed.items[0].question.explanation_markdown = 'input 用于读取输入。'
    completed.items[0].question.options[1].correct = true
    completed.items[0].answer = { selected_option_ids: [32], bool_answer: null, code: '', status: 'correct', awarded_points: 2, details: { correct: true } }
    mockedApi.mockResolvedValue(completed)
    renderPage()
    expect(await screen.findByText('回答正确')).toBeInTheDocument()
    expect(screen.getByText('input 用于读取输入。')).toBeInTheDocument()
    expect(screen.getByText('2 / 2 分')).toBeInTheDocument()
  })
})
