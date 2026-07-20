import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api'
import type { Course, Me } from '../types'
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

describe('ChildHomePage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedApi.mockResolvedValue(courses)
  })

  it('keeps courses collapsed by default and allows multiple courses to remain open', async () => {
    render(<MemoryRouter><ChildHomePage me={me} /></MemoryRouter>)

    const firstCourse = await screen.findByRole('button', { name: '展开课程 入门课程' })
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
})
