import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api'
import { RewardPlayPage } from './RewardPlayPage'
import type { Reward } from '../rewards'

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})
const reward: Reward = { id: 1, child_id: 1, source_session_id: 7, reward_date: '2026-09-05', games: ['super-mario'], status: 'available', display_version: 1, duration_minutes: 5, mode: 'score', play: null }

it('prepares without starting, validates iframe messages, and starts only after user action', async () => {
  let instance = ''
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path.endsWith('/prepare')) { instance = JSON.parse(init!.body as string).instance_id; return { url: '/game-preview' } }
    return { reward, server_now: new Date().toISOString() }
  })
  const view = render(<MemoryRouter><RewardPlayPage /></MemoryRouter>)
  await waitFor(() => expect(screen.getByTitle('星光冒险')).toBeInTheDocument())
  expect(screen.getByRole('button', { name: '开始游戏' })).toBeDisabled()
  expect(vi.mocked(api).mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false)
  const iframe = screen.getByTitle('星光冒险') as HTMLIFrameElement
  const ready = { channel: 'typing-reward', instanceId: instance, gameId: 'super-mario', type: 'ready' }
  act(() => window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window, data: ready })))
  expect(screen.getByRole('button', { name: '开始游戏' })).toBeDisabled()
  act(() => window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: iframe.contentWindow, data: { ...ready, gameId: 'kart-racer' } })))
  expect(screen.getByRole('button', { name: '开始游戏' })).toBeDisabled()
  act(() => window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: iframe.contentWindow, data: ready })))
  expect(screen.getByRole('button', { name: '开始游戏' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '开始游戏' }))
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path]) => path.endsWith('/start'))).toBe(true))
  view.unmount()
})

it('counts down an existing session even before the user clicks continue', async () => {
  const now = new Date()
  vi.mocked(api).mockImplementation(async path => path.endsWith('/prepare') ? { url: '/game-preview' } : {
    reward: { ...reward, status: 'started', play: { id: 2, game_id: 'super-mario', started_at: now.toISOString(), expires_at: new Date(now.getTime() + 450).toISOString() } }, server_now: now.toISOString(),
  })
  render(<MemoryRouter><RewardPlayPage /></MemoryRouter>)
  await screen.findByText('下一段精彩，等你开启')
  expect(screen.queryByTitle('星光冒险')).not.toBeInTheDocument()
  expect(vi.mocked(api).mock.calls.some(([path]) => path.endsWith('/heartbeat'))).toBe(false)
})
