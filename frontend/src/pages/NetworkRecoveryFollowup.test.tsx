import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createBrowserRouter, createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom'
import { api, ApiError } from '../api'
import App from '../App'
import { Shell } from '../components/Shell'
import { UnsavedChangesProvider } from '../components/UnsavedChanges'
import { ExercisePage } from './ExercisePage'
import { AdminReportsPanel } from './AdminReportsPanel'
import type { ExerciseSession } from '../types'

vi.mock('../api', async (original) => ({ ...await original<typeof import('../api')>(), api: vi.fn() }))
vi.mock('../components/PythonCodeEditor', () => ({ PythonCodeEditor: (p: { value: string; disabled: boolean; onRun?: () => void; runDisabled?: boolean; runLabel?: string }) => <div><textarea value={p.value} disabled={p.disabled} readOnly />{p.onRun && <button disabled={p.runDisabled} onClick={p.onRun}>{p.runLabel}</button>}</div> }))
const mockedApi = vi.mocked(api)
const child = { id: 1, actor_id: 1, name: '小宇', role: 'child' as const, active: true }
const session: ExerciseSession = {
  id: 7, title: '网络恢复', mode: 'set', status: 'in_progress', score: null, max_score: 2,
  items: [{ id: 71, sort_order: 0, points: 2,
    question: { id: 3, type: 'single_choice', stem_markdown: '请选择', points: 2, sort_order: 0, options: [{ id: 31, label: 'A', content_markdown: '甲', sort_order: 0 }, { id: 32, label: 'B', content_markdown: '乙', sort_order: 1 }] },
    answer: { selected_option_ids: [31], bool_answer: null, code: '', status: 'answered' },
  }],
}
function exercise() {
  return render(<MemoryRouter initialEntries={['/exercise/7']}><Routes><Route path="/" element={<p>已离开练习</p>} /><Route path="/exercise/:sessionId" element={<ExercisePage />} /></Routes></MemoryRouter>)
}
beforeEach(() => { mockedApi.mockReset(); window.localStorage.clear(); vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })

it('closes a successful reset before refreshing and retries only report reads', async () => {
  let resets = 0
  let failRefresh = false
  mockedApi.mockImplementation(async (path) => {
    if (path.endsWith('/reset-learning-data')) { resets++; failRefresh = true; return { child_id: 1 } }
    if (failRefresh) throw new Error('刷新连接中断')
    if (path.includes('/overview')) return { students: [{ child_id: 1, child_name: '小宇', active: true, course_attempt_count: 2, word_attempt_count: 0, practice_minutes: 1, average_cpm: 40, accuracy: 90, exercise_total: 0, exercise_completed: 0, unresolved_wrong_count: 0 }] }
    if (path.includes('/summary')) return { attempt_count: 2, practice_minutes: 1, accuracy: 90, weak_keys: [], attempts: [] }
    return new Promise(() => {})
  })
  await act(async () => render(<AdminReportsPanel children={[child]} />))
  await act(async () => fireEvent.click(screen.getByRole('tab', { name: '学生分析' })))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /小宇/ })))
  fireEvent.click(screen.getByRole('button', { name: '重置学习数据' }))
  fireEvent.change(screen.getByLabelText(/请输入学生姓名/), { target: { value: '小宇' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '确认永久重置' })))
  expect(resets).toBe(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText(/操作已完成，但列表刷新失败/)).toBeInTheDocument()
  failRefresh = false
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试刷新' })))
  expect(resets).toBe(1)
  expect(screen.queryByText(/操作已完成，但列表刷新失败/)).not.toBeInTheDocument()
})

it.each([false, true])('locks answers and recovers via GET when submit response lost=%s', async (loseResponse) => {
  let submitted = false
  let failRefresh = true
  let submitCalls = 0
  mockedApi.mockImplementation(async (path) => {
    if (path.endsWith('/submit')) {
      submitted = true; submitCalls++
      if (loseResponse) throw new ApiError('网络中断', 0)
      return { status: 'completed' }
    }
    if (submitted && failRefresh) throw new Error('刷新连接中断')
    return { ...structuredClone(session), status: submitted ? 'completed' : 'in_progress' }
  })
  await act(async () => exercise())
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '提交整套练习' })))
  expect(screen.getByRole('radio', { name: /乙/ })).toBeDisabled()
  expect(screen.queryByRole('button', { name: '提交整套练习' })).not.toBeInTheDocument()
  failRefresh = false
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新确认提交结果' })))
  expect(screen.getByText('练习结果')).toBeInTheDocument()
  expect(submitCalls).toBe(1)
  expect(mockedApi.mock.calls.filter(([path]) => path.includes('/answers/'))).toHaveLength(0)
})

