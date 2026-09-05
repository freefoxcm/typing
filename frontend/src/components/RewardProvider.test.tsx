import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api'
import { RewardCard, RewardProvider, useReward } from './RewardProvider'
import type { Reward } from '../rewards'

vi.mock('../api', () => ({ api: vi.fn() }))
vi.mock('./RewardCelebration', () => ({ RewardCelebration: ({ reward, onDone }: { reward: Reward; onDone: () => void }) => <button onClick={onDone}>庆祝版本 {reward.display_version}</button> }))
function Refresh() { const { refresh } = useReward(); return <button onClick={() => void refresh()}>同步奖励</button> }
const reward: Reward = { id: 123, child_id: 1, source_session_id: 7, reward_date: '2026-09-05', games: ['super-mario'], status: 'available', display_version: 1, duration_minutes: 5, mode: 'score', play: null }
const tree = () => <MemoryRouter><RewardProvider childId={1}><RewardCard /><Refresh /></RewardProvider></MemoryRouter>

it('celebrates once across remounts, celebrates upgrades, and removes revoked rewards', async () => {
  localStorage.clear()
  let current: Reward | null = reward
  vi.mocked(api).mockImplementation(async () => ({ reward: current, server_now: '2026-09-05T10:00:00Z' }))
  let view = render(tree())
  fireEvent.click(await screen.findByText('庆祝版本 1'))
  expect(screen.getByRole('link', { name: '现在玩' })).toBeInTheDocument()
  fireEvent.click(screen.getByText('稍后再玩'))
  expect(screen.getByText(/礼物已留在首页/)).toBeInTheDocument()
  view.unmount(); view = render(tree())
  await screen.findByRole('link', { name: '现在玩' })
  expect(screen.queryByText('庆祝版本 1')).not.toBeInTheDocument()
  current = { ...reward, games: ['super-mario', 'kart-racer'], display_version: 2 }
  fireEvent.click(screen.getByText('同步奖励'))
  fireEvent.click(await screen.findByText('庆祝版本 2'))
  current = null
  fireEvent.click(screen.getByText('同步奖励'))
  await waitFor(() => expect(screen.queryByRole('link', { name: '现在玩' })).not.toBeInTheDocument())
  expect(vi.mocked(api).mock.calls.every(([path]) => path === '/api/easter-eggs/reward')).toBe(true)
  view.unmount()
})

it('does not disrupt learning when reward discovery fails', async () => {
  vi.mocked(api).mockRejectedValue(new Error('网络中断'))
  await act(async () => { render(tree()) })
  expect(screen.queryByLabelText('游戏奖励')).not.toBeInTheDocument()
  expect(screen.getByText('同步奖励')).toBeEnabled()
})
