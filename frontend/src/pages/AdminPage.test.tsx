import { fireEvent, render, screen } from '@testing-library/react'
import { api } from '../api'
import type { Course, Report } from '../types'
import { AdminPage } from './AdminPage'

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

  it('uses student wording throughout the administrator interface', async () => {
    render(<AdminPage />)

    expect(await screen.findByRole('button', { name: '学生档案' })).toBeInTheDocument()
    expect(screen.getByText('每个学生都有独立的 PIN 和学习记录。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加学生' })).toBeInTheDocument()
    expect(screen.queryByText(/孩子/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '学习报告' }))
    expect(await screen.findByLabelText('学生')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '全部学生' })).toBeInTheDocument()
    expect(screen.queryByText(/孩子/)).not.toBeInTheDocument()
  })

  it('collapses courses and lessons independently while preserving nested state', async () => {
    render(<AdminPage />)
    fireEvent.click(await screen.findByRole('button', { name: '课程词库' }))

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
    fireEvent.click(await screen.findByRole('button', { name: '课程词库' }))
    fireEvent.click(await screen.findByRole('button', { name: '展开课程 入门课程' }))

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0])
    expect(screen.getByRole('button', { name: '收起课程 入门课程' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '展开关卡 字母关卡' })).toBeInTheDocument()
  })
})
