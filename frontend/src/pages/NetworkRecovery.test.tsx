import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../api'
import { AdminPage } from './AdminPage'
import { WordLibraryPanel } from './WordLibraryPanel'
import { QuestionLibraryPanel } from './QuestionLibraryPanel'

vi.mock('../api', async (importOriginal) => ({ ...await importOriginal<typeof import('../api')>(), api: vi.fn() }))
const mockedApi = vi.mocked(api)

it.each([
  { kind: 'student', path: '/api/admin/children', label: '昵称', button: '添加学生', success: '学生档案已创建' },
  { kind: 'course', path: '/api/admin/courses', label: '课程名称', button: '新建课程', success: '课程已创建' },
  { kind: 'word', path: '/api/admin/word-sets', label: '单词集名称', button: '新建单词集', success: '单词集已创建' },
  { kind: 'question', path: '/api/admin/question-sets', label: '题套名称', button: '手动新建题套', success: '题套草稿已创建' },
])('preserves $kind input on write failure and retries only the read after a successful write', async ({ kind, path, label, button }) => {
  let failWrite = true
  let failRead = false
  mockedApi.mockReset()
  mockedApi.mockImplementation(async (url, init) => {
    if (url === path && init?.method === 'POST') {
      if (failWrite) throw new Error('保存连接中断')
      failRead = true
      return { id: 10 }
    }
    if ((url === path || kind === 'course' && url === '/api/admin/library') && failRead) throw new Error('刷新连接中断')
    if (url.endsWith('/status')) return { configured: false, model: '', base_url: '', batch_pages: 3 }
    return []
  })
  await act(async () => {
    render(kind === 'word' ? <WordLibraryPanel /> : kind === 'question' ? <QuestionLibraryPanel /> : <AdminPage />)
  })
  if (kind === 'course') fireEvent.click(screen.getByRole('button', { name: '打字词库' }))
  fireEvent.change(screen.getByLabelText(label), { target: { value: '保留输入' } })
  if (kind === 'student') fireEvent.change(screen.getByLabelText('PIN', { exact: true }), { target: { value: '1234' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: button })))
  expect(screen.getByLabelText(label)).toHaveValue('保留输入')
  if (kind === 'student') expect(screen.getByLabelText('PIN', { exact: true })).toHaveValue('1234')
  failWrite = false
  await act(async () => fireEvent.click(screen.getByRole('button', { name: button })))
  expect(await screen.findByText(/操作已完成，但列表刷新失败/)).toBeInTheDocument()
  expect(screen.getByLabelText(label)).toHaveValue('')
  const writes = () => mockedApi.mock.calls.filter(([url, init]) => url === path && init?.method === 'POST')
  expect(writes()).toHaveLength(2)
  failRead = false
  fireEvent.click(screen.getByRole('button', { name: '重试刷新' }))
  await waitFor(() => expect(screen.queryByText(/操作已完成，但列表刷新失败/)).not.toBeInTheDocument())
  expect(writes()).toHaveLength(2)
})
