import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../api'
import type { Course, Report } from '../types'
import { AdminPage, reorderCourseList, saveCourseOrder } from './AdminPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})

const mockedApi = vi.mocked(api)
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
  average_cpm: 0,
  accuracy: 0,
  weak_keys: [],
  attempts: [],
}

describe('AdminPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/admin/children') return [{ id: 1, name: '小宇', active: true }]
      if (path === '/api/admin/library') return courses
      if (path.startsWith('/api/admin/reports/summary')) return report
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
    expect(await screen.findByLabelText('学生')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '全部学生' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '打字练习' })).toHaveValue('course')
    expect(screen.queryByRole('option', { name: '课程练习' })).not.toBeInTheDocument()
    expect(screen.queryByText(/孩子/)).not.toBeInTheDocument()
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
    expect(screen.queryByText('asdf')).not.toBeInTheDocument()

    fireEvent.click(firstLesson)
    expect(screen.getByText('asdf')).toBeInTheDocument()

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
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '打字词库' }))
    fireEvent.click(await screen.findByRole('button', { name: '展开课程 入门课程' }))

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0])
    expect(screen.getByRole('button', { name: '收起课程 入门课程' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '展开关卡 字母关卡' })).toBeInTheDocument()
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
    expect(typingTab).toHaveAttribute('aria-selected', 'true')
    expect(wordTab).toHaveAttribute('aria-selected', 'false')
    expect(await screen.findByRole('heading', { name: '导入课程与练习' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '导出打字词库' })).toHaveAttribute('href', '/api/admin/export')
    expect(screen.getByLabelText('打字词库文件内容')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '导入单词与释义' })).not.toBeInTheDocument()

    fireEvent.keyDown(typingTab, { key: 'ArrowRight' })
    await waitFor(() => expect(wordTab).toHaveAttribute('aria-selected', 'true'))
    expect(wordTab).toHaveFocus()
    expect(screen.queryByRole('heading', { name: '导入课程与练习' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '导入单词与释义' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '导出单词词库' })).toHaveAttribute('href', '/api/admin/word-export')
    expect(await screen.findByLabelText('单词词库文件内容')).toBeInTheDocument()
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
