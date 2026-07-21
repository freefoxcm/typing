import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { api } from '../api'
import type { QuestionSetSummary } from '../types'
import { ExerciseHomeSection } from './ExerciseHomeSection'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})

const mockedApi = vi.mocked(api)
const sets: QuestionSetSummary[] = [{
  id: 3, title: 'Python 基础', description: '基础题', status: 'published', question_count: 4, total_points: 10,
  counts: { single_choice: 2, multiple_choice: 0, true_false: 1, programming: 1 },
}]

describe('ExerciseHomeSection', () => {
  beforeEach(() => mockedApi.mockReset())

  it('opens random practice in a modal and validates available counts', async () => {
    render(<MemoryRouter><ExerciseHomeSection sets={sets} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /随机组题/ })).toHaveClass('primary')
    expect(screen.getByRole('button', { name: /错题重练/ })).toHaveClass('primary')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /随机组题/ }))
    expect(screen.getByRole('dialog', { name: '随机组题' })).toBeInTheDocument()
    expect(screen.getByText('可用 2')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('单选题数量'), { target: { value: '3' } })
    expect(screen.getByRole('alert')).toHaveTextContent('单选题最多可选 2 道')
    expect(screen.getByRole('button', { name: /开始随机练习/ })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('starts random practice with the selected configuration', async () => {
    mockedApi.mockResolvedValue({ id: 88 })
    render(<MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<ExerciseHomeSection sets={sets} />} /><Route path="/exercise/:id" element={<p>进入答题</p>} /></Routes></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /随机组题/ }))
    fireEvent.change(screen.getByLabelText('单选题数量'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('判断题数量'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /开始随机练习/ }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/exercises/sessions', expect.objectContaining({ method: 'POST' })))
    expect(await screen.findByText('进入答题')).toBeInTheDocument()
  })
})
