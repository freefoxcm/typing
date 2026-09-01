import { useEffect, useRef, useState } from 'react'
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
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { Compartment, EditorState } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
  type Tooltip,
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

type PythonDocumentation = { signature: string; description: string; parameters?: string }

const builtinDocumentation: Record<string, PythonDocumentation> = {
  abs: { signature: 'abs(x)', description: '返回数字的绝对值。', parameters: 'x：整数、浮点数或实现了绝对值运算的对象。' },
  all: { signature: 'all(iterable)', description: '当可迭代对象中的所有元素都为真时返回 True。', parameters: 'iterable：任意可迭代对象；空对象返回 True。' },
  any: { signature: 'any(iterable)', description: '当可迭代对象中至少有一个元素为真时返回 True。', parameters: 'iterable：任意可迭代对象；空对象返回 False。' },
  bool: { signature: 'bool(object=False)', description: '将对象转换为布尔值 True 或 False。' },
  dict: { signature: 'dict(...)', description: '创建字典，可接收键值对序列或关键字参数。' },
  enumerate: { signature: 'enumerate(iterable, start=0)', description: '遍历元素时同时生成序号。', parameters: 'iterable：被遍历对象；start：起始序号。' },
  filter: { signature: 'filter(function, iterable)', description: '保留使判断函数返回真的元素。', parameters: 'function：判断函数；iterable：输入序列。' },
  float: { signature: 'float(x=0)', description: '将数字或字符串转换为浮点数。' },
  input: { signature: 'input(prompt="")', description: '显示可选提示并读取一行标准输入，返回字符串。', parameters: 'prompt：读取前显示的提示文字。' },
  int: { signature: 'int(x=0, base=10)', description: '将数字或字符串转换为整数。', parameters: 'x：待转换值；base：字符串使用的进制。' },
  len: { signature: 'len(object)', description: '返回字符串、列表等容器中的元素数量。' },
  list: { signature: 'list(iterable=())', description: '创建列表，或将可迭代对象转换为列表。' },
  map: { signature: 'map(function, iterable, ...)', description: '把函数依次应用到可迭代对象的每个元素。' },
  max: { signature: 'max(iterable, *, key=None)', description: '返回可迭代对象中的最大元素。', parameters: 'key：可选的比较键函数。' },
  min: { signature: 'min(iterable, *, key=None)', description: '返回可迭代对象中的最小元素。', parameters: 'key：可选的比较键函数。' },
  open: { signature: 'open(file, mode="r", encoding=None)', description: '打开文件并返回文件对象。', parameters: 'file：路径；mode：打开模式；encoding：文本编码。' },
  pow: { signature: 'pow(base, exp, mod=None)', description: '计算 base 的 exp 次幂；指定 mod 时同时取模。' },
  print: { signature: 'print(*objects, sep=" ", end="\\n")', description: '把一个或多个对象输出到标准输出。', parameters: 'sep：对象间分隔符；end：输出末尾字符。' },
  range: { signature: 'range(start, stop, step=1)', description: '生成整数序列，常用于 for 循环。', parameters: 'stop 不包含在结果中；step 不能为 0。' },
  reversed: { signature: 'reversed(sequence)', description: '返回按相反顺序访问序列的迭代器。' },
  round: { signature: 'round(number, ndigits=None)', description: '将数字舍入到指定的小数位数。' },
  set: { signature: 'set(iterable=())', description: '创建不包含重复元素的集合。' },
  sorted: { signature: 'sorted(iterable, *, key=None, reverse=False)', description: '返回排序后的新列表，不修改原对象。', parameters: 'key：排序键函数；reverse：是否降序。' },
  str: { signature: 'str(object="")', description: '将对象转换为字符串。' },
  sum: { signature: 'sum(iterable, start=0)', description: '从 start 开始累加可迭代对象中的数值。' },
  tuple: { signature: 'tuple(iterable=())', description: '创建元组，或将可迭代对象转换为元组。' },
  zip: { signature: 'zip(*iterables, strict=False)', description: '把多个可迭代对象中相同位置的元素组合成元组。' },
}

