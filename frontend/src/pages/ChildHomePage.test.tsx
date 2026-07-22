import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api'
import type { Course, ExerciseSessionSummary, Me } from '../types'
import { ChildHomePage } from './ChildHomePage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})

const mockedApi = vi.mocked(api)
const me: Me = { role: 'child', name: '小宇', actor_id: 1 }
const courses: Course[] = [
  { id: 1, title: '入门课程', description: '基础练习', lessons: [{ id: 11, title: '字母练习', description: '', prompt_count: 3 }] },
  { id: 2, title: '代码课程', description: '符号练习', lessons: [{ id: 21, title: '符号练习', description: '', prompt_count: 4 }] },
]
const wordSets = [{ id: 9, title: '计算机英语', description: '', word_count: 12, attempts: 3, best_cpm: 80 }]
const questionSets = [{ id: 8, title: 'Python 练习', description: '', status: 'published' as const, question_count: 2, total_points: 4, counts: { single_choice: 1, multiple_choice: 0, true_false: 1, programming: 0 } }]
const activeExercises: ExerciseSessionSummary[] = [{
  id: 77, title: '未完成的 Python 练习', mode: 'set', status: 'in_progress', answered_count: 1, total_count: 4,
  created_at: '2026-07-21T08:00:00', last_activity_at: '2026-07-22T09:30:00',
}]

describe('ChildHomePage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedApi.mockImplementation(async (path) => path === '/api/library/courses' ? courses : [])
  })

  it('keeps courses collapsed by default and allows multiple courses to remain open', async () => {
    render(<MemoryRouter><ChildHomePage me={me} /></MemoryRouter>)

    const firstCourse = await screen.findByRole('button', { name: '展开课程 入门课程' })
    expect(screen.getByRole('tab', { name: '打字练习' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: '单词练习' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '循序渐进，练出速度' })).toBeInTheDocument()
    expect(screen.getByText('从字母、符号到代码，准确地完成每一课。')).toBeInTheDocument()
    const secondCourse = screen.getByRole('button', { name: '展开课程 代码课程' })
    expect(firstCourse).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('字母练习')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /符号练习/ })).not.toBeInTheDocument()

    fireEvent.click(firstCourse)
    expect(screen.getByRole('button', { name: '收起课程 入门课程' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('字母练习')).toBeInTheDocument()

    fireEvent.click(secondCourse)
    expect(screen.getByText('字母练习')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /符号练习/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '收起课程 入门课程' }))
    expect(screen.queryByText('字母练习')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /符号练习/ })).toBeInTheDocument()
  })

  it('shows ready word sets as a separate practice area', async () => {
    mockedApi.mockImplementation(async (path) => path === '/api/library/courses' ? courses : path === '/api/library/word-sets' ? wordSets : [])
    render(<MemoryRouter><ChildHomePage me={me} /></MemoryRouter>)
    const wordSetLink = await screen.findByRole('link', { name: /计算机英语/ })
    expect(screen.getByRole('tab', { name: '单词练习' })).toHaveAttribute('aria-selected', 'true')
    expect(wordSetLink).toHaveAttribute('href', '/word-practice/9')
    expect(screen.getByText(/12 词/)).toBeInTheDocument()
    expect(wordSetLink).toHaveTextContent('已练 3 次')
  })

  it('switches accessible practice tabs in order and preserves course expansion', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/library/courses') return courses
      if (path === '/api/library/word-sets') return wordSets
      if (path === '/api/exercises/question-sets') return questionSets
      return []
    })
    render(<MemoryRouter><ChildHomePage me={me} /></MemoryRouter>)
    const wordsTab = await screen.findByRole('tab', { name: '单词练习' })
    const typingTab = screen.getByRole('tab', { name: '打字练习' })
    const exercisesTab = screen.getByRole('tab', { name: '习题练习' })
    expect(screen.getAllByRole('tab')).toEqual([wordsTab, typingTab, exercisesTab])
    expect(wordsTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '边输入，边记住单词' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '循序渐进，练出速度' })).not.toBeInTheDocument()

    fireEvent.keyDown(wordsTab, { key: 'ArrowRight' })
    expect(typingTab).toHaveFocus()
    expect(typingTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: '展开课程 入门课程' }))
    expect(screen.getByText('字母练习')).toBeInTheDocument()

    fireEvent.click(exercisesTab)
    expect(screen.getByRole('heading', { name: '读题、思考、动手编程' })).toBeInTheDocument()
    fireEvent.click(typingTab)
    expect(screen.getByRole('button', { name: '收起课程 入门课程' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('字母练习')).toBeInTheDocument()
  })

  it('uses exercises as the first available area when other libraries are empty', async () => {
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/question-sets' ? questionSets : [])
    render(<MemoryRouter><ChildHomePage me={me} /></MemoryRouter>)
    const exercisesTab = await screen.findByRole('tab', { name: '习题练习' })
    expect(screen.getAllByRole('tab')).toEqual([exercisesTab])
    expect(exercisesTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '读题、思考、动手编程' })).toBeInTheDocument()
  })

  it('keeps the exercise area available when only an unfinished session exists', async () => {
    mockedApi.mockImplementation(async (path) => path === '/api/exercises/active-sessions' ? activeExercises : [])
    render(<MemoryRouter><ChildHomePage me={me} /></MemoryRouter>)
    const exercisesTab = await screen.findByRole('tab', { name: '习题练习' })
    expect(exercisesTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '继续上次练习' })).toBeInTheDocument()
    expect(screen.getByText('未完成的 Python 练习')).toBeInTheDocument()
    expect(screen.getByText('已完成 1 / 4 题')).toBeInTheDocument()
  })

  it('keeps the existing empty state when no practice content is available', async () => {
    mockedApi.mockResolvedValue([])
    render(<MemoryRouter><ChildHomePage me={me} /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '还没有可练习的内容' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})
