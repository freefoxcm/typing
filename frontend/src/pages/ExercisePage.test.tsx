import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { api } from '../api'
import type { ExerciseSession } from '../types'
import { ExercisePage, MarkdownText, pythonIndentEdit, readPythonEditorPreferences } from './ExercisePage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})

vi.mock('../components/PythonCodeEditor', () => ({
  PythonCodeEditor: ({ value, disabled, diagnostics, onChange, onBlur, onRun, runDisabled, runLabel, autoCompletionEnabled, onAutoCompletionChange, autoSyntaxEnabled, onAutoSyntaxChange, onSyntaxCheck, syntaxCheckDisabled, autoFormatEnabled, onAutoFormatChange, onFormat, formatStatus }: {
    value: string
    disabled: boolean
    diagnostics: unknown[]
    onChange: (value: string) => void
    onBlur: (value: string) => void
    onRun?: () => void
    runDisabled?: boolean
    runLabel?: string
    autoCompletionEnabled?: boolean
    onAutoCompletionChange?: (enabled: boolean) => void
    autoSyntaxEnabled?: boolean
    onAutoSyntaxChange?: (enabled: boolean) => void
    onSyntaxCheck?: () => void
    syntaxCheckDisabled?: boolean
    autoFormatEnabled?: boolean
    onAutoFormatChange?: (enabled: boolean) => void
    onFormat?: () => void
    formatStatus?: string
  }) => <div>
    <textarea aria-label="Python 3.13 代码" value={value} disabled={disabled} data-diagnostic-count={diagnostics.length} onChange={(event) => onChange(event.target.value)} onBlur={() => onBlur(value)} />
    {onRun && <button disabled={runDisabled} onClick={onRun}>{runLabel}</button>}
    {onAutoCompletionChange && <button aria-label="智能补全" aria-pressed={autoCompletionEnabled} onClick={() => onAutoCompletionChange(!autoCompletionEnabled)}>智能补全</button>}
    {onAutoSyntaxChange && <button aria-label="自动语法检查" aria-pressed={autoSyntaxEnabled} onClick={() => onAutoSyntaxChange(!autoSyntaxEnabled)}>自动语法检查</button>}
    {onSyntaxCheck && <button aria-label="立即检查语法" disabled={syntaxCheckDisabled} onClick={onSyntaxCheck}>检查语法</button>}
    {onAutoFormatChange && <button aria-label="自动格式化" aria-pressed={autoFormatEnabled} onClick={() => onAutoFormatChange(!autoFormatEnabled)}>自动格式化</button>}
    {onFormat && <button aria-label="立即格式化代码" onClick={onFormat}>格式化</button>}
    {formatStatus && <span>{formatStatus}</span>}
  </div>,
}))

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
        programming: { input_markdown: '', output_markdown: '', constraints_markdown: '', starter_code: 'for i in range(3):', time_limit_ms: 1000, memory_limit_mb: 128, cases: [{ id: 1, input_data: '3\n', expected_output: '0\n1\n2\n', is_sample: true, weight: 0, explanation_markdown: '循环输出 $H_1$。' }] },
      },
      answer: { selected_option_ids: [], bool_answer: null, code: '', status: 'unanswered' },
    }],
  }
}

