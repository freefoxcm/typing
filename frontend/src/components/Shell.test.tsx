import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api'
import { Shell } from './Shell'

vi.mock('../api', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

it('shows logout failures and prevents duplicate requests while retrying', async () => {
  mockedApi.mockImplementation((path) => path === '/api/easter-eggs/reward' ? Promise.resolve({ reward: null }) : Promise.reject(new Error('连接中断')))
  render(<MemoryRouter><Shell me={{ role: 'child', actor_id: 1, name: '学生' }}><p>当前练习</p></Shell></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('未能确认退出登录：连接中断')
  expect(screen.getByText('当前练习')).toBeInTheDocument()
  let fail: (reason: Error) => void = () => {}
  mockedApi.mockImplementation((path) => path === '/api/easter-eggs/reward' ? Promise.resolve({ reward: null }) : new Promise((_resolve, reject) => { fail = reject }))
  fireEvent.click(screen.getByRole('button', { name: '重试退出登录' }))
  fireEvent.click(screen.getByRole('button', { name: '正在退出登录' }))
  expect(mockedApi.mock.calls.filter(([path]) => path === '/api/auth/logout')).toHaveLength(2)
  await act(async () => fail(new Error('仍未连接')))
  expect(screen.getByRole('alert')).toHaveTextContent('仍未连接')
  expect(screen.getByRole('button', { name: '退出登录' })).toBeEnabled()
})
