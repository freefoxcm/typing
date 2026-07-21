import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../api'
import type { WordSetSummary } from '../types'
import { reorderWordSetList, saveWordSetOrder, WordLibraryPanel } from './WordLibraryPanel'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: vi.fn() }
})

const mockedApi = vi.mocked(api)

function makeWordSets(withWord = false): WordSetSummary[] {
  return [{
    id: 7,
    title: '编程词汇',
    description: '基础术语',
    active: true,
    word_count: withWord ? 1 : 0,
    status_counts: { ready: withWord ? 1 : 0, pending: 0, processing: 0, failed: 0 },
    words: withWord ? [{
      id: 70,
      word_set_id: 7,
      spelling: 'cache',
      phonetic: '/kæʃ/',
      meaning_zh: '缓存',
      technical_meaning_zh: '高速临时存储',
      active: true,
      enrichment_status: 'ready',
    }] : [],
  }]
}

describe('WordLibraryPanel', () => {
  let wordSets: WordSetSummary[]
  let failWordSave = false

  beforeEach(() => {
    wordSets = makeWordSets()
    failWordSave = false
    mockedApi.mockReset()
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/api/admin/word-sets') return wordSets
      if (path === '/api/admin/llm/status') return { configured: false, base_url: 'https://api.openai.com/v1', model: '' }
      if ((path === '/api/admin/words' || path.startsWith('/api/admin/words/')) && ['POST', 'PUT'].includes(options?.method ?? '')) {
        if (failWordSave) throw new Error('保存失败，请重试')
        const payload = JSON.parse(String(options?.body))
        const saved = { id: path === '/api/admin/words' ? 71 : 70, ...payload, enrichment_status: payload.phonetic && payload.meaning_zh ? 'ready' : 'pending' }
        wordSets = [{ ...wordSets[0], word_count: 1, words: [saved], status_counts: { ready: saved.enrichment_status === 'ready' ? 1 : 0, pending: saved.enrichment_status === 'pending' ? 1 : 0 } }]
        return saved
      }
      return {}
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('reorders word sets and saves their complete order', async () => {
    const secondSet: WordSetSummary = { ...makeWordSets()[0], id: 8, title: '网络词汇', sort_order: 1 }
    const original = [{ ...makeWordSets()[0], sort_order: 0 }, secondSet]
    const reordered = reorderWordSetList(original, 8, 7)

    expect(reordered.map((item) => item.id)).toEqual([8, 7])
    expect(reordered.map((item) => item.sort_order)).toEqual([0, 1])
    expect(reorderWordSetList(original, 99, 7)).toBe(original)

    await saveWordSetOrder(reordered)
    expect(mockedApi).toHaveBeenCalledWith('/api/admin/word-sets/order', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ word_set_ids: [8, 7] }),
    }))
  })

  it('provides an accessible drag handle for each word set', async () => {
    wordSets = [...makeWordSets(), { ...makeWordSets()[0], id: 8, title: '网络词汇', sort_order: 1 }]
    render(<WordLibraryPanel />)

    const firstHandle = await screen.findByRole('button', { name: '拖动单词集 编程词汇 调整顺序' })
    expect(firstHandle).toBeEnabled()
    expect(firstHandle).toHaveAttribute('title', expect.stringContaining('方向键移动'))
    expect(screen.getByRole('button', { name: '拖动单词集 网络词汇 调整顺序' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '上移单词集 编程词汇' })).not.toBeInTheDocument()
    expect(screen.getByText(/使用上下方向键移动/)).toBeInTheDocument()
  })

  it('adds a word from its word-set card and expands the refreshed set', async () => {
    render(<WordLibraryPanel />)
    const addButton = await screen.findByRole('button', { name: '向单词集 编程词汇 添加单词' })
    addButton.focus()
    fireEvent.click(addButton)

    expect(screen.getByRole('dialog', { name: '向「编程词汇」添加单词' })).toBeInTheDocument()
    expect(screen.getByText('目标单词集：编程词汇')).toBeInTheDocument()
    expect(screen.getByLabelText('单词或术语')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('单词或术语'), { target: { value: 'array' } })
    fireEvent.change(screen.getByLabelText('美式音标'), { target: { value: '/əˈreɪ/' } })
    fireEvent.change(screen.getByLabelText('常用中文释义'), { target: { value: '数组' } })
    fireEvent.change(screen.getByLabelText('计算机领域释义'), { target: { value: '同类型元素集合' } })
    fireEvent.click(screen.getByRole('button', { name: '添加单词' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/admin/words',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ word_set_id: 7, spelling: 'array', phonetic: '/əˈreɪ/', meaning_zh: '数组', technical_meaning_zh: '同类型元素集合', active: true }),
      }),
    ))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('array')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起单词集 编程词汇' })).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(addButton).toHaveFocus())
  })

  it('edits all word fields in one modal while preserving set and active state', async () => {
    wordSets = makeWordSets(true)
    render(<WordLibraryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '展开单词集 编程词汇' }))
    fireEvent.click(await screen.findByRole('button', { name: '编辑单词 cache' }))

    expect(screen.getByRole('dialog', { name: '编辑 cache' })).toBeInTheDocument()
    expect(screen.getByLabelText('单词或术语')).toHaveValue('cache')
    expect(screen.getByLabelText('美式音标')).toHaveValue('/kæʃ/')
    expect(screen.getByLabelText('常用中文释义')).toHaveValue('缓存')
    expect(screen.getByLabelText('计算机领域释义')).toHaveValue('高速临时存储')
    fireEvent.change(screen.getByLabelText('单词或术语'), { target: { value: 'cached' } })
    fireEvent.change(screen.getByLabelText('美式音标'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('常用中文释义'), { target: { value: '已缓存的' } })
    fireEvent.change(screen.getByLabelText('计算机领域释义'), { target: { value: '存入缓存的数据' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(
      '/api/admin/words/70',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ word_set_id: 7, spelling: 'cached', phonetic: '', meaning_zh: '已缓存的', technical_meaning_zh: '存入缓存的数据', active: true }),
      }),
    ))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes safely and keeps form data visible when saving fails', async () => {
    render(<WordLibraryPanel />)
    const addButton = await screen.findByRole('button', { name: '向单词集 编程词汇 添加单词' })
    addButton.focus()
    fireEvent.click(addButton)
    fireEvent.change(screen.getByLabelText('单词或术语'), { target: { value: 'thread' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockedApi.mock.calls.some(([path]) => path === '/api/admin/words')).toBe(false)
    await waitFor(() => expect(addButton).toHaveFocus())

    fireEvent.click(addButton)
    const dialog = screen.getByRole('dialog')
    fireEvent.mouseDown(dialog.parentElement!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(addButton).toHaveFocus())

    fireEvent.click(addButton)
    failWordSave = true
    fireEvent.change(screen.getByLabelText('单词或术语'), { target: { value: 'thread' } })
    fireEvent.click(screen.getByRole('button', { name: '添加单词' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败，请重试')
    expect(screen.getByLabelText('单词或术语')).toHaveValue('thread')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(addButton).toHaveFocus())
  })
})
