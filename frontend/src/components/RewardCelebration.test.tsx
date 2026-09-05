import { act, fireEvent, render, screen } from '@testing-library/react'
import { RewardCelebration } from './RewardCelebration'
import type { Reward } from '../rewards'

const reward: Reward = { id: 1, child_id: 1, source_session_id: 7, reward_date: '2026-09-05', games: ['super-mario', 'kart-racer'], status: 'available', display_version: 1, duration_minutes: 5, mode: 'score', play: null }

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('reveals both games and shared time without moving focus or starting play', () => {
  const done = vi.fn()
  render(<><button autoFocus>查看解析</button><RewardCelebration reward={reward} onDone={done} /></>)
  expect(screen.getByText('隐藏彩蛋解锁！')).toBeInTheDocument()
  expect(screen.getByText('星光冒险')).toBeInTheDocument()
  expect(screen.getByText('卡丁赛车')).toBeInTheDocument()
  expect(screen.getByText(/共享 5 分钟/)).toBeInTheDocument()
  expect(screen.getByText('查看解析')).toHaveFocus()
  act(() => vi.advanceTimersByTime(2999))
  expect(done).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  expect(done).toHaveBeenCalledOnce()
})

it('can skip with Escape and cleans timers when unmounted', () => {
  const done = vi.fn()
  const view = render(<RewardCelebration reward={reward} onDone={done} />)
  fireEvent.keyDown(window, { code: 'Escape' })
  expect(done).toHaveBeenCalledOnce()
  view.unmount()
  act(() => vi.advanceTimersByTime(5000))
  expect(done).toHaveBeenCalledOnce()
})

it('uses a shorter upgrade and preserves the original time', () => {
  const done = vi.fn()
  render(<RewardCelebration reward={{ ...reward, display_version: 2 }} onDone={done} />)
  expect(screen.getByText('新游戏加入奖励！')).toBeInTheDocument()
  expect(screen.queryByText('获得 5 分钟游戏时光')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1500))
  expect(done).toHaveBeenCalledOnce()
})

it('respects reduced motion and supports the skip button', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const done = vi.fn()
  const view = render(<RewardCelebration reward={reward} onDone={done} />)
  expect(document.querySelector('.reward-celebration')).toHaveClass('is-reduced')
  fireEvent.click(screen.getByRole('button', { name: /跳过动画/ }))
  expect(done).toHaveBeenCalledOnce()
  view.unmount(); vi.unstubAllGlobals()
})
