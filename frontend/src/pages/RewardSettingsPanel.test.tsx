import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../api'
import { RewardSettingsPanel } from './RewardSettingsPanel'

vi.mock('../api', () => ({ api: vi.fn(), jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }) }))
const defaults = { enabled: false, duration_minutes: 15, mode: 'score', adventure_threshold: 80, racer_threshold: 90, random_threshold: 80, minimum_questions: 10 }

it('previews global score/random rules and persists the submitted settings', async () => {
  vi.mocked(api).mockImplementation(async (_path, init) => init?.method === 'PUT' ? JSON.parse(init.body as string) : defaults)
  render(<RewardSettingsPanel />)
  expect(await screen.findByLabelText(/启用学习彩蛋/)).not.toBeChecked()
  expect(screen.getByLabelText('每次奖励时长（分钟）')).toHaveValue(15)
  expect(screen.getByText(/达到 80 分解锁星光冒险/)).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText(/启用学习彩蛋/))
  fireEvent.change(screen.getByLabelText('解锁方式'), { target: { value: 'random' } })
  expect(screen.queryByLabelText('星光冒险门槛（百分制）')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('每次奖励时长（分钟）'), { target: { value: '8' } })
  expect(screen.getByText(/必定随机获得一个游戏.*共享 8 分钟/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('保存设置'))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('设置已保存'))
  expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === 'PUT' && JSON.parse(init.body as string).enabled === true)).toBe(true)
})
