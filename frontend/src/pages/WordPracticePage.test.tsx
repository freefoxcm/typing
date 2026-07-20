import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { api } from '../api'
import { WordPracticePage } from './WordPracticePage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})

const mockedApi = vi.mocked(api)

describe('WordPracticePage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/library/word-sets/7') return { id: 7, title: '技术英语', description: '', words: [{ id: 3, spelling: 'cache', phonetic: '/kæʃ/', meaning_zh: '缓存', technical_meaning_zh: '' }] }
      return { id: 1, cpm: 100, accuracy: 100, errors: 0, duration_ms: 3000 }
    })
  })

  it('shows phonetic and meaning before typing and hides an empty technical meaning', async () => {
    const { container } = render(<MemoryRouter initialEntries={['/word-practice/7']}><Routes><Route path="/word-practice/:wordSetId" element={<WordPracticePage />} /></Routes></MemoryRouter>)
    expect(await screen.findByLabelText('单词释义')).toHaveTextContent('/kæʃ/')
    expect(screen.getByLabelText('单词释义')).toHaveTextContent('缓存')
    expect(screen.queryByText('计算机领域')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'c', code: 'KeyC' })
    await waitFor(() => expect(container.querySelector('.typed')).toHaveTextContent('c'))
  })
})
