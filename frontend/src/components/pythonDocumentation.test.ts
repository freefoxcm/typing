import { pythonDocumentationFor, pythonMemberDocumentationFor } from './pythonDocumentation'

describe('python documentation catalog', () => {
  it('covers common built-ins and beginner container members', () => {
    expect(pythonDocumentationFor('print')?.description).toContain('标准输出')
    expect(pythonMemberDocumentationFor('append', 'list')?.signature).toBe('list.append(object)')
    expect(pythonMemberDocumentationFor('get', 'dict')?.description).toContain('默认值')
    expect(pythonMemberDocumentationFor('split', 'str')?.description).toContain('拆分')
    expect(pythonMemberDocumentationFor('add', 'set')?.description).toContain('加入')
    expect(pythonMemberDocumentationFor('count', 'tuple')?.signature).toBe('tuple.count(value)')
  })

  it('covers explicitly imported beginner standard-library modules', () => {
    expect(pythonMemberDocumentationFor('sqrt', 'math')?.description).toContain('平方根')
    expect(pythonMemberDocumentationFor('randint', 'random')?.description).toContain('[a, b]')
    expect(pythonMemberDocumentationFor('deque', 'collections')?.description).toContain('双端队列')
    expect(pythonMemberDocumentationFor('heappush', 'heapq')?.description).toContain('加入元素')
  })

  it('uses Pyright signatures to distinguish ambiguous pop methods', () => {
    expect(pythonMemberDocumentationFor('pop', undefined, 'pop(index: SupportsIndex = -1)'))
      .toEqual(expect.objectContaining({ signature: 'list.pop(index=-1)' }))
    expect(pythonMemberDocumentationFor('pop', undefined, 'pop(key: str)'))
      .toEqual(expect.objectContaining({ signature: 'dict.pop(key, default=...)' }))
    expect(pythonMemberDocumentationFor('pop', undefined, 'pop()'))
      .toEqual(expect.objectContaining({ signature: 'set.pop()' }))
  })
})
