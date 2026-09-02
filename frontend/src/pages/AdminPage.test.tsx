import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api, downloadApi, saveDownload } from '../api'
import type { Course, Report } from '../types'
import { AdminPage, reorderCourseList, saveCourseOrder } from './AdminPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn(), downloadApi: vi.fn(), saveDownload: vi.fn() }
})

const mockedApi = vi.mocked(api)
const mockedDownloadApi = vi.mocked(downloadApi)
const mockedSaveDownload = vi.mocked(saveDownload)
const courses: Course[] = [
  {
    id: 1,
    title: '入门课程',
    description: '基础练习',
    active: true,
    lessons: [{ id: 11, title: '字母关卡', description: '', active: true, prompts: [{ id: 111, content: 'asdf', active: true }] }],
  },
  {
    id: 2,
    title: '代码课程',
    description: '符号练习',
    active: true,
    lessons: [{ id: 21, title: '符号关卡', description: '', active: true, prompts: [{ id: 211, content: '{}', active: true }] }],
  },
]
const report: Report = {
  attempt_count: 0,
  practice_minutes: 0,
  average_cpm: null,
  cpm_metric_version: null,
  cpm_attempt_count: 0,
  accuracy: 0,
  weak_keys: [],
  attempts: [],
}

describe('AdminPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedDownloadApi.mockReset()
    mockedSaveDownload.mockReset()
    mockedDownloadApi.mockResolvedValue({ blob: new Blob(['zip']), filename: 'sets.zip' })
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/children') return [{ id: 1, name: '小宇', active: true }]
      if (path === '/api/admin/library') return courses
      if (path.startsWith('/api/admin/reports/overview')) return { days: 30, students: [{ child_id: 1, child_name: '小宇', active: true, course_attempt_count: 2, word_attempt_count: 1, practice_minutes: 8, average_cpm: 88, cpm_metric_version: 1, cpm_attempt_count: 3, accuracy: 96, exercise_total: 3, exercise_completed: 2, exercise_completion_rate: 66.7, exercise_average_percent: 85, unresolved_wrong_count: 1 }] }
      if (path.startsWith('/api/admin/reports/summary')) return report
      if (path.startsWith('/api/admin/exercise-reports/summary')) return { session_count: 2, total_session_count: 3, status_counts: { in_progress: 0, judging: 0, completed: 2, abandoned: 1 }, completion_rate: 66.7, average_percent: 85, unresolved_wrong_count: 1, recent: [{ id: 9, child_id: 1, mode: 'set', status: 'abandoned', title: '未完成题套', score: 0, max_score: 10, created_at: '2026-07-22T08:00:00', completed_at: null }] }
      return {}
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('builds a complete, continuous course order', () => {
    const reordered = reorderCourseList(courses, 1, 2)
    expect(reordered.map((course) => course.id)).toEqual([2, 1])
    expect(reordered.map((course) => course.sort_order)).toEqual([0, 1])
    expect(reorderCourseList(reordered, 999, 1)).toBe(reordered)
  })

  it('submits the complete course id list when saving an order', async () => {
    const reordered = reorderCourseList(courses, 1, 2)
    await saveCourseOrder(reordered)
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/admin/courses/order',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ course_ids: [2, 1] }) }),
    )
  })

  it('uses student wording throughout the administrator interface', async () => {
    render(<AdminPage />)

    expect(await screen.findByRole('button', { name: '学生档案' })).toBeInTheDocument()
    expect(screen.getByText('每个学生都有独立的 PIN 和学习记录。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加学生' })).toBeInTheDocument()
    expect(screen.queryByText(/孩子/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '学习报告' }))
    const student = await screen.findByRole('button', { name: /小宇/ })
    expect(screen.getByText('2 / 1')).toBeInTheDocument()
    expect(student).toHaveTextContent('历史口径 · 3 次 · 96%')
    fireEvent.click(student)
    expect(await screen.findByLabelText('学生')).toHaveValue('1')
    expect(screen.getByRole('tab', { name: '打字练习' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '单词练习' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '习题练习' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '习题练习' }))
    expect(await screen.findAllByText('已放弃')).not.toHaveLength(0)
    expect(screen.getByText('未完成题套')).toBeInTheDocument()
    expect(screen.queryByText(/孩子/)).not.toBeInTheDocument()
  })

  it('edits a student PIN in an accessible modal and reports success without shifting content', async () => {
    let finishPatch!: (value: unknown) => void
    const pendingPatch = new Promise((resolve) => { finishPatch = resolve })
    const baseApi = mockedApi.getMockImplementation()!
    mockedApi.mockImplementation(async (...args) => {
      if (args[0] === '/api/admin/children/1' && args[1]?.method === 'PATCH') return pendingPatch
      return baseApi(...args)
    })
    render(<AdminPage />)
    const trigger = await screen.findByRole('button', { name: '修改 PIN' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '修改 小宇 的 PIN' })
    const input = within(dialog).getByLabelText('新 PIN')
    expect(input).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: '保存新 PIN' })).toBeDisabled()
    fireEvent.change(input, { target: { value: '12a34' } })
    expect(input).toHaveValue('1234')
    fireEvent.click(within(dialog).getByRole('button', { name: '显示 PIN' }))
    expect(input).toHaveAttribute('type', 'text')
    fireEvent.click(within(dialog).getByRole('button', { name: '保存新 PIN' }))
    expect(within(dialog).getByRole('button', { name: '正在保存…' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '关闭 PIN 修改窗口' })).toBeDisabled()
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/children/1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ pin: '1234' }) }))
    finishPatch({ id: 1, name: '小宇', active: true })
    expect(await screen.findByRole('status')).toHaveTextContent('PIN 已修改')
    expect(screen.queryByRole('dialog', { name: '修改 小宇 的 PIN' })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByText('PIN 已修改')?.closest('.admin-content')).toBeNull()
  })

  it('keeps the PIN modal and entered value available after a failed request', async () => {
    const baseApi = mockedApi.getMockImplementation()!
    mockedApi.mockImplementation(async (...args) => {
      if (args[0] === '/api/admin/children/1' && args[1]?.method === 'PATCH') throw new Error('无法连接服务器，请检查网络或稍后重试')
      return baseApi(...args)
    })
    render(<AdminPage />)
    const trigger = await screen.findByRole('button', { name: '修改 PIN' })
    fireEvent.click(trigger)
    const input = screen.getByLabelText('新 PIN')
    fireEvent.change(input, { target: { value: '5678' } })
    fireEvent.click(screen.getByRole('button', { name: '保存新 PIN' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('无法连接服务器，请检查网络或稍后重试')
    expect(screen.getByRole('dialog', { name: '修改 小宇 的 PIN' })).toBeInTheDocument()
    expect(input).toHaveValue('5678')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '修改 小宇 的 PIN' })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('requires an exact name before permanently resetting one students learning data', async () => {
    let finishReset!: (value: unknown) => void
    const pendingReset = new Promise((resolve) => { finishReset = resolve })
    const baseApi = mockedApi.getMockImplementation()!
    mockedApi.mockImplementation(async (...args) => {
      if (args[0] === '/api/admin/children/1/reset-learning-data') return pendingReset
      return baseApi(...args)
    })

    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '学习报告' }))
    expect(screen.queryByRole('button', { name: '重置学习数据' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /小宇/ }))
    const trigger = await screen.findByRole('button', { name: '重置学习数据' })

    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '重置学习数据' })).toBeInTheDocument()
    expect(screen.getByText('警告：即将永久清空「小宇」的全部学习数据，此操作不可恢复。')).toBeInTheDocument()
    expect(screen.getByText('终止进行中和判题中的习题练习')).toBeInTheDocument()
    expect(screen.getByText('学生账号、PIN 和公共题库不会受到影响')).toBeInTheDocument()
    const nameInput = screen.getByLabelText(/请输入学生姓名/)
    const confirm = screen.getByRole('button', { name: '确认永久重置' })
    expect(nameInput).toHaveFocus()
    expect(confirm).toBeDisabled()
    fireEvent.change(nameInput, { target: { value: '小雨' } })
    expect(confirm).toBeDisabled()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '重置学习数据' })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('tab', { name: '习题练习' }))
    fireEvent.change(screen.getByLabelText('时间范围'), { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText(/请输入学生姓名/), { target: { value: '小宇' } })
    fireEvent.click(screen.getByRole('button', { name: '确认永久重置' }))
    expect(screen.getByRole('button', { name: '正在重置…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '关闭重置学习数据警告' })).toBeDisabled()
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/admin/children/1/reset-learning-data',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm_name: '小宇' }) }),
    )

    finishReset({ child_id: 1, deleted: { practice_attempts: 2, exercise_sessions: 3, wrong_questions: 1 } })
    expect(await screen.findByText('小宇 的学习数据已重置')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '重置学习数据' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '习题练习' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('时间范围')).toHaveValue('90')
    expect(screen.getByLabelText('学生')).toHaveValue('1')
  })

  it('keeps the reset warning and confirmation input when the request fails', async () => {
    const baseApi = mockedApi.getMockImplementation()!
    mockedApi.mockImplementation(async (...args) => {
      if (args[0] === '/api/admin/children/1/reset-learning-data') throw new Error('数据库暂时不可用')
      return baseApi(...args)
    })

    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '学习报告' }))
    fireEvent.click(await screen.findByRole('button', { name: /小宇/ }))
    fireEvent.click(await screen.findByRole('button', { name: '重置学习数据' }))
    const nameInput = screen.getByLabelText(/请输入学生姓名/)
    fireEvent.change(nameInput, { target: { value: '小宇' } })
    fireEvent.click(screen.getByRole('button', { name: '确认永久重置' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('数据库暂时不可用')
    expect(screen.getByRole('dialog', { name: '重置学习数据' })).toBeInTheDocument()
    expect(nameInput).toHaveValue('小宇')
  })

  it('uses the renamed library wording and keeps imports out of the word library', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/children') return []
      if (path === '/api/admin/library') return courses
      if (path.startsWith('/api/admin/reports/summary')) return report
      if (path === '/api/admin/word-sets') return []
      if (path === '/api/admin/llm/status') return { configured: false, base_url: 'https://api.openai.com/v1', model: '' }
      return {}
    })
    render(<AdminPage />)
    expect(await screen.findByRole('button', { name: '打字词库' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '单词词库' }))
    expect(await screen.findByText('LLM 未配置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建单词集' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /导出/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /预览.*词库/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '课程词库' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '单词库' })).not.toBeInTheDocument()
  })

  it('collapses courses and lessons independently while preserving nested state', async () => {
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '打字词库' }))

    const firstCourse = await screen.findByRole('button', { name: '展开课程 入门课程' })
    const secondCourse = screen.getByRole('button', { name: '展开课程 代码课程' })
    expect(firstCourse).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '展开关卡 字母关卡' })).not.toBeInTheDocument()

    fireEvent.click(firstCourse)
    const firstLesson = screen.getByRole('button', { name: '展开关卡 字母关卡' })
    expect(firstLesson).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: '编辑关卡 字母关卡' })).toHaveClass('compact-icon-button')
    expect(screen.getByRole('button', { name: '删除关卡 字母关卡' })).toHaveClass('danger-button', 'compact-icon-button')
    expect(screen.queryByText('asdf')).not.toBeInTheDocument()

    fireEvent.click(firstLesson)
    expect(screen.getByText('asdf')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑练习内容' })).toHaveClass('compact-icon-button')
    expect(screen.getByRole('button', { name: '删除练习内容' })).toHaveClass('danger-button', 'compact-icon-button')

    fireEvent.click(secondCourse)
    expect(screen.getByRole('button', { name: '展开关卡 符号关卡' })).toBeInTheDocument()
    expect(screen.getByText('asdf')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '收起课程 入门课程' }))
    expect(screen.queryByText('asdf')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开课程 入门课程' }))
    expect(screen.getByRole('button', { name: '收起关卡 字母关卡' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('asdf')).toBeInTheDocument()
  })

  it('keeps a course open when its management actions are used', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '打字词库' }))
    fireEvent.click(await screen.findByRole('button', { name: '展开课程 入门课程' }))

    expect(screen.getByRole('button', { name: '向课程 入门课程 添加关卡' })).toHaveClass('ghost')
    expect(screen.queryByRole('button', { name: '编辑课程' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '更多操作 课程 入门课程' }))
    const menu = screen.getByRole('menu', { name: '课程 入门课程操作菜单' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: '编辑课程' }))
    expect(prompt).toHaveBeenCalledWith('课程名称', '入门课程')
    expect(screen.getByRole('button', { name: '收起课程 入门课程' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '展开关卡 字母关卡' })).toBeInTheDocument()
  })

  it('supports keyboard navigation and focus restoration in course action menus', async () => {
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '打字词库' }))
    const trigger = await screen.findByRole('button', { name: '更多操作 课程 入门课程' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const edit = screen.getByRole('menuitem', { name: '编辑课程' })
    const remove = screen.getByRole('menuitem', { name: '删除课程' })
    expect(edit).toHaveFocus()
    expect(remove).toHaveClass('danger')
    fireEvent.keyDown(edit, { key: 'ArrowDown' })
    expect(remove).toHaveFocus()
    fireEvent.keyDown(remove, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: '课程 入门课程操作菜单' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())

    fireEvent.click(trigger)
    expect(screen.getByRole('menu', { name: '课程 入门课程操作菜单' })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu', { name: '课程 入门课程操作菜单' })).not.toBeInTheDocument()
  })

  it('exposes dedicated keyboard-accessible drag handles', async () => {
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '打字词库' }))

    const handle = await screen.findByRole('button', { name: '拖动课程 入门课程 调整顺序' })
    expect(handle).toHaveAttribute('title', expect.stringContaining('方向键移动'))
    expect(screen.getByRole('button', { name: '拖动课程 代码课程 调整顺序' })).toBeEnabled()
    expect(screen.getByText(/聚焦拖动手柄后，按空格键或回车键拿起课程/)).toBeInTheDocument()
  })

  it('centralizes both library import and export tools', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/children') return []
      if (path === '/api/admin/library') return courses
      if (path.startsWith('/api/admin/reports/summary')) return report
      if (path === '/api/admin/word-sets') return [{ id: 7, title: '编程词汇', description: '', word_count: 0 }]
      return {}
    })
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导入导出' }))

    const typingTab = screen.getByRole('tab', { name: '打字词库' })
    const wordTab = screen.getByRole('tab', { name: '单词词库' })
    const questionTab = screen.getByRole('tab', { name: '习题题库' })
    expect(typingTab).toHaveAttribute('aria-selected', 'true')
    expect(wordTab).toHaveAttribute('aria-selected', 'false')
    expect(questionTab).toHaveAttribute('aria-selected', 'false')
    expect(await screen.findByRole('heading', { name: '导入课程与练习' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '导出打字词库' })).toHaveAttribute('href', '/api/admin/export')
    expect(screen.getByLabelText('打字词库文件内容')).toBeInTheDocument()
    expect(screen.getByLabelText('选择打字词库文件').closest('.file-picker')).toHaveClass('compact-file-picker')
    expect(screen.queryByRole('heading', { name: '导入单词与释义' })).not.toBeInTheDocument()

    fireEvent.keyDown(typingTab, { key: 'ArrowRight' })
    await waitFor(() => expect(wordTab).toHaveAttribute('aria-selected', 'true'))
    expect(wordTab).toHaveFocus()
    expect(screen.queryByRole('heading', { name: '导入课程与练习' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '导入单词与释义' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '导出单词词库' })).toHaveAttribute('href', '/api/admin/word-export')
    expect(await screen.findByLabelText('单词词库文件内容')).toBeInTheDocument()
    expect(screen.getByLabelText('选择单词词库文件').closest('.file-picker')).toHaveClass('compact-file-picker')

    fireEvent.keyDown(wordTab, { key: 'End' })
    await waitFor(() => expect(questionTab).toHaveAttribute('aria-selected', 'true'))
    expect(questionTab).toHaveFocus()
    expect(screen.getByRole('heading', { name: '导入结构化习题' })).toBeInTheDocument()
    expect(screen.getByLabelText('习题题库文件内容')).toBeInTheDocument()
    expect(screen.getByLabelText('选择习题题库文件').closest('.file-picker')).toHaveClass('compact-file-picker')
    expect(screen.getByLabelText('选择题套迁移包').closest('.file-picker')).toHaveClass('compact-file-picker')
  })

  it('previews and imports typing and word data through their existing APIs', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/children') return []
      if (path === '/api/admin/library') return courses
      if (path.startsWith('/api/admin/reports/summary')) return report
      if (path === '/api/admin/word-sets') return [{ id: 7, title: '编程词汇', description: '', word_count: 0 }]
      if (path === '/api/admin/import/preview') return { valid: true, course_count: 0, lesson_count: 0, prompt_count: 1, errors: [] }
      if (path === '/api/admin/word-import/preview') return { valid: true, word_count: 1, created_count: 1, updated_count: 0, queued_count: 1, errors: [] }
      return {}
    })
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导入导出' }))
    fireEvent.change(screen.getByLabelText('打字词库文件内容'), { target: { value: 'asdf' } })

    fireEvent.click(screen.getByRole('button', { name: '预览打字词库' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/admin/import/preview',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ format: 'txt', content: 'asdf', mode: 'append', target_lesson_id: 11 }) }),
    ))
    await waitFor(() => expect(screen.getByRole('button', { name: '导入打字词库' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '导入打字词库' }))

    fireEvent.click(screen.getByRole('tab', { name: '单词词库' }))
    fireEvent.change(await screen.findByLabelText('单词词库文件内容'), { target: { value: 'array' } })
    fireEvent.click(screen.getByRole('button', { name: '预览单词词库' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/admin/word-import/preview',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ word_set_id: 7, format: 'txt', mode: 'append', content: 'array' }) }),
    ))
    await waitFor(() => expect(screen.getByRole('button', { name: '导入单词词库' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '导入单词词库' }))

    await waitFor(() => {
      expect(mockedApi).toHaveBeenCalledWith('/api/admin/import', expect.objectContaining({ method: 'POST' }))
      expect(mockedApi).toHaveBeenCalledWith('/api/admin/word-import', expect.objectContaining({ method: 'POST' }))
    })
    fireEvent.click(screen.getByRole('tab', { name: '打字词库' }))
    expect(screen.getByLabelText('打字词库文件内容')).toHaveValue('asdf')
    expect(screen.getByText('0 个课程 · 0 个关卡 · 1 条练习')).toBeInTheDocument()
  })

  it('keeps replacement imports behind their existing confirmations', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/children') return []
      if (path === '/api/admin/library') return courses
      if (path.startsWith('/api/admin/reports/summary')) return report
      if (path === '/api/admin/word-sets') return [{ id: 7, title: '编程词汇', description: '', word_count: 0 }]
      if (path === '/api/admin/import/preview') return { valid: true, course_count: 0, lesson_count: 0, prompt_count: 1, errors: [] }
      if (path === '/api/admin/word-import/preview') return { valid: true, word_count: 1, created_count: 1, updated_count: 0, queued_count: 1, errors: [] }
      return {}
    })
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导入导出' }))
    fireEvent.change(screen.getByLabelText('模式'), { target: { value: 'replace' } })
    fireEvent.change(screen.getByLabelText('打字词库文件内容'), { target: { value: 'asdf' } })

    fireEvent.click(screen.getByRole('button', { name: '预览打字词库' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '导入打字词库' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '导入打字词库' }))

    fireEvent.click(screen.getByRole('tab', { name: '单词词库' }))
    await screen.findByLabelText('单词词库文件内容')
    fireEvent.change(screen.getByLabelText('模式'), { target: { value: 'replace' } })
    fireEvent.change(screen.getByLabelText('单词词库文件内容'), { target: { value: 'array' } })
    fireEvent.click(screen.getByRole('button', { name: '预览单词词库' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '导入单词词库' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '导入单词词库' }))

    expect(confirm).toHaveBeenCalledWith('替换模式会删除目标范围内现有词库，确认继续？')
    expect(confirm).toHaveBeenCalledWith('替换模式会删除该单词集的现有词条，确认继续？')
    expect(mockedApi.mock.calls.some(([path]) => path === '/api/admin/import')).toBe(false)
    expect(mockedApi.mock.calls.some(([path]) => path === '/api/admin/word-import')).toBe(false)
  })

  it('previews and imports structured exercises into a new draft set', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/children') return []
      if (path === '/api/admin/library') return courses
      if (path === '/api/admin/word-sets') return []
      if (path === '/api/admin/question-sets') return [{ id: 9, title: '草稿题套', description: '', status: 'draft', question_count: 0, counts: {}, total_points: 0 }]
      if (path === '/api/admin/exercise-import/preview') return { valid: true, question_set_count: 1, question_count: 1, counts: { single_choice: 1, multiple_choice: 0, true_false: 0, programming: 0 }, errors: [], warnings: [] }
      if (path === '/api/admin/exercise-import') return { valid: true, question_set_ids: [10] }
      return {}
    })
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导入导出' }))
    fireEvent.click(screen.getByRole('tab', { name: '习题题库' }))
    fireEvent.change(screen.getByLabelText('习题题库文件内容'), { target: { value: '题套：基础题\n类型：判断\n题目：Python 区分大小写。\n答案：正确' } })
    fireEvent.click(screen.getByRole('button', { name: '预览习题题库' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/admin/exercise-import/preview',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"mode":"create"') }),
    ))
    expect(await screen.findByText(/1 个题套 · 1 道题/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入习题题库' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/admin/exercise-import', expect.objectContaining({ method: 'POST' })))
  })

  it('exports selected sets and previews per-set bundle import decisions', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const questionSets = [
      { id: 9, title: '迁移题套甲', description: '', status: 'draft', source_pdf_asset_id: 3, question_count: 2, counts: { true_false: 2 }, total_points: 4 },
      { id: 10, title: '迁移题套乙', description: '', status: 'published', source_pdf_asset_id: null, question_count: 1, counts: { fill_blank: 1 }, total_points: 2 },
    ]
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/children') return []
      if (path === '/api/admin/library') return courses
      if (path === '/api/admin/word-sets') return []
      if (path === '/api/admin/question-sets') return questionSets
      if (path === '/api/admin/question-set-bundles/preview') return {
        valid: true, version: 1, bundle_id: 'b'.repeat(32), question_set_count: 1, question_count: 2, asset_count: 2, errors: [],
        question_sets: [{
          migration_key: 'a'.repeat(32), title: '迁移题套甲', source_status: 'draft', fingerprint: 'f'.repeat(64),
          question_count: 2, counts: { single_choice: 0, multiple_choice: 0, true_false: 2, fill_blank: 0, programming: 0 },
          asset_count: 2, programming_case_count: 0, has_source_pdf: true, conflict: 'same_origin_changed', default_action: 'copy',
          allowed_actions: ['skip', 'copy', 'overwrite'], target: { id: 9, title: '迁移题套甲', status: 'draft', fingerprint: 'e'.repeat(64) }, warnings: [],
        }],
      }
      if (path === '/api/admin/question-set-bundles/import') return { ok: true, created: [], copied: [], overwritten: [{ id: 9, title: '迁移题套甲' }], skipped: [] }
      return {}
    })
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导入导出' }))
    fireEvent.click(screen.getByRole('tab', { name: '习题题库' }))
    await screen.findByText('迁移题套甲')

    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect(screen.getByRole('status')).toHaveTextContent('将生成 1 个 ZIP，内含已选择的 2 套题')
    fireEvent.click(screen.getByRole('button', { name: '导出所选（2 套）' }))
    await waitFor(() => expect(mockedDownloadApi).toHaveBeenCalledWith('/api/admin/question-set-bundles/export', expect.objectContaining({ body: JSON.stringify({ question_set_ids: [9, 10] }) })))
    expect(mockedSaveDownload).toHaveBeenCalled()
    expect(screen.getByText('题套迁移包已导出：2 套题合并为 1 个 ZIP')).toBeInTheDocument()

    const file = new File(['bundle'], 'sets.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByLabelText('选择题套迁移包'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '校验并预览' }))
    expect(await screen.findByText(/校验通过：1 套 · 2 题 · 2 个资源/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('迁移题套甲 处理方式'), { target: { value: 'overwrite' } })
    expect(screen.getByText(/覆盖将保留匹配题目的 ID/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认导入迁移包' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/admin/question-set-bundles/import', expect.objectContaining({ method: 'POST', body: expect.any(FormData) })))
    expect(confirm).toHaveBeenCalled()
    expect(await screen.findByText('覆盖：#9 迁移题套甲')).toBeInTheDocument()
  })

  it('shows an empty state when no word set can receive an import', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/children') return []
      if (path === '/api/admin/library') return courses
      if (path.startsWith('/api/admin/reports/summary')) return report
      if (path === '/api/admin/word-sets') return []
      return {}
    })
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导入导出' }))
    fireEvent.click(screen.getByRole('tab', { name: '单词词库' }))

    expect(await screen.findByText('请先在单词词库创建单词集。')).toBeInTheDocument()
    expect(screen.queryByLabelText('单词词库文件内容')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入单词词库' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '导出单词词库' })).toBeInTheDocument()
  })
})
