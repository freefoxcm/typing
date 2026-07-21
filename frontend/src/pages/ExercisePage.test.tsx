import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { api } from '../api'
import type { ExerciseSession } from '../types'
import { ExercisePage, pythonIndentEdit } from './ExercisePage'

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

  it('keeps Python indentation on Enter and supports Tab indentation', () => {
    expect(pythonIndentEdit('for i in range(3):', 18, 18, 'Enter')).toEqual({
      value: 'for i in range(3):\n    ', selectionStart: 23, selectionEnd: 23,
    })
    expect(pythonIndentEdit('    if ready:', 13, 13, 'Enter').value).toBe('    if ready:\n        ')
    expect(pythonIndentEdit('a = 1\nb = 2', 0, 11, 'Tab').value).toBe('    a = 1\n    b = 2')
    expect(pythonIndentEdit('    a = 1\n    b = 2', 4, 19, 'Tab', true).value).toBe('a = 1\nb = 2')
  })

  it('treats starter code as an editable draft and saves exact whitespace', async () => {
    const programming: ExerciseSession = {
      id: 7, title: '编程题', mode: 'set', status: 'in_progress', score: null, max_score: 25,
      items: [{
        id: 72, sort_order: 0, points: 25,
        question: {
          id: 4, type: 'programming', stem_markdown: '循环输出', points: 25, sort_order: 0, options: [],
          programming: { input_markdown: '', output_markdown: '', constraints_markdown: '', starter_code: 'for i in range(3):', time_limit_ms: 1000, memory_limit_mb: 128, cases: [] },
        },
        answer: { selected_option_ids: [], bool_answer: null, code: '', status: 'unanswered' },
      }],
    }
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/sessions/7' ? programming : { ok: true })
    renderPage()
    const editor = await screen.findByLabelText('Python 3.13 代码')
    expect(editor).toHaveValue('for i in range(3):')
    expect(screen.getByRole('button', { name: /运行公开样例/ })).toBeEnabled()
    fireEvent.change(editor, { target: { value: 'for i in range(3):\n    print(i)' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/exercises/sessions/7/answers/72',
      expect.objectContaining({ body: JSON.stringify({ selected_option_ids: [], bool_answer: null, code: 'for i in range(3):\n    print(i)' }) }),
    ))
    fireEvent.change(editor, { target: { value: '' } })
    expect(editor).toHaveValue('')
  })

  it('renders raw HTML and external image Markdown as inert text', async () => {
    const hostile: ExerciseSession = JSON.parse(JSON.stringify(activeSession))
    hostile.items[0].question.stem_markdown = '<script>alert(1)</script> ![x](https://example.test/x.png)'
    mockedApi.mockResolvedValue(hostile)
    const view = renderPage()
    expect(await screen.findByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument()
    expect(view.container.querySelector('script')).toBeNull()
    expect(view.container.querySelector('img')).toBeNull()
  })
})
