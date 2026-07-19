import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { api } from '../api'
import type { LessonDetail } from '../types'
import { PracticePage } from './PracticePage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})

const mockedApi = vi.mocked(api)
const lesson: LessonDetail = {
  id: 1,
  title: '基础练习',
  description: '',
  course: { id: 1, title: '入门' },
  prompts: [{ id: 1, lesson_id: 1, content: 'fj' }],
}

function renderPractice() {
  mockedApi.mockResolvedValue(lesson)
  return render(
    <MemoryRouter initialEntries={['/practice/1']}>
      <Routes><Route path="/practice/:lessonId" element={<PracticePage />} /></Routes>
    </MemoryRouter>,
  )
}

async function readyForTyping() {
  await screen.findByText('直接按第一个字符开始计时')
}

describe('PracticePage first-key start', () => {
  beforeEach(() => mockedApi.mockReset())

  it('accepts the first correct key without clicking the typing surface', async () => {
    const { container } = renderPractice()
    await readyForTyping()

    fireEvent.keyDown(window, { key: 'f', code: 'KeyF' })

    await waitFor(() => expect(container.querySelector('.current-char')).toHaveTextContent('j'))
    expect(container.querySelector('.typed')).toHaveTextContent('f')
    expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled()
  })

  it('starts timing and records an incorrect first key', async () => {
    const { container } = renderPractice()
    await readyForTyping()

    fireEvent.keyDown(window, { key: 'd', code: 'KeyD' })

    await waitFor(() => expect(container.querySelector('.metric-strip > div:nth-child(3) strong')).toHaveTextContent('1'))
    expect(container.querySelector('.current-char')).toHaveTextContent('f')
    expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled()
  })

  it('ignores modifier keys and keys pressed on interactive controls', async () => {
    renderPractice()
    await readyForTyping()

    fireEvent.keyDown(window, { key: 'Shift', code: 'ShiftLeft' })
    fireEvent.keyDown(screen.getByRole('button', { name: '隐藏提示' }), { key: 'f', code: 'KeyF' })

    expect(screen.getByText('直接按第一个字符开始计时')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '暂停' })).toBeDisabled()
  })

  it('does not process a surface key twice when it bubbles to the window', async () => {
    const { container } = renderPractice()
    await readyForTyping()
    const surface = screen.getByLabelText('打字练习区域')

    fireEvent.keyDown(surface, { key: 'f', code: 'KeyF' })

    await waitFor(() => expect(container.querySelector('.current-char')).toHaveTextContent('j'))
    expect(container.querySelector('.typed')).toHaveTextContent('f')
  })
})
