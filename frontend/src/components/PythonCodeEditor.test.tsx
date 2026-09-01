import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditorState } from '@codemirror/state'
import { PythonCodeEditor, pythonCompletionSource, pythonCursorPosition, pythonDocumentationTooltip, type PythonSyntaxDiagnostic } from './PythonCodeEditor'

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
})
