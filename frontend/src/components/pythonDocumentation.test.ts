import { pythonDocumentationFor, pythonMemberDocumentationFor, pythonMemberDocumentationEntries, snippetDocumentation, TURTLE_RUNTIME_NOTICE } from './pythonDocumentation'

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

  it('covers GESP base conversion, files, exceptions and advanced mathematics', () => {
    expect(pythonDocumentationFor('oct')?.description).toContain('八进制')
    expect(pythonDocumentationFor('hex')?.description).toContain('十六进制')
    expect(pythonDocumentationFor('open')?.description).toContain('打开文件')
    expect(pythonDocumentationFor('FileNotFoundError')?.description).toContain('不存在的文件')
    expect(pythonMemberDocumentationFor('readline', 'file')?.description).toContain('一行')
    expect(pythonMemberDocumentationFor('sin', 'math')?.description).toContain('正弦')
    expect(pythonMemberDocumentationFor('log2', 'math')?.description).toContain('以 2 为底')
    expect(pythonMemberDocumentationFor('comb', 'math')?.description).toContain('组合数')
  })

  it('covers GESP queue, fast I/O and algorithm helpers', () => {
    expect(pythonMemberDocumentationFor('popleft', 'deque')?.description).toContain('最左端')
    expect(pythonMemberDocumentationFor('readline', undefined, 'readline() -> str')?.description).toContain('读取一行')
    expect(pythonMemberDocumentationFor('stdin', 'sys')?.description).toContain('标准输入')
    expect(pythonMemberDocumentationFor('bisect_left', 'bisect')?.description).toContain('最左位置')
    expect(pythonMemberDocumentationFor('permutations', 'itertools')?.description).toContain('排列')
  })

  it('uses Pyright signatures to identify deque and file members', () => {
    expect(pythonMemberDocumentationFor('append', undefined, 'append(x: _T@deque) -> None')?.signature).toBe('deque.append(value)')
    expect(pythonMemberDocumentationFor('read', undefined, 'read(self: TextIOWrapper, size: int = -1) -> str')?.signature).toBe('file.read(size=-1)')
  })

  it('uses Pyright signatures to distinguish ambiguous pop methods', () => {
    expect(pythonMemberDocumentationFor('pop', undefined, 'pop(index: SupportsIndex = -1)'))
      .toEqual(expect.objectContaining({ signature: 'list.pop(index=-1)' }))
    expect(pythonMemberDocumentationFor('pop', undefined, 'pop(key: str)'))
      .toEqual(expect.objectContaining({ signature: 'dict.pop(key, default=...)' }))
    expect(pythonMemberDocumentationFor('pop', undefined, 'pop()'))
      .toEqual(expect.objectContaining({ signature: 'set.pop()' }))
  })

  it('covers GESP-oriented Turtle movement, drawing, screen, aliases, and snippets', () => {
    expect(pythonMemberDocumentationFor('forward', 'turtle')?.description).toContain(TURTLE_RUNTIME_NOTICE)
    expect(pythonMemberDocumentationFor('fd', 'turtle_instance')?.description).toContain('forward() 的简写')
    expect(pythonMemberDocumentationFor('circle', 'turtle')?.parameters).toContain('steps')
    expect(pythonMemberDocumentationFor('begin_fill', 'turtle')?.description).toContain('填充')
    expect(pythonMemberDocumentationFor('tracer', 'turtle_screen')?.description).toContain('刷新频率')
    expect(pythonMemberDocumentationEntries('turtle').length).toBeGreaterThan(50)
    expect(snippetDocumentation.turtle_polygon.description).toContain(TURTLE_RUNTIME_NOTICE)
  })
})