it('unlocks an unsubmitted session after checking its status without replaying the write', async () => {
  mockedApi.mockImplementation(async (path) => {
    if (path.endsWith('/submit')) throw new ApiError('网络中断', 0)
    return structuredClone(session)
  })
  await act(async () => exercise())
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '提交整套练习' })))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新确认提交结果' })))
  expect(screen.getByRole('radio', { name: /乙/ })).toBeEnabled()
  expect(screen.getByRole('button', { name: '提交整套练习' })).toBeEnabled()
  expect(mockedApi.mock.calls.filter(([path]) => path.endsWith('/submit'))).toHaveLength(1)
})

it.each(['header', 'back', 'logout'])('protects unsaved answers through %s', async (entry) => {
  mockedApi.mockImplementation(async (path) => {
    if (path.includes('/answers/')) throw new Error('网络连接中断')
    return structuredClone(session)
  })
  const router = createMemoryRouter([{ path: '*', element: <UnsavedChangesProvider><Routes><Route path="/" element={<p>已离开练习</p>} /><Route path="/exercise/:sessionId" element={<Shell me={child}><ExercisePage /></Shell>} /></Routes></UnsavedChangesProvider> }], { initialEntries: ['/', '/exercise/7'] })
  await act(async () => render(<RouterProvider router={router} />))
  await act(async () => fireEvent.click(screen.getByRole('radio', { name: /乙/ })))
  vi.mocked(window.confirm).mockReturnValue(false)
  await act(async () => {
    if (entry === 'header') fireEvent.click(screen.getByRole('link', { name: /码力全开/ }))
    else if (entry === 'back') await router.navigate(-1)
    else fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
  })
  expect(window.confirm).toHaveBeenCalledOnce()
  expect(screen.getByRole('radio', { name: /乙/ })).toBeChecked()
  expect(mockedApi.mock.calls.filter(([path]) => path.endsWith('/logout'))).toHaveLength(0)
  if (entry !== 'logout') {
    vi.mocked(window.confirm).mockReturnValue(true)
    await act(async () => fireEvent.click(screen.getByRole('link', { name: /码力全开/ })))
    expect(screen.getByText('已离开练习')).toBeInTheDocument()
  }
  router.dispose()
})

it.each(['deadline', 'disconnect'])('resumes the original sample job after %s', async (failure) => {
  const programming = structuredClone(session)
  programming.items[0].question = { id: 3, type: 'programming', points: 2, sort_order: 0, stem_markdown: '输出', options: [], programming: { starter_code: 'print(1)', input_markdown: '', output_markdown: '', constraints_markdown: '', time_limit_ms: 1000, memory_limit_mb: 128, cases: [{ id: 1, is_sample: true, input_data: '', expected_output: '1', weight: 0 }] } }
  programming.items[0].answer.code = 'print(1)'
  let finished = false
  mockedApi.mockImplementation(async (path) => {
    if (path.endsWith('/sample-runs')) return { job_id: 'sample-job' }
    if (path.includes('/sample-runs/')) {
      if (finished) return { status: 'completed', cases: [{ status: 'AC', duration_ms: 1 }] }
      if (failure === 'disconnect') throw new Error('连接中断')
      return { status: 'queued' }
    }
    if (path.endsWith('/syntax-check')) return { valid: true, diagnostics: [] }
    if (path.includes('/answers/')) return { ok: true }
    return programming
  })
  await act(async () => exercise())
  await screen.findByRole('button', { name: '运行样例' })
  vi.useFakeTimers()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '运行样例' })))
  await act(async () => vi.advanceTimersByTimeAsync(700 * 61))
  expect(screen.getByRole('button', { name: '继续查询样例结果' })).toBeEnabled()
  finished = true
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '继续查询样例结果' })))
  await act(async () => vi.advanceTimersByTimeAsync(700))
  expect(screen.getByText(/样例 1 · AC/)).toBeInTheDocument()
  expect(mockedApi.mock.calls.filter(([path]) => path.endsWith('/sample-runs'))).toHaveLength(1)
  expect(screen.getByRole('button', { name: '运行样例' })).toBeEnabled()
})

it('keeps the original URL after an auth network failure and reconnects without login', async () => {
  mockedApi.mockRejectedValue(new ApiError('网络连接中断', 0))
  window.history.replaceState(null, '', '/exercise/7')
  const router = createBrowserRouter([{ path: '*', element: <App /> }])
  await act(async () => render(<RouterProvider router={router} />))
  expect(window.location.pathname).toBe('/exercise/7')
  expect(screen.getByRole('alert')).toHaveTextContent('网络连接中断')
  mockedApi.mockImplementation(async (path) => path === '/api/auth/me' ? child : structuredClone(session))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试连接' })))
  expect(screen.getByText('请选择')).toBeInTheDocument()
  expect(window.location.pathname).toBe('/exercise/7')
  router.dispose()
})

it('still redirects confirmed unauthenticated users to login', async () => {
  mockedApi.mockRejectedValue(new ApiError('请登录', 401))
  window.history.replaceState(null, '', '/exercise/7')
  const router = createBrowserRouter([{ path: '*', element: <App /> }])
  await act(async () => render(<RouterProvider router={router} />))
  expect(window.location.pathname).toBe('/login')
  router.dispose()
})
