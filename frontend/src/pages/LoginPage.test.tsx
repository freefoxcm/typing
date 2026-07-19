import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api'
import { LoginPage } from './LoginPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})

const mockedApi = vi.mocked(api)

function renderLogin() {
  const onLogin = vi.fn()
  render(<MemoryRouter><LoginPage onLogin={onLogin} /></MemoryRouter>)
  return { onLogin }
}

describe('LoginPage', () => {
  beforeEach(() => mockedApi.mockReset())

  it('shows blank manual login fields without requesting a child roster', () => {
    renderLogin()

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByLabelText('学生姓名')).toHaveValue('')
    expect(screen.getByLabelText('输入 PIN')).toHaveValue('')
    expect(mockedApi).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '管理员' }))
    expect(screen.getByLabelText('管理员用户名')).toHaveValue('')
    expect(screen.getByLabelText('密码')).toHaveValue('')
  })

  it('clears credentials whenever the login mode changes', () => {
    renderLogin()
    fireEvent.change(screen.getByLabelText('学生姓名'), { target: { value: '小宇' } })
    fireEvent.change(screen.getByLabelText('输入 PIN'), { target: { value: '1234' } })

    fireEvent.click(screen.getByRole('button', { name: '管理员' }))
    fireEvent.change(screen.getByLabelText('管理员用户名'), { target: { value: 'root' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret' } })

    fireEvent.click(screen.getByRole('button', { name: '孩子登录' }))
    expect(screen.getByLabelText('学生姓名')).toHaveValue('')
    expect(screen.getByLabelText('输入 PIN')).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: '管理员' }))
    expect(screen.getByLabelText('管理员用户名')).toHaveValue('')
    expect(screen.getByLabelText('密码')).toHaveValue('')
  })

  it('submits a trimmed student name and PIN', async () => {
    const me = { role: 'child' as const, name: '小宇', actor_id: 1 }
    mockedApi.mockResolvedValue(me)
    const { onLogin } = renderLogin()
    fireEvent.change(screen.getByLabelText('学生姓名'), { target: { value: '  小宇  ' } })
    fireEvent.change(screen.getByLabelText('输入 PIN'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/api/auth/child/login', {
      method: 'POST',
      body: JSON.stringify({ name: '小宇', pin: '1234' }),
    }))
    expect(onLogin).toHaveBeenCalledWith(me)
  })
})