const keywordDescriptions: Record<string, string> = {
  and: '逻辑与运算。', as: '为导入对象或异常指定别名。', assert: '断言条件为真，否则抛出异常。', async: '声明异步函数或上下文。', await: '等待异步操作完成。',
  break: '立即结束当前循环。', class: '定义类。', continue: '跳过本轮循环的剩余语句。', del: '删除名称、属性或容器元素。', elif: '为 if 增加条件分支。', else: '定义条件不满足时的分支。', except: '捕获并处理异常。',
  False: '布尔假值。', finally: '定义无论是否异常都会执行的代码。', from: '从模块中导入指定名称。', global: '声明名称来自全局作用域。', if: '根据条件执行分支。', import: '导入模块或名称。', in: '检查成员关系或用于遍历。', is: '比较两个引用是否指向同一对象。',
  lambda: '创建匿名函数。', None: '表示没有值的单例对象。', nonlocal: '声明名称来自外层非全局作用域。', not: '逻辑非运算。', or: '逻辑或运算。', pass: '空语句，占位但不执行操作。', raise: '主动抛出异常。', return: '结束函数并返回结果。', True: '布尔真值。', try: '开始异常处理代码块。', while: '条件为真时重复执行。', with: '使用上下文管理器安全管理资源。', yield: '从生成器产出一个值并暂停执行。',
}

const snippetDocumentation: Record<string, PythonDocumentation> = {
  if: { signature: 'if condition:', description: '插入条件判断代码块。' },
  for: { signature: 'for item in range(count):', description: '插入按次数遍历的 for 循环。' },
  while: { signature: 'while condition:', description: '插入条件循环代码块。' },
  def: { signature: 'def name(arguments):', description: '插入函数定义代码块。' },
}

function documentationNode(documentation: PythonDocumentation): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'python-documentation'
  const signature = document.createElement('code')
  signature.textContent = documentation.signature
  const description = document.createElement('p')
  description.textContent = documentation.description
  wrapper.append(signature, description)
  if (documentation.parameters) {
    const parameters = document.createElement('small')
    parameters.textContent = documentation.parameters
    wrapper.append(parameters)
  }
  return wrapper
}

function documentedCompletion(documentation: PythonDocumentation) {
  return () => documentationNode(documentation)
}

const snippets: Completion[] = [
  snippetCompletion('if ${condition}:\n\t${pass}', { label: 'if', detail: '条件判断代码片段', info: documentedCompletion(snippetDocumentation.if), type: 'keyword', boost: 100 }),
  snippetCompletion('for ${item} in range(${count}):\n\t${pass}', { label: 'for', detail: '循环代码片段', info: documentedCompletion(snippetDocumentation.for), type: 'keyword', boost: 100 }),
  snippetCompletion('while ${condition}:\n\t${pass}', { label: 'while', detail: '循环代码片段', info: documentedCompletion(snippetDocumentation.while), type: 'keyword', boost: 100 }),
  snippetCompletion('def ${name}(${arguments}):\n\t${pass}', { label: 'def', detail: '函数代码片段', info: documentedCompletion(snippetDocumentation.def), type: 'keyword', boost: 100 }),
]

const keywordCompletions: Completion[] = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'del', 'elif', 'else', 'except', 'False',
  'finally', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'True', 'try', 'while', 'with', 'yield',
].map((label) => ({ label, type: 'keyword', detail: 'Python 关键字', info: documentedCompletion({ signature: label, description: keywordDescriptions[label] }) }))

const builtinCompletions: Completion[] = [
  'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'filter', 'float', 'input', 'int', 'len', 'list', 'map',
  'max', 'min', 'open', 'pow', 'print', 'range', 'reversed', 'round', 'set', 'sorted', 'str', 'sum', 'tuple', 'zip',
].map((label) => ({ label, type: 'function', detail: builtinDocumentation[label].signature, info: documentedCompletion(builtinDocumentation[label]) }))

