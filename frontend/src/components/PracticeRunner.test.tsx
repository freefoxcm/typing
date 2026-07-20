import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api'
import { PracticeRunner } from './PracticeRunner'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})

const mockedApi = vi.mocked(api)

describe('PracticeRunner round completion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockedApi.mockReset()
    mockedApi
      .mockResolvedValueOnce({ id: 1, cpm: 60, accuracy: 50, errors: 1, duration_ms: 1000 })
      .mockResolvedValueOnce({ id: 2, cpm: 60, accuracy: 100, errors: 0, duration_ms: 1000 })
  })

  afterEach(() => vi.useRealTimers())

  it('shows the result dialog only after every item in the round is complete', async () => {
    const { container } = render(<MemoryRouter><PracticeRunner
      contextLabel="测试课程"
      title="测试关卡"
      backLabel="返回"
      items={[{ id: 1, content: 'a' }, { id: 2, content: 'b' }]}
      savePath="/api/practice/attempts"
      saveIdKey="prompt_id"
    /></MemoryRouter>)

    const surface = screen.getByLabelText('打字练习区域')
    const firstCharacter = container.querySelector('.current-char')?.textContent ?? ''
    fireEvent.keyDown(window, { key: 'x', code: 'KeyX' })
    fireEvent.keyDown(surface, { key: firstCharacter, code: `Key${firstCharacter.toUpperCase()}` })
    await act(async () => { await Promise.resolve() })

    expect(mockedApi).toHaveBeenCalledTimes(1)
    expect(screen.getByText('本条完成，准备下一条…')).toBeInTheDocument()
    expect(screen.queryByText('本轮完成！')).not.toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    const secondCharacter = container.querySelector('.current-char')?.textContent ?? ''
    fireEvent.keyDown(surface, { key: secondCharacter, code: `Key${secondCharacter.toUpperCase()}` })
    await act(async () => { await Promise.resolve() })

    expect(mockedApi).toHaveBeenCalledTimes(2)
    expect(screen.getByText('本轮完成！')).toBeInTheDocument()
    expect(screen.getByText('60 CPM · 66.67% 准确率')).toBeInTheDocument()
    expect(screen.getByText('5 秒后自动进入下一轮')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一轮' })).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(4999) })
    expect(screen.getByText('本轮完成！')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.queryByText('本轮完成！')).not.toBeInTheDocument()
    expect(screen.getByText('本轮进度 1 / 2')).toBeInTheDocument()
  })

  it('starts the next round immediately when the button is clicked', async () => {
    render(<MemoryRouter><PracticeRunner
      contextLabel="测试课程"
      title="单条关卡"
      backLabel="返回"
      items={[{ id: 1, content: 'a' }]}
      savePath="/api/practice/attempts"
      saveIdKey="prompt_id"
    /></MemoryRouter>)

    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('本轮完成！')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一轮' }))
    expect(screen.queryByText('本轮完成！')).not.toBeInTheDocument()
    expect(screen.getByText('直接按第一个字符开始计时')).toBeInTheDocument()
  })
})
