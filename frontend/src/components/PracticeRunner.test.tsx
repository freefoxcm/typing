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
  })

  afterEach(() => vi.useRealTimers())

  it('shows the result dialog only after every item in the round is complete', async () => {
    mockedApi
      .mockResolvedValueOnce({ id: 1, cpm: 120, accuracy: 66.67, errors: 1, duration_ms: 1000, speed_char_count: 2, metric_version: 2 })
      .mockResolvedValueOnce({ id: 2, cpm: 60, accuracy: 100, errors: 0, duration_ms: 1000, speed_char_count: 1, metric_version: 2 })
    const { container } = render(<MemoryRouter><PracticeRunner
      contextLabel="测试课程"
      title="测试关卡"
      backLabel="返回"
      items={[{ id: 1, content: 'ab' }, { id: 2, content: 'cd' }]}
      savePath="/api/practice/attempts"
      saveIdKey="prompt_id"
    /></MemoryRouter>)

    const surface = screen.getByLabelText('打字练习区域')
    fireEvent.keyDown(window, { key: 'x', code: 'KeyX' })
    while (container.querySelector('.current-char')) {
      const character = container.querySelector('.current-char')?.textContent ?? ''
      fireEvent.keyDown(surface, { key: character, code: `Key${character.toUpperCase()}` })
    }
    await act(async () => { await Promise.resolve() })

    expect(mockedApi).toHaveBeenCalledTimes(1)
    expect(screen.getByText('本条完成，准备下一条…')).toBeInTheDocument()
    expect(screen.queryByText('本轮完成！')).not.toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    while (container.querySelector('.current-char')) {
      const character = container.querySelector('.current-char')?.textContent ?? ''
      fireEvent.keyDown(surface, { key: character, code: `Key${character.toUpperCase()}` })
    }
    await act(async () => { await Promise.resolve() })

    expect(mockedApi).toHaveBeenCalledTimes(2)
    expect(screen.getByText('本轮完成！')).toBeInTheDocument()
    expect(screen.getByText('90 CPM · 80% 准确率')).toBeInTheDocument()
    const firstPayload = JSON.parse(String(mockedApi.mock.calls[0][1]?.body))
    const secondPayload = JSON.parse(String(mockedApi.mock.calls[1][1]?.body))
    expect(firstPayload.speed_char_count).toBe(2)
    expect(secondPayload.speed_char_count).toBe(1)
    expect(screen.getByText('5 秒后自动进入下一轮')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一轮' })).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(4999) })
    expect(screen.getByText('本轮完成！')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.queryByText('本轮完成！')).not.toBeInTheDocument()
    expect(screen.getByText('本轮进度 1 / 2')).toBeInTheDocument()
  })

  it('starts the next round immediately when the button is clicked', async () => {
    mockedApi.mockResolvedValueOnce({ id: 1, cpm: null, accuracy: 100, errors: 0, duration_ms: 100, speed_char_count: 0, metric_version: 2 })
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
    expect(screen.getByText('— CPM · 100% 准确率')).toBeInTheDocument()
    expect(JSON.parse(String(mockedApi.mock.calls[0][1]?.body)).speed_char_count).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '下一轮' }))
    expect(screen.queryByText('本轮完成！')).not.toBeInTheDocument()
    expect(screen.getByText('直接按第一个字符开始计时')).toBeInTheDocument()
  })

  it('counts every correct character when the first key is wrong', async () => {
    mockedApi.mockResolvedValueOnce({ id: 1, cpm: 60, accuracy: 50, errors: 1, duration_ms: 1000, speed_char_count: 1, metric_version: 2 })
    render(<MemoryRouter><PracticeRunner
      contextLabel="测试课程"
      title="单字符"
      backLabel="返回"
      items={[{ id: 1, content: 'a' }]}
      savePath="/api/practice/attempts"
      saveIdKey="prompt_id"
    /></MemoryRouter>)

    fireEvent.keyDown(window, { key: 'x', code: 'KeyX' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    fireEvent.keyDown(screen.getByLabelText('打字练习区域'), { key: 'a', code: 'KeyA' })
    await act(async () => { await Promise.resolve() })

    expect(JSON.parse(String(mockedApi.mock.calls[0][1]?.body)).speed_char_count).toBe(1)
    expect(screen.getByText('60 CPM · 50% 准确率')).toBeInTheDocument()
  })

  it('excludes paused time from the submitted duration', async () => {
    mockedApi.mockResolvedValueOnce({ id: 1, cpm: 30, accuracy: 100, errors: 0, duration_ms: 2000, speed_char_count: 1, metric_version: 2 })
    render(<MemoryRouter><PracticeRunner
      contextLabel="测试课程"
      title="暂停计时"
      backLabel="返回"
      items={[{ id: 1, content: 'ab' }]}
      savePath="/api/practice/attempts"
      saveIdKey="prompt_id"
    /></MemoryRouter>)
    const surface = screen.getByLabelText('打字练习区域')

    fireEvent.keyDown(surface, { key: 'a', code: 'KeyA' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    fireEvent.keyDown(surface, { key: 'Escape', code: 'Escape' })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    fireEvent.keyDown(surface, { key: 'Escape', code: 'Escape' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    fireEvent.keyDown(surface, { key: 'b', code: 'KeyB' })
    await act(async () => { await Promise.resolve() })

    expect(JSON.parse(String(mockedApi.mock.calls[0][1]?.body)).duration_ms).toBe(2000)
  })

  it('resets the first-key correction when the prompt is restarted', async () => {
    mockedApi.mockResolvedValueOnce({ id: 1, cpm: 120, accuracy: 66.67, errors: 1, duration_ms: 1000, speed_char_count: 2, metric_version: 2 })
    render(<MemoryRouter><PracticeRunner
      contextLabel="测试课程"
      title="重练计时"
      backLabel="返回"
      items={[{ id: 1, content: 'ab' }]}
      savePath="/api/practice/attempts"
      saveIdKey="prompt_id"
    /></MemoryRouter>)
    const surface = screen.getByLabelText('打字练习区域')

    fireEvent.keyDown(surface, { key: 'a', code: 'KeyA' })
    fireEvent.click(screen.getByRole('button', { name: '重练' }))
    fireEvent.keyDown(surface, { key: 'x', code: 'KeyX' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    fireEvent.keyDown(surface, { key: 'a', code: 'KeyA' })
    fireEvent.keyDown(surface, { key: 'b', code: 'KeyB' })
    await act(async () => { await Promise.resolve() })

    expect(JSON.parse(String(mockedApi.mock.calls[0][1]?.body)).speed_char_count).toBe(2)
  })
})
