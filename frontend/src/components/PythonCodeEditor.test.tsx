import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PythonCodeEditor, pythonCompletionSource, type PythonSyntaxDiagnostic } from './PythonCodeEditor'

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
    expect(editor).toHaveAttribute('contenteditable', 'true')
    expect(editor).toHaveTextContent('print(1)')
    fireEvent.blur(editor)
    expect(onBlur).toHaveBeenCalledTimes(1)

    view.rerender(<PythonCodeEditor value="if True" disabled diagnostics={[syntaxError]} onChange={onChange} onBlur={onBlur} />)
    await waitFor(() => expect(editor).toHaveTextContent('if True'))
    expect(editor).toHaveAttribute('contenteditable', 'false')
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(view.container.querySelector('.cm-lint-marker-error')).not.toBeNull())
  })

  it('offers Python snippets, keywords, and common built-ins', () => {
    const result = pythonCompletionSource({
      explicit: false,
      matchBefore: () => ({ from: 0, to: 2, text: 'pr' }),
    } as never)
    expect(result?.options.some((item) => item.label === 'print' && item.type === 'function')).toBe(true)
    expect(result?.options.some((item) => item.label === 'for' && item.detail === '循环代码片段')).toBe(true)
    expect(result?.options.some((item) => item.label === 'return' && item.type === 'keyword')).toBe(true)
  })
})
