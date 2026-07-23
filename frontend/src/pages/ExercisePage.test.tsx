import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { api } from '../api'
import type { ExerciseSession } from '../types'
import { ExercisePage, MarkdownText, pythonIndentEdit } from './ExercisePage'

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
  return render(<MemoryRouter initialEntries={['/exercise/7']}><Routes><Route path="/" element={<p>学生首页</p>} /><Route path="/exercise/:sessionId" element={<ExercisePage />} /></Routes></MemoryRouter>)
}

function makeProgrammingSession(): ExerciseSession {
  return {
    id: 7, title: '编程题', mode: 'set', status: 'in_progress', score: null, max_score: 25,
    items: [{
      id: 72, sort_order: 0, points: 25,
      question: {
        id: 4, type: 'programming', stem_markdown: '循环输出', points: 25, sort_order: 0, options: [],
        programming: { input_markdown: '', output_markdown: '', constraints_markdown: '', starter_code: 'for i in range(3):', time_limit_ms: 1000, memory_limit_mb: 128, cases: [{ id: 1, input_data: '3\n', expected_output: '0\n1\n2\n', is_sample: true, weight: 0 }] },
      },
      answer: { selected_option_ids: [], bool_answer: null, code: '', status: 'unanswered' },
    }],
  }
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
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ selected_option_ids: [32], bool_answer: null, code: '' }) }),
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

  it('resumes at the first unanswered question', async () => {
    const resumed: ExerciseSession = JSON.parse(JSON.stringify(activeSession))
    resumed.items = [
      { ...resumed.items[0], id: 71, question: { ...resumed.items[0].question, stem_markdown: '已经回答的第一题' }, answer: { ...resumed.items[0].answer, selected_option_ids: [31], status: 'answered' } },
      { ...resumed.items[0], id: 72, sort_order: 1, question: { ...resumed.items[0].question, stem_markdown: '第一道未答题' } },
      { ...resumed.items[0], id: 73, sort_order: 2, question: { ...resumed.items[0].question, stem_markdown: '后面的未答题' } },
    ]
    mockedApi.mockResolvedValue(resumed)
    renderPage()
    expect(await screen.findByText('第一道未答题')).toBeInTheDocument()
    expect(screen.getByText('/ 3')).toBeInTheDocument()
  })

  it('resumes at the last question when every answer is saved but not submitted', async () => {
    const resumed: ExerciseSession = JSON.parse(JSON.stringify(activeSession))
    resumed.items = [
      { ...resumed.items[0], id: 71, question: { ...resumed.items[0].question, stem_markdown: '第一题' }, answer: { ...resumed.items[0].answer, selected_option_ids: [31], status: 'answered' } },
      { ...resumed.items[0], id: 72, sort_order: 1, question: { ...resumed.items[0].question, stem_markdown: '最后一题' }, answer: { ...resumed.items[0].answer, selected_option_ids: [32], status: 'answered' } },
    ]
    mockedApi.mockResolvedValue(resumed)
    renderPage()
    expect(await screen.findByText('最后一题')).toBeInTheDocument()
    expect(screen.getByText(/全部题目均已作答，尚未提交/)).toBeInTheDocument()
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
    const programming = makeProgrammingSession()
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/sessions/7' ? programming : { ok: true })
    renderPage()
    const editor = await screen.findByLabelText('Python 3.13 代码')
    expect(editor).toHaveValue('for i in range(3):')
    expect(screen.getByRole('button', { name: /运行公开样例/ })).toBeEnabled()
    expect(screen.getByText(/^3$/)).toBeInTheDocument()
    fireEvent.change(editor, { target: { value: 'for i in range(3):\n    print(i)' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/exercises/sessions/7/answers/72',
      expect.objectContaining({ body: JSON.stringify({ selected_option_ids: [], bool_answer: null, code: 'for i in range(3):\n    print(i)' }) }),
    ))
    fireEvent.change(editor, { target: { value: '' } })
    expect(editor).toHaveValue('')
  })

  it('flushes a programming draft before saving and exiting', async () => {
    const programming = makeProgrammingSession()
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/sessions/7' ? programming : { ok: true })
    renderPage()
    const editor = await screen.findByLabelText('Python 3.13 代码')
    fireEvent.change(editor, { target: { value: 'print("saved")' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并退出' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/exercises/sessions/7/answers/72',
      expect.objectContaining({ body: JSON.stringify({ selected_option_ids: [], bool_answer: null, code: 'print("saved")' }) }),
    ))
    expect(await screen.findByText('学生首页')).toBeInTheDocument()
  })

  it('waits for a pending save before leaving the exercise', async () => {
    const programming = makeProgrammingSession()
    let releaseSave: () => void = () => undefined
    const pendingSave = new Promise<{ ok: boolean }>((resolve) => { releaseSave = () => resolve({ ok: true }) })
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/exercises/sessions/7') return programming
      return await pendingSave
    })
    renderPage()
    const editor = await screen.findByLabelText('Python 3.13 代码')
    fireEvent.change(editor, { target: { value: 'print("retry")' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并退出' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/exercises/sessions/7/answers/72', expect.anything()))
    expect(screen.getByRole('button', { name: '保存并退出' })).toBeInTheDocument()
    expect(screen.queryByText('学生首页')).not.toBeInTheDocument()
    releaseSave()
    expect(await screen.findByText('学生首页')).toBeInTheDocument()
  })

  it('coalesces blur and sample-run saves for the same code', async () => {
    const programming = makeProgrammingSession()
    let releaseSave: () => void = () => undefined
    const pendingSave = new Promise<{ ok: boolean }>((resolve) => { releaseSave = () => resolve({ ok: true }) })
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/exercises/sessions/7') return programming
      if (path === '/api/exercises/sessions/7/answers/72') return await pendingSave
      if (path === '/api/exercises/sessions/7/sample-runs') return { job_id: 'sample-1' }
      return { status: 'complete', cases: [] }
    })
    renderPage()
    const editor = await screen.findByLabelText('Python 3.13 代码')
    const runButton = screen.getByRole('button', { name: /运行公开样例/ })
    fireEvent.change(editor, { target: { value: 'print("once")' } })
    fireEvent.blur(editor)
    fireEvent.click(runButton)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/exercises/sessions/7/answers/72', expect.anything()))
    expect(mockedApi.mock.calls.filter(([path]) => path === '/api/exercises/sessions/7/answers/72')).toHaveLength(1)
    releaseSave()
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/exercises/sessions/7/sample-runs', expect.anything()))
  })

  it('shows an abandoned session as read-only without revealing answers', async () => {
    const abandoned: ExerciseSession = JSON.parse(JSON.stringify(activeSession))
    abandoned.status = 'abandoned'
    mockedApi.mockResolvedValue(abandoned)
    renderPage()
    expect(await screen.findByText('本次练习已放弃')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /input/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /提交整套练习/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/^正确答案：/)).not.toBeInTheDocument()
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

  it('renders safe Markdown emphasis, lists, headings, and inline code', () => {
    const view = render(<MarkdownText value={'## 输入说明\n\n**重点**\n\n- 第一项\n- 使用 `input()`\n\n![外部图](https://example.test/x.png)'} />)
    expect(screen.getByRole('heading', { name: '输入说明' })).toBeInTheDocument()
    expect(screen.getByText('重点').tagName).toBe('STRONG')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('input()').tagName).toBe('CODE')
    expect(screen.getByText('[图片：外部图]')).toBeInTheDocument()
    expect(view.container.querySelector('img')).toBeNull()
  })
})
