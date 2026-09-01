import { useEffect, useRef } from 'react'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { Compartment, EditorState } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'

export type PythonSyntaxDiagnostic = {
  severity: 'error'
  code: 'SyntaxError' | 'IndentationError' | 'TabError'
  message: string
  python_message: string
  line: number
  column: number
  end_line: number
  end_column: number
}

const snippets: Completion[] = [
  snippetCompletion('if ${condition}:\n\t${pass}', { label: 'if', detail: '条件判断代码片段', type: 'keyword', boost: 100 }),
  snippetCompletion('for ${item} in range(${count}):\n\t${pass}', { label: 'for', detail: '循环代码片段', type: 'keyword', boost: 100 }),
  snippetCompletion('while ${condition}:\n\t${pass}', { label: 'while', detail: '循环代码片段', type: 'keyword', boost: 100 }),
  snippetCompletion('def ${name}(${arguments}):\n\t${pass}', { label: 'def', detail: '函数代码片段', type: 'keyword', boost: 100 }),
]

const keywordCompletions: Completion[] = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'del', 'elif', 'else', 'except', 'False',
  'finally', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'True', 'try', 'while', 'with', 'yield',
].map((label) => ({ label, type: 'keyword' }))

const builtinCompletions: Completion[] = [
  'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'filter', 'float', 'input', 'int', 'len', 'list', 'map',
  'max', 'min', 'open', 'pow', 'print', 'range', 'reversed', 'round', 'set', 'sorted', 'str', 'sum', 'tuple', 'zip',
].map((label) => ({ label, type: 'function', detail: 'Python 内置函数' }))

export function pythonCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_]\w*/)
  if (!word || word.from === word.to && !context.explicit) return null
  return { from: word.from, options: [...snippets, ...keywordCompletions, ...builtinCompletions], validFor: /^[A-Za-z_]\w*$/ }
}

const editorTheme = EditorView.theme({
  '&': {
    minHeight: '360px',
    borderRadius: '10px',
    backgroundColor: '#102f49',
    color: '#eef7f9',
    fontSize: '.9rem',
  },
  '&.cm-focused': { outline: '2px solid #43ac9f', outlineOffset: '2px' },
  '.cm-scroller': { fontFamily: "'DM Mono', monospace", overflow: 'auto' },
  '.cm-content': { minHeight: '360px', padding: '12px 0', caretColor: '#fff4a8' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { backgroundColor: '#0b263b', color: '#7895a8', border: '0' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,.06)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(90,190,210,.3)' },
  '.cm-tooltip': { color: '#17344a', backgroundColor: '#fffdf7', border: '1px solid #cad8dc' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { color: '#fff', backgroundColor: '#2f718f' },
  '.cm-diagnostic-error': { borderLeftColor: '#f05b47' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #ff7563', textDecorationSkipInk: 'none' },
}, { dark: true })

function documentPosition(state: EditorState, line: number, column: number): number {
  const safeLine = Math.max(1, Math.min(state.doc.lines, line || 1))
  const lineInfo = state.doc.line(safeLine)
  return lineInfo.from + Math.max(0, Math.min(lineInfo.length, (column || 1) - 1))
}

function editorDiagnostics(state: EditorState, diagnostics: PythonSyntaxDiagnostic[]): Diagnostic[] {
  return diagnostics.map((item) => {
    const from = documentPosition(state, item.line, item.column)
    const to = Math.max(from, documentPosition(state, item.end_line, item.end_column))
    return {
      from,
      to,
      severity: 'error',
      message: `${item.message}\nPython: ${item.python_message}`,
      source: item.code,
    }
  })
}

export function PythonCodeEditor({ value, disabled, diagnostics, onChange, onBlur }: {
  value: string
  disabled: boolean
  diagnostics: PythonSyntaxDiagnostic[]
  onChange: (value: string) => void
  onBlur: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const syncingRef = useRef(false)
  const editableCompartmentRef = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  onChangeRef.current = onChange
  onBlurRef.current = onBlur

  useEffect(() => {
    if (!hostRef.current) return
    const editable = editableCompartmentRef.current
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        lintGutter(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ override: [pythonCompletionSource], activateOnTyping: true }),
        python(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        editable.of([EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)]),
        EditorView.contentAttributes.of({ 'aria-label': 'Python 3.13 代码', spellcheck: 'false', autocapitalize: 'off' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) onChangeRef.current(update.state.doc.toString())
        }),
        EditorView.domEventHandlers({ blur: () => { onBlurRef.current(); return false } }),
        editorTheme,
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    syncingRef.current = true
    const selection = view.state.selection.main
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: Math.min(selection.anchor, value.length), head: Math.min(selection.head, value.length) },
    })
    syncingRef.current = false
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: editableCompartmentRef.current.reconfigure([EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)]) })
  }, [disabled])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch(setDiagnostics(view.state, editorDiagnostics(view.state, diagnostics)))
  }, [diagnostics])

  return <div ref={hostRef} className="python-code-editor" />
}