describe('ExercisePage', () => {
  beforeEach(() => { mockedApi.mockReset(); window.localStorage.clear() })

  it('renders objective questions and autosaves the selected answer', async () => {
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/sessions/7' ? activeSession : { ok: true })
    renderPage()
    await screen.findByText('Python 的输入函数是？')
    fireEvent.click(screen.getByText('input'))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/exercises/sessions/7/answers/71',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ selected_option_ids: [32], bool_answer: null, blank_answers: [], code: '' }) }),
    ))
  })

  it('uses the compact save state without showing a saved-answer banner', async () => {
    let finishSave: () => void = () => undefined
    const pendingSave = new Promise<{ ok: boolean }>((resolve) => { finishSave = () => resolve({ ok: true }) })
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/sessions/7' ? activeSession : await pendingSave)
    renderPage()
    const option = await screen.findByRole('radio', { name: /input/ })
    expect(screen.getByText('所有答案已保存')).toBeInTheDocument()
    fireEvent.click(option)
    expect(await screen.findByText('正在保存…')).toBeInTheDocument()
    expect(screen.queryByText(/^答案已保存$/)).not.toBeInTheDocument()
    await act(async () => finishSave())
    await waitFor(() => expect(screen.getByText('所有答案已保存')).toBeInTheDocument())
  })

  it('waits for every active answer request before reporting all answers saved', async () => {
    let finishFirst: () => void = () => undefined
    let finishSecond: () => void = () => undefined
    const firstSave = new Promise<{ ok: boolean }>((resolve) => { finishFirst = () => resolve({ ok: true }) })
    const secondSave = new Promise<{ ok: boolean }>((resolve) => { finishSecond = () => resolve({ ok: true }) })
    let saveRequest = 0
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/exercises/sessions/7') return activeSession
      saveRequest += 1
      return await (saveRequest === 1 ? firstSave : secondSave)
    })
    renderPage()
    const printOption = await screen.findByRole('radio', { name: /print/ })
    const inputOption = screen.getByRole('radio', { name: /input/ })
    fireEvent.click(printOption)
    fireEvent.click(inputOption)
    await waitFor(() => expect(saveRequest).toBe(2))
    await act(async () => finishFirst())
    expect(screen.getByText('正在保存…')).toBeInTheDocument()
    await act(async () => finishSecond())
    await waitFor(() => expect(screen.getByText('所有答案已保存')).toBeInTheDocument())
  })

  it('shows a persistent compact error state when saving an answer fails', async () => {
    let failSave: () => void = () => undefined
    const failedSave = new Promise<never>((_, reject) => { failSave = () => reject(new Error('网络连接中断')) })
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/exercises/sessions/7') return activeSession
      if (path === '/api/exercises/sessions/7/answers/71') return await failedSave
      return { ok: true }
    })
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: /input/ }))
    expect(await screen.findByText('正在保存…')).toBeInTheDocument()
    failSave()
    expect(await screen.findByText('保存失败，请重试')).toBeInTheDocument()
    expect(screen.getByText('网络连接中断')).toBeInTheDocument()
    expect(screen.queryByText(/^答案已保存$/)).not.toBeInTheDocument()
  })

  it('renders a stem illustration independently from the complete source screenshot', async () => {
    const illustrated: ExerciseSession = JSON.parse(JSON.stringify(activeSession))
    illustrated.items[0].question.stem_image_asset_id = 88
    illustrated.items[0].question.source_asset_id = 77
    illustrated.items[0].question.show_source_crop = false
    mockedApi.mockResolvedValue(illustrated)
    renderPage()
    const image = await screen.findByAltText('题目配图')
    expect(image).toHaveAttribute('src', '/api/question-assets/88')
    expect(screen.queryByAltText('完整原题截图')).not.toBeInTheDocument()
  })

  it('renders multiple fill blanks and saves answers by position', async () => {
    const fillSession: ExerciseSession = {
      id: 7, title: '填空题', mode: 'set', status: 'in_progress', score: null, max_score: 4,
      items: [{
        id: 73, sort_order: 0, points: 4,
        question: { id: 5, type: 'fill_blank', stem_markdown: '$x_1$ 的值是 {{1}}，使用 {{2}} 输出。', points: 4, sort_order: 0, options: [], blanks: [{ id: 1, position: 1 }, { id: 2, position: 2 }] },
        answer: { selected_option_ids: [], bool_answer: null, blank_answers: ['', ''], code: '', status: 'unanswered' },
      }],
    }
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/sessions/7' ? fillSession : { ok: true })
    renderPage()
    const first = await screen.findByLabelText('第 1 空')
    expect(first.closest('.fill-blank-answer')?.querySelector('.katex')).not.toBeNull()
    fireEvent.change(first, { target: { value: 'Python' } })
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/exercises/sessions/7/answers/73',
      expect.objectContaining({ body: JSON.stringify({ selected_option_ids: [], bool_answer: null, blank_answers: ['Python', ''], code: '' }) }),
    ))
    expect(screen.getByLabelText('第 2 空')).toBeInTheDocument()
  })

  it('shows solutions and awarded points only for a completed session', async () => {
    const completed: ExerciseSession = JSON.parse(JSON.stringify(activeSession))
    completed.status = 'completed'; completed.score = 2; completed.max_score = 4
    completed.items[0].question.explanation_markdown = 'input 用于读取输入。'
    completed.items[0].question.options[1].correct = true
    completed.items[0].answer = { selected_option_ids: [32], bool_answer: null, code: '', status: 'correct', awarded_points: 2, details: { correct: true } }
    completed.items.push({
      ...completed.items[0], id: 72, sort_order: 1,
      question: { ...completed.items[0].question, id: 4, stem_markdown: '错误题', sort_order: 1 },
      answer: { selected_option_ids: [31], bool_answer: null, code: '', status: 'incorrect', awarded_points: 0, details: { correct: false } },
    })
    mockedApi.mockResolvedValue(completed)
    renderPage()
    const correctButton = await screen.findByRole('button', { name: '第 1 题：回答正确' })
    const incorrectButton = screen.getByRole('button', { name: '第 2 题：回答错误' })
    expect(correctButton).toHaveClass('result-correct')
    expect(incorrectButton).toHaveClass('result-incorrect', 'active')
    fireEvent.click(correctButton)
    expect(await screen.findByText('回答正确')).toBeInTheDocument()
    expect(screen.getByText('input 用于读取输入。')).toBeInTheDocument()
    expect(screen.getByText('2 / 2 分')).toBeInTheDocument()
    expect(correctButton).toHaveClass('active')
    expect(incorrectButton).not.toHaveClass('active')
  })

  it('separates multi-digit question numbers from final result icons', async () => {
    const completed: ExerciseSession = JSON.parse(JSON.stringify(activeSession))
    completed.status = 'completed'; completed.score = 12; completed.max_score = 24
    completed.items = Array.from({ length: 12 }, (_, index) => ({
      ...completed.items[0],
      id: 100 + index,
      sort_order: index,
      question: { ...completed.items[0].question, id: 200 + index, sort_order: index, stem_markdown: `第 ${index + 1} 题` },
      answer: { ...completed.items[0].answer, status: index % 2 ? 'incorrect' : 'correct', awarded_points: index % 2 ? 0 : 2 },
    }))
    mockedApi.mockResolvedValue(completed)
    renderPage()

    const twelfth = await screen.findByRole('button', { name: '第 12 题：回答错误' })
    expect(twelfth.querySelector('.question-nav-number')).toHaveTextContent('12')
    expect(twelfth.querySelector('.question-nav-result')).not.toBeNull()
    expect(twelfth.querySelector('.question-nav-number')?.contains(twelfth.querySelector('svg'))).toBe(false)
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

  it('falls back to the first question when every answer is saved but no position exists', async () => {
    const resumed: ExerciseSession = JSON.parse(JSON.stringify(activeSession))
    resumed.items = [
      { ...resumed.items[0], id: 71, question: { ...resumed.items[0].question, stem_markdown: '第一题' }, answer: { ...resumed.items[0].answer, selected_option_ids: [31], status: 'answered' } },
      { ...resumed.items[0], id: 72, sort_order: 1, question: { ...resumed.items[0].question, stem_markdown: '最后一题' }, answer: { ...resumed.items[0].answer, selected_option_ids: [32], status: 'answered' } },
    ]
    mockedApi.mockResolvedValue(resumed)
    renderPage()
    expect(await screen.findByText('第一题')).toBeInTheDocument()
    expect(screen.getByText(/全部题目均已作答，尚未提交/)).toBeInTheDocument()
  })

  it('restores the saved question and keeps the header and navigator in sync', async () => {
    const resumed: ExerciseSession = JSON.parse(JSON.stringify(activeSession))
    resumed.current_item_sort_order = 2
    resumed.items = [
      { ...resumed.items[0], id: 71, sort_order: 0, question: { ...resumed.items[0].question, stem_markdown: '第一题' } },
      { ...resumed.items[0], id: 72, sort_order: 1, question: { ...resumed.items[0].question, stem_markdown: '第二题' } },
      { ...resumed.items[0], id: 73, sort_order: 2, question: { ...resumed.items[0].question, stem_markdown: '保存的第三题' } },
    ]
    mockedApi.mockResolvedValue(resumed)
    renderPage()
    expect(await screen.findByText('保存的第三题')).toBeInTheDocument()
    expect(screen.getByText('/ 3')).toBeInTheDocument()
    expect(screen.getByText('3', { selector: '.exercise-score strong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '第 3 题' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: '第 3 题' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: '第 1 题' })).not.toHaveClass('active')
  })

  it('saves the target position before switching questions and stays put on failure', async () => {
    const resumed: ExerciseSession = JSON.parse(JSON.stringify(activeSession))
    resumed.items = [
      { ...resumed.items[0], id: 71, sort_order: 0, question: { ...resumed.items[0].question, stem_markdown: '当前位置' } },
      { ...resumed.items[0], id: 72, sort_order: 1, question: { ...resumed.items[0].question, stem_markdown: '目标位置' } },
    ]
    let fail = true
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/exercises/sessions/7') return resumed
      if (path === '/api/exercises/sessions/7/position') {
        if (fail) throw new Error('位置保存失败')
        return { session_item_id: 72, sort_order: 1 }
      }
      return { ok: true }
    })
    renderPage()
    await screen.findByText('当前位置')
    fireEvent.click(screen.getByRole('button', { name: '第 2 题' }))
    expect(await screen.findByText('位置保存失败')).toBeInTheDocument()
    expect(screen.getByText('当前位置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '第 1 题' })).toHaveClass('active')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '第 2 题' }))
    expect(await screen.findByText('目标位置')).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith('/api/exercises/sessions/7/position', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ session_item_id: 72 }),
    }))
    expect(screen.getByRole('button', { name: '第 2 题' })).toHaveClass('active')
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
    expect(screen.getByRole('button', { name: /运行样例/ })).toBeEnabled()
    const limits = screen.getByLabelText('运行限制')
    expect(limits.querySelectorAll('section')).toHaveLength(2)
    expect(limits).toHaveTextContent('时间限制1000ms')
    expect(limits).toHaveTextContent('内存限制128MB')
    expect(screen.getByText(/^3$/)).toBeInTheDocument()
    fireEvent.change(editor, { target: { value: 'for i in range(3):\n    print(i)' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/exercises/sessions/7/answers/72',
      expect.objectContaining({ body: JSON.stringify({ selected_option_ids: [], bool_answer: null, blank_answers: [], code: 'for i in range(3):\n    print(i)' }) }),
    ))
    fireEvent.change(editor, { target: { value: '' } })
    expect(editor).toHaveValue('')
  })

  it('shows each public sample vertically as input, output, then optional explanation', async () => {
    const programming = makeProgrammingSession()
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/sessions/7' ? programming : { ok: true })
    const view = renderPage()
    await screen.findByText('循环输出')
    const sections = [...view.container.querySelectorAll('.public-sample-sections > section')]
    expect(sections.map((section) => section.querySelector('h4')?.textContent)).toEqual(['标准输入', '期望输出', '样例解释'])
    expect(sections[2].querySelector('.katex')).not.toBeNull()
    view.unmount()

    programming.items[0].question.programming!.cases[0].explanation_markdown = ''
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/sessions/7' ? programming : { ok: true })
    const second = renderPage()
    await screen.findByText('循环输出')
    expect(second.container.querySelector('.public-sample-explanation')).toBeNull()
  })

  it('defaults to completion and automatic syntax enabled with formatting off and remembers all preferences', async () => {
    const programming = makeProgrammingSession()
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/sessions/7' ? programming : { valid: true, diagnostics: [] })
    renderPage()
    const autoCompletion = await screen.findByRole('button', { name: '智能补全' })
    expect(autoCompletion).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '自动语法检查' })).toHaveAttribute('aria-pressed', 'true')
    const autoFormat = screen.getByRole('button', { name: '自动格式化' })
    expect(autoFormat).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(autoFormat)
    await waitFor(() => expect(readPythonEditorPreferences()).toEqual({ autoCompletion: true, autoSyntax: true, autoFormat: true }))
    fireEvent.click(autoCompletion)
    await waitFor(() => expect(readPythonEditorPreferences()).toEqual({ autoCompletion: false, autoSyntax: true, autoFormat: true }))
    fireEvent.click(screen.getByRole('button', { name: '自动语法检查' }))
    await waitFor(() => expect(readPythonEditorPreferences()).toEqual({ autoCompletion: false, autoSyntax: false, autoFormat: true }))
  })

  it('keeps smart completion enabled when loading older editor preferences', () => {
    window.localStorage.setItem('kidtype-python-editor-preferences-v1', JSON.stringify({ autoSyntax: false, autoFormat: true }))
    expect(readPythonEditorPreferences()).toEqual({ autoCompletion: true, autoSyntax: false, autoFormat: true })
  })

  it('stops pending syntax checks when automatic syntax is disabled', async () => {
    const programming = makeProgrammingSession()
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/sessions/7' ? programming : { valid: true, diagnostics: [] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '自动语法检查' }))
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(mockedApi.mock.calls.filter(([path]) => path === '/api/exercises/sessions/7/syntax-check')).toHaveLength(0)
    expect(screen.queryByText(/自动检查语法|正在检查语法|未发现语法错误/)).not.toBeInTheDocument()
  })

  it('allows an immediate syntax check while automatic checking is disabled', async () => {
    const programming = makeProgrammingSession()
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/exercises/sessions/7') return programming
      if (path === '/api/exercises/sessions/7/syntax-check') return {
        valid: false,
        diagnostics: [{ severity: 'error', code: 'SyntaxError', message: '此处缺少冒号（:）', python_message: "expected ':'", line: 1, column: 8, end_line: 1, end_column: 9 }],
      }
      return { ok: true }
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '自动语法检查' }))
    const editor = screen.getByLabelText('Python 3.13 代码')
    fireEvent.change(editor, { target: { value: 'if True' } })
    fireEvent.click(screen.getByRole('button', { name: '立即检查语法' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/exercises/sessions/7/syntax-check',
      expect.objectContaining({ body: JSON.stringify({ session_item_id: 72, code: 'if True' }) }),
    ))
    expect(await screen.findByText(/第 1 行，第 8 列：此处缺少冒号/)).toBeInTheDocument()
    expect(editor).toHaveAttribute('data-diagnostic-count', '1')
  })

  it('formats code on demand and saves the formatted draft', async () => {
    const programming = makeProgrammingSession()
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/exercises/sessions/7') return programming
      if (path === '/api/exercises/sessions/7/format-code') return { valid: true, formatted_code: 'print("ok")\n', changed: true, diagnostics: [] }
      if (path === '/api/exercises/sessions/7/syntax-check') return { valid: true, diagnostics: [] }
      return { ok: true }
    })
    renderPage()
    const editor = await screen.findByLabelText('Python 3.13 代码')
    fireEvent.change(editor, { target: { value: 'print(  "ok" )' } })
    fireEvent.click(screen.getByRole('button', { name: '立即格式化代码' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/exercises/sessions/7/format-code',
      expect.objectContaining({ body: JSON.stringify({ session_item_id: 72, code: 'print(  "ok" )' }) }),
    ))
    await waitFor(() => expect(editor).toHaveValue('print("ok")\n'))
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/exercises/sessions/7/answers/72',
      expect.objectContaining({ body: JSON.stringify({ selected_option_ids: [], bool_answer: null, blank_answers: [], code: 'print("ok")\n' }) }),
    )
  })

  it('formats before running a public sample when automatic formatting is enabled', async () => {
    window.localStorage.setItem('kidtype-python-editor-preferences-v1', JSON.stringify({ autoSyntax: true, autoFormat: true }))
    const programming = makeProgrammingSession()
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/exercises/sessions/7') return programming
      if (path === '/api/exercises/sessions/7/format-code') return { valid: true, formatted_code: 'print(1)\n', changed: true, diagnostics: [] }
      if (path === '/api/exercises/sessions/7/sample-runs') return { job_id: 'formatted-sample' }
      if (path === '/api/exercises/sample-runs/formatted-sample') return { status: 'complete', cases: [] }
      if (path === '/api/exercises/sessions/7/syntax-check') return { valid: true, diagnostics: [] }
      return { ok: true }
    })
    renderPage()
    const editor = await screen.findByLabelText('Python 3.13 代码')
    fireEvent.change(editor, { target: { value: 'print( 1 )' } })
    fireEvent.click(screen.getByRole('button', { name: '运行样例' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/exercises/sessions/7/sample-runs', expect.objectContaining({
      body: JSON.stringify({ session_item_id: 72, code: 'print(1)\n' }),
    })), { timeout: 2500 })
    const paths = mockedApi.mock.calls.map(([path]) => path)
    expect(paths.indexOf('/api/exercises/sessions/7/format-code')).toBeLessThan(paths.indexOf('/api/exercises/sessions/7/sample-runs'))
  })

  it('formats and saves when focus leaves the editor if automatic formatting is enabled', async () => {
    window.localStorage.setItem('kidtype-python-editor-preferences-v1', JSON.stringify({ autoSyntax: true, autoFormat: true }))
    const programming = makeProgrammingSession()
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/exercises/sessions/7') return programming
      if (path === '/api/exercises/sessions/7/format-code') return { valid: true, formatted_code: 'value = 1\n', changed: true, diagnostics: [] }
      if (path === '/api/exercises/sessions/7/syntax-check') return { valid: true, diagnostics: [] }
      return { ok: true }
    })
    renderPage()
    const editor = await screen.findByLabelText('Python 3.13 代码')
    fireEvent.change(editor, { target: { value: 'value=1' } })
    fireEvent.blur(editor)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/exercises/sessions/7/answers/72', expect.objectContaining({
      body: JSON.stringify({ selected_option_ids: [], bool_answer: null, blank_answers: [], code: 'value = 1\n' }),
    })))
  })

  it('debounces Python syntax checks and shows the latest diagnostic', async () => {
    const programming = makeProgrammingSession()
    const checkedCodes: string[] = []
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/exercises/sessions/7') return programming
      if (path === '/api/exercises/sessions/7/syntax-check') {
        const code = JSON.parse(String(options?.body)).code
        checkedCodes.push(code)
        return {
          valid: false,
          diagnostics: [{ severity: 'error', code: 'SyntaxError', message: '此处缺少冒号（:）', python_message: "expected ':'", line: 1, column: 8, end_line: 1, end_column: 9 }],
        }
      }
      return { ok: true }
    })
    renderPage()
    const editor = await screen.findByLabelText('Python 3.13 代码')
    fireEvent.change(editor, { target: { value: 'if True:' } })
    fireEvent.change(editor, { target: { value: 'if True' } })
    expect(screen.getByText('正在检查语法…')).toBeInTheDocument()
    await waitFor(() => expect(checkedCodes).toEqual(['if True']), { timeout: 2000 })
    expect(await screen.findByText(/第 1 行，第 8 列：此处缺少冒号/)).toBeInTheDocument()
    expect(screen.getByText("Python：expected ':'")).toBeInTheDocument()
    expect(editor).toHaveAttribute('data-diagnostic-count', '1')
  })

  it('shows a valid syntax state and keeps syntax service failures local to the editor', async () => {
    const programming = makeProgrammingSession()
    programming.items[0].question.programming!.starter_code = 'print(1)'
    let failSyntax = false
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/exercises/sessions/7') return programming
      if (path === '/api/exercises/sessions/7/syntax-check') {
        if (failSyntax) throw new Error('syntax service offline')
        return { valid: true, diagnostics: [] }
      }
      return { ok: true }
    })
    renderPage()
    const editor = await screen.findByLabelText('Python 3.13 代码')
    expect(await screen.findByText('未发现语法错误', {}, { timeout: 2000 })).toBeInTheDocument()
    failSyntax = true
    fireEvent.change(editor, { target: { value: 'print(2)' } })
    expect(await screen.findByText(/语法检查暂时不可用/, {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.queryByText('syntax service offline')).not.toBeInTheDocument()
  })

  it('ignores an older syntax response after the code changes again', async () => {
    const programming = makeProgrammingSession()
    programming.items[0].question.programming!.starter_code = ''
    let resolveFirst: (value: unknown) => void = () => undefined
    let resolveSecond: (value: unknown) => void = () => undefined
    const first = new Promise((resolve) => { resolveFirst = resolve })
    const second = new Promise((resolve) => { resolveSecond = resolve })
    const checkedCodes: string[] = []
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/exercises/sessions/7') return programming
      if (path === '/api/exercises/sessions/7/syntax-check') {
        checkedCodes.push(JSON.parse(String(options?.body)).code)
        return await (checkedCodes.length === 1 ? first : second)
      }
      return { ok: true }
    })
    renderPage()
    const editor = await screen.findByLabelText('Python 3.13 代码')
    fireEvent.change(editor, { target: { value: 'if True' } })
    await waitFor(() => expect(checkedCodes).toEqual(['if True']), { timeout: 2000 })
    fireEvent.change(editor, { target: { value: 'print(1)' } })
    await waitFor(() => expect(checkedCodes).toEqual(['if True', 'print(1)']), { timeout: 2000 })
    await act(async () => resolveSecond({ valid: true, diagnostics: [] }))
    expect(await screen.findByText('未发现语法错误')).toBeInTheDocument()
    await act(async () => resolveFirst({
      valid: false,
      diagnostics: [{ severity: 'error', code: 'SyntaxError', message: '旧错误', python_message: 'old error', line: 1, column: 1, end_line: 1, end_column: 2 }],
    }))
    expect(screen.getByText('未发现语法错误')).toBeInTheDocument()
    expect(screen.queryByText(/旧错误/)).not.toBeInTheDocument()
  })

  it('renders completed programming answers read-only without requesting a syntax check', async () => {
    const programming = makeProgrammingSession()
    programming.status = 'completed'
    programming.score = 25
    programming.items[0].answer = { ...programming.items[0].answer, code: 'print(1)', status: 'correct', awarded_points: 25, details: { passed: 1, total: 1 } }
    mockedApi.mockResolvedValue(programming)
    renderPage()
    expect(await screen.findByLabelText('Python 3.13 代码')).toBeDisabled()
    expect(mockedApi.mock.calls.filter(([path]) => path === '/api/exercises/sessions/7/syntax-check')).toHaveLength(0)
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
      expect.objectContaining({ body: JSON.stringify({ selected_option_ids: [], bool_answer: null, blank_answers: [], code: 'print("saved")' }) }),
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
    const runButton = screen.getByRole('button', { name: /运行样例/ })
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

  it('renders inline and block TeX math with accessible MathML', () => {
    const view = render(<MarkdownText value={'身高为 $H_1$，且 $100 \\le H_i \\le 199$，也可写成 \\(x^2\\)。\n\n$$\\frac{x^2}{2}$$\n\n\\[\\sqrt{x}\\]'} />)
    expect(view.container.querySelectorAll('.katex')).toHaveLength(5)
    expect(view.container.querySelectorAll('.katex-mathml math')).toHaveLength(5)
    expect(view.container.querySelectorAll('.math-display .katex-display')).toHaveLength(2)
    expect(view.container.textContent).not.toContain('$H_1$')
  })

  it('keeps code, escaped dollars, unmatched delimiters, and invalid math safe', () => {
    const view = render(<MarkdownText value={'`$H_1$`，价格为 \\$100，未闭合 $H_2，错误公式 $\\notacommand{x}$，危险公式 $\\href{javascript:alert(1)}{x}$'} />)
    expect(screen.getByText('$H_1$').tagName).toBe('CODE')
    expect(view.container).toHaveTextContent('价格为 $100')
    expect(view.container).toHaveTextContent('未闭合 $H_2')
    expect(view.container.querySelectorAll('.math-formula-error')).toHaveLength(1)
    expect(view.container.querySelector('a')).toBeNull()
    expect(view.container.querySelector('script')).toBeNull()
  })
})
