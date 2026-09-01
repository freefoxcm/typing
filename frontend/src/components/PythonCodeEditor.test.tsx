import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { acceptCompletion, CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import {
  createCombinedPythonCompletionSource,
  createPyrightCompletionSource,
  inferPythonReceiverKind,
  PythonCodeEditor,
  pythonCompletionSource,
  pythonCursorPosition,
  pythonDocumentationTooltip,
  pythonEditorKeyBindings,
  restrictedDocumentationNode,
  semanticDocumentationNode,
  type PythonSyntaxDiagnostic,
} from './PythonCodeEditor'

const syntaxError: PythonSyntaxDiagnostic = {
  severity: 'error', code: 'SyntaxError', message: '此处缺少冒号（:）', python_message: "expected ':'",
  line: 1, column: 8, end_line: 1, end_column: 9,
}

describe('PythonCodeEditor', () => {
  it('renders a controlled Python editor, updates external values, and supports read-only mode', async () => {
    const onChange = vi.fn()
    const onBlur = vi.fn()
    const view = render(<PythonCodeEditor value="print(1)" disabled={false} diagnostics={[]} onChange={onChange} onBlur={onBlur} />)
    const editor = await screen.findByLabelText('Python 3.13 代码')
    expect(view.container.querySelector('.python-ide-shell')).toHaveAttribute('data-theme', 'soft-dark')
    expect(screen.getByText('main.py')).toBeInTheDocument()
    expect(screen.getByLabelText('编辑器状态')).toHaveTextContent('行 1，列 1')
    expect(screen.getByLabelText('编辑器状态')).toHaveTextContent('空格：4')
    expect(editor).toHaveAttribute('contenteditable', 'true')
    expect(editor).toHaveTextContent('print(1)')
    fireEvent.blur(editor)
    expect(onBlur).toHaveBeenCalledTimes(1)

    view.rerender(<PythonCodeEditor value="if True" disabled diagnostics={[syntaxError]} onChange={onChange} onBlur={onBlur} />)
    await waitFor(() => expect(editor).toHaveTextContent('if True'))
    expect(editor).toHaveAttribute('contenteditable', 'false')
    expect(screen.getByLabelText('编辑器状态')).toHaveTextContent('只读')
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(view.container.querySelector('.cm-lint-marker-error')).not.toBeNull())
  })

  it('offers Python snippets, keywords, and common built-ins', () => {
    const result = pythonCompletionSource({
      explicit: false,
      matchBefore: () => ({ from: 0, to: 2, text: 'pr' }),
    } as never)
    const print = result?.options.find((item) => item.label === 'print')
    expect(print?.type).toBe('function')
    expect(print?.detail).toContain('print(*objects')
    const info = typeof print?.info === 'function' ? print.info(print) : null
    expect(info).toBeInstanceOf(HTMLElement)
    expect((info as HTMLElement).textContent).toContain('把一个或多个对象输出到标准输出')
    expect(result?.options.some((item) => item.label === 'for' && item.detail === '循环代码片段')).toBe(true)
    expect(result?.options.some((item) => item.label === 'return' && item.type === 'keyword')).toBe(true)
  })

  it('provides the same built-in documentation from hover tooltips', () => {
    const state = EditorState.create({ doc: 'value = len(items)' })
    const view = { state } as never
    const tooltip = pythonDocumentationTooltip(view, 10)
    expect(tooltip).not.toBeNull()
    const tooltipView = tooltip?.create(view)
    expect(tooltipView?.dom).toHaveTextContent('len(object)')
    expect(tooltipView?.dom).toHaveTextContent('返回字符串、列表等容器中的元素数量')
    expect(pythonDocumentationTooltip(view, 2)).toBeNull()
  })

  it('calculates the active line and column for the IDE status bar', () => {
    const state = EditorState.create({ doc: 'first\nsecond', selection: { anchor: 9 } })
    expect(pythonCursorPosition(state)).toEqual({ line: 2, column: 4 })
  })

  it('keeps Tab and Shift+Tab inside the editor as four-space indentation', async () => {
    const onChange = vi.fn()
    const view = render(<PythonCodeEditor value="print(1)" disabled={false} diagnostics={[]} onChange={onChange} onBlur={vi.fn()} />)
    const editor = await screen.findByLabelText('Python 3.13 代码')
    editor.focus()
    fireEvent.keyDown(editor, { key: 'Tab', code: 'Tab' })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('    print(1)'))
    expect(editor).toHaveFocus()

    view.rerender(<PythonCodeEditor value="    print(1)" disabled={false} diagnostics={[]} onChange={onChange} onBlur={vi.fn()} />)
    await waitFor(() => expect(editor).toHaveTextContent('print(1)'))
    fireEvent.keyDown(editor, { key: 'Tab', code: 'Tab', shiftKey: true })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('print(1)'))
    expect(editor).toHaveFocus()
  })

  it('binds Enter to accepting the active completion at editor priority', () => {
    expect(pythonEditorKeyBindings.find((binding) => binding.key === 'Enter')?.run).toBe(acceptCompletion)
  })

  it('maps Pyright member completions and resolves documentation lazily', async () => {
    const availability = vi.fn()
    const request = vi.fn()
      .mockResolvedValueOnce({
        available: true,
        items: [{
          id: 'completion-token', label: 'append', type: 'method', detail: 'append(object: T)', documentation: '',
          documentation_format: 'plaintext',
          insert_text: 'append', insert_text_format: 1, filter_text: 'append', sort_text: 'append',
          replace: { start: { line: 1, character: 5 }, end: { line: 1, character: 5 } },
        }],
      })
      .mockResolvedValueOnce({ available: true, detail: 'append(object: T)', documentation: 'Append an item.', documentation_format: 'markdown' })
    const source = createPyrightCompletionSource({
      sessionId: () => 7,
      sessionItemId: () => 72,
      onAvailability: availability,
      request: request as never,
    })
    const state = EditorState.create({ doc: 'vals = []\nvals.' })
    const result = await source(new CompletionContext(state, state.doc.length, false))

    expect(result?.from).toBe(state.doc.length)
    const append = result?.options.find((item) => item.label === 'append')
    expect(append?.type).toBe('method')
    expect(availability).toHaveBeenLastCalledWith('ready')
    expect(JSON.parse(String(request.mock.calls[0][1].body))).toEqual({
      session_item_id: 72,
      code: 'vals = []\nvals.',
      position: { line: 1, character: 5 },
      trigger_character: '.',
    })
    const info = typeof append?.info === 'function' ? await append.info(append) : null
    expect(info).toBeInstanceOf(HTMLElement)
    expect((info as HTMLElement).textContent).toContain('在列表末尾添加一个元素')
    expect((info as HTMLElement).querySelector('details')).not.toHaveAttribute('open')
    expect((info as HTMLElement).textContent).toContain('查看详细类型')
    expect(JSON.parse(String(request.mock.calls[1][1].body))).toEqual({ session_item_id: 72, completion_id: 'completion-token' })
  })

  it('falls back cleanly when semantic completion is unavailable', async () => {
    const availability = vi.fn()
    const source = createPyrightCompletionSource({
      sessionId: () => 7,
      sessionItemId: () => 72,
      onAvailability: availability,
      request: vi.fn().mockResolvedValue({ available: false, items: [] }) as never,
    })
    const state = EditorState.create({ doc: 'items.' })
    expect(await source(new CompletionContext(state, state.doc.length, false))).toBeNull()
    expect(availability).toHaveBeenLastCalledWith('unavailable')
  })

  it('merges Pyright and static completions without duplicating built-ins', async () => {
    const request = vi.fn().mockResolvedValue({
      available: true,
      items: [{
        id: 'min-token', label: 'min', type: 'function', detail: 'def min(...)', documentation: '```python\ndef min(iterable): ...\n```',
        documentation_format: 'markdown', insert_text: 'min', insert_text_format: 1, filter_text: 'min', sort_text: 'min', replace: null,
      }],
    })
    const source = createCombinedPythonCompletionSource({
      sessionId: () => 7, sessionItemId: () => 72, onAvailability: vi.fn(), request: request as never,
    })
    const state = EditorState.create({ doc: 'mi' })
    const result = await source(new CompletionContext(state, 2, false))
    expect(result?.options.filter((item) => item.label === 'min')).toHaveLength(1)
    const min = result?.options.find((item) => item.label === 'min')
    expect(min?.detail).toBe('min(iterable, *, key=None)')
    const info = typeof min?.info === 'function' ? await min.info(min) : null
    const infoNode = info instanceof Node ? info : info?.dom
    expect(infoNode).toHaveTextContent('返回可迭代对象中的最小元素')
    expect(infoNode).toHaveTextContent('def min(iterable): ...')
    expect(infoNode?.textContent).not.toContain('```')
  })

  it('preserves a keyword and its distinct code snippet while deduplicating the keyword itself', async () => {
    const request = vi.fn().mockResolvedValue({
      available: true,
      items: [{
        id: 'for-token', label: 'for', type: 'keyword', detail: 'for', documentation: '', documentation_format: 'plaintext',
        insert_text: 'for', insert_text_format: 1, filter_text: 'for', sort_text: 'for', replace: null,
      }],
    })
    const source = createCombinedPythonCompletionSource({
      sessionId: () => 7, sessionItemId: () => 72, onAvailability: vi.fn(), request: request as never,
    })
    const state = EditorState.create({ doc: 'fo' })
    const result = await source(new CompletionContext(state, 2, false))
    expect(result?.options.filter((item) => item.label === 'for')).toHaveLength(2)
    expect(result?.options.some((item) => item.label === 'for' && item.detail === '循环代码片段')).toBe(true)
  })

  it('returns static completions when Pyright is unavailable', async () => {
    const source = createCombinedPythonCompletionSource({
      sessionId: () => 7, sessionItemId: () => 72, onAvailability: vi.fn(),
      request: vi.fn().mockResolvedValue({ available: false, items: [] }) as never,
    })
    const state = EditorState.create({ doc: 'pri' })
    const result = await source(new CompletionContext(state, 3, false))
    expect(result?.options.some((item) => item.label === 'print')).toBe(true)
  })

  it('renders a safe Markdown subset and keeps hostile content inert', () => {
    const node = restrictedDocumentationNode([
      '**用途**：调用 `print()`。',
      '',
      '- 第一项',
      '- [外链](https://example.test)',
      '',
      '```python',
      'print("ok")',
      '```',
      '<script>alert(1)</script>',
      '![图](https://example.test/x.png)',
    ].join('\n'), 'markdown')
    expect(node.querySelector('strong')).toHaveTextContent('用途')
    expect(node.querySelector('pre code')).toHaveTextContent('print("ok")')
    expect(node.querySelector('a')).toBeNull()
    expect(node.querySelector('img')).toBeNull()
    expect(node.querySelector('script')).toBeNull()
    expect(node.textContent).toContain('<script>alert(1)</script>')
    expect(node.textContent).toContain('[图片：图]')
    expect(node.textContent).not.toContain('```')
  })

  it('labels untranslated documentation as Pyright original text', () => {
    const node = semanticDocumentationNode('custom(value: int)', '*Custom* documentation.', 'markdown')
    expect(node).toHaveTextContent('Pyright 原文')
    expect(node.querySelector('em')).toHaveTextContent('Custom')
  })

  it('infers common receiver and standard-library kinds from beginner code', () => {
    expect(inferPythonReceiverKind('vals = []\nvals.', 15)).toBe('list')
    expect(inferPythonReceiverKind("message = 'hi'\nmessage.", 23)).toBe('str')
    expect(inferPythonReceiverKind('import math as maths\nmaths.', 27)).toBe('math')
    expect(inferPythonReceiverKind('mapping: dict[str, int] = {}\nmapping.', 40)).toBe('dict')
  })
})