export function pythonCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_]\w*/)
  if (!word || word.from === word.to && !context.explicit) return null
  return { from: word.from, options: [...snippets, ...keywordCompletions, ...builtinCompletions], validFor: /^[A-Za-z_]\w*$/ }
}

const editorTheme = EditorView.theme({
  '&': {
    minHeight: '360px',
    backgroundColor: '#282c34',
    color: '#abb2bf',
    fontSize: '.9rem',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: "'DM Mono', monospace", overflow: 'auto' },
  '.cm-content': { minHeight: '360px', padding: '12px 0', caretColor: '#528bff' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { backgroundColor: '#21252b', color: '#7f848e', border: '0' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#2f343d' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#3e4451' },
  '.cm-tooltip': { color: '#abb2bf', backgroundColor: '#21252b', border: '1px solid #3c414c' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { color: '#fff', backgroundColor: '#3e4451' },
  '.cm-completionDetail': { color: '#7f848e' },
  '.cm-diagnostic-error': { borderLeftColor: '#e06c75' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #e06c75', textDecorationSkipInk: 'none' },
}, { dark: true })

const softDarkHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: '#c678dd' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: '#98c379' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.labelName], color: '#61afef' },
  { tag: [tags.number, tags.bool, tags.null], color: '#d19a66' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: '#56b6c2' },
  { tag: [tags.typeName, tags.className], color: '#e5c07b' },
  { tag: tags.comment, color: '#7f848e', fontStyle: 'italic' },
  { tag: [tags.variableName, tags.propertyName], color: '#abb2bf' },
])

function documentationAt(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos)
  const before = state.sliceDoc(line.from, pos)
  const after = state.sliceDoc(pos, line.to)
  const left = before.match(/[A-Za-z_]\w*$/)?.[0] ?? ''
  const right = after.match(/^\w*/)?.[0] ?? ''
  const word = left + right
  const documentation = builtinDocumentation[word]
  if (!documentation) return null
  return { from: pos - left.length, to: pos + right.length, documentation }
}

export function pythonDocumentationTooltip(view: EditorView, pos: number): Tooltip | null {
  const match = documentationAt(view.state, pos)
  if (!match) return null
  return {
    pos: match.from,
    end: match.to,
    above: true,
    create: () => ({ dom: documentationNode(match.documentation) }),
  }
}

function documentPosition(state: EditorState, line: number, column: number): number {
  const safeLine = Math.max(1, Math.min(state.doc.lines, line || 1))
  const lineInfo = state.doc.line(safeLine)
  return lineInfo.from + Math.max(0, Math.min(lineInfo.length, (column || 1) - 1))
}

export function pythonCursorPosition(state: EditorState) {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  return { line: line.number, column: head - line.from + 1 }
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
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
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
        hoverTooltip(pythonDocumentationTooltip, { hoverTime: 250, hideOnChange: true }),
        python(),
        syntaxHighlighting(softDarkHighlightStyle, { fallback: true }),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        editable.of([EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)]),
        EditorView.contentAttributes.of({ 'aria-label': 'Python 3.13 代码', spellcheck: 'false', autocapitalize: 'off' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) onChangeRef.current(update.state.doc.toString())
          if (update.selectionSet || update.docChanged) setCursorPosition(pythonCursorPosition(update.state))
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

  return <div className="python-ide-shell" data-theme="soft-dark">
    <header className="python-ide-tabbar"><div className="python-file-tab"><span className="python-file-icon" aria-hidden="true">Py</span><span>main.py</span></div><span className="python-ide-runtime">Python 3.13</span></header>
    <div ref={hostRef} className="python-code-editor" />
    <footer className="python-ide-statusbar" aria-label="编辑器状态"><span>行 {cursorPosition.line}，列 {cursorPosition.column}</span><span className="python-status-secondary">空格：4</span><span className="python-status-secondary">UTF-8</span>{disabled && <span>只读</span>}<span>Python 3.13</span></footer>
  </div>
}
