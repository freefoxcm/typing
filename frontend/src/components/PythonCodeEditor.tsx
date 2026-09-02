import { useEffect, useRef, useState, type FocusEvent } from 'react'
import { Braces, LoaderCircle, Play, Search, Sparkles } from 'lucide-react'
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippet,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { Compartment, EditorState, Prec } from '@codemirror/state'
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
  type KeyBinding,
  type Tooltip,
} from '@codemirror/view'
import { api, jsonBody } from '../api'
import {
  builtinDocumentation,
  builtinLabels,
  keywordDescriptions,
  keywordLabels,
  pythonDocumentationFor,
  pythonMemberDocumentationEntries,
  pythonMemberDocumentationFor,
  snippetDocumentation,
  type PythonDocumentation,
  type PythonReceiverKind,
} from './pythonDocumentation'

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

type PyrightCompletionItem = {
  id: string
  label: string
  type: string
  detail: string
  documentation: string
  documentation_format: DocumentationFormat
  insert_text: string
  insert_text_format: number
  filter_text: string
  sort_text: string
  replace?: { start: { line: number; character: number }; end: { line: number; character: number } } | null
}

type PyrightCompletionResponse = { available: boolean; items: PyrightCompletionItem[] }
type DocumentationFormat = 'markdown' | 'plaintext'
type PyrightResolveResponse = { available: boolean; detail: string; documentation: string; documentation_format: DocumentationFormat }
type CompletionAvailability = 'ready' | 'checking' | 'unavailable'
type ApiRequester = <T>(path: string, init?: RequestInit) => Promise<T>
type PythonCompletion = Completion & { pythonInsertText?: string }

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
  if (documentation.returns) {
    const returns = document.createElement('small')
    returns.textContent = `返回：${documentation.returns}`
    wrapper.append(returns)
  }
  return wrapper
}

export type PythonFormatStatus = 'idle' | 'formatting' | 'formatted' | 'unchanged' | 'error'
export type PythonSyntaxStatus = 'idle' | 'checking' | 'valid' | 'invalid' | 'unavailable'

function documentedCompletion(documentation: PythonDocumentation) {
  return () => documentationNode(documentation)
}

const snippets: Completion[] = [
  snippetCompletion('if ${condition}:\n\t${pass}', { label: 'if', detail: '条件判断代码片段', info: documentedCompletion(snippetDocumentation.if), type: 'keyword', boost: 100 }),
  snippetCompletion('for ${item} in range(${count}):\n\t${pass}', { label: 'for', detail: '循环代码片段', info: documentedCompletion(snippetDocumentation.for), type: 'keyword', boost: 100 }),
  snippetCompletion('while ${condition}:\n\t${pass}', { label: 'while', detail: '循环代码片段', info: documentedCompletion(snippetDocumentation.while), type: 'keyword', boost: 100 }),
  snippetCompletion('def ${name}(${arguments}):\n\t${pass}', { label: 'def', detail: '函数代码片段', info: documentedCompletion(snippetDocumentation.def), type: 'keyword', boost: 100 }),
  snippetCompletion('import turtle\n\nturtle.${done}()', { label: 'turtle import', detail: 'Turtle 导入代码片段', info: documentedCompletion(snippetDocumentation.turtle_import), type: 'module', boost: 92 }),
  snippetCompletion('for _ in range(${sides}):\n\tturtle.forward(${length})\n\tturtle.left(360 / ${sides})', { label: 'turtle polygon', detail: 'Turtle 正多边形代码片段', info: documentedCompletion(snippetDocumentation.turtle_polygon), type: 'keyword', boost: 96 }),
  snippetCompletion('for _ in range(${count}):\n\tturtle.forward(${length})\n\tturtle.right(${angle})', { label: 'turtle loop', detail: 'Turtle 循环绘图代码片段', info: documentedCompletion(snippetDocumentation.turtle_loop), type: 'keyword', boost: 94 }),
  snippetCompletion('turtle.fillcolor("${color}")\nturtle.begin_fill()\n${draw}\nturtle.end_fill()', { label: 'turtle fill', detail: 'Turtle 填充图形代码片段', info: documentedCompletion(snippetDocumentation.turtle_fill), type: 'keyword', boost: 93 }),
  snippetCompletion('pen = turtle.Turtle()\npen.${done}()', { label: 'turtle pen', detail: 'Turtle 独立画笔代码片段', info: documentedCompletion(snippetDocumentation.turtle_pen), type: 'class', boost: 91 }),
]

const keywordCompletions: Completion[] = keywordLabels
  .map((label) => ({ label, type: 'keyword', detail: 'Python 关键字', info: documentedCompletion({ signature: label, description: keywordDescriptions[label] }) }))

const builtinCompletions: Completion[] = builtinLabels
  .map((label) => ({ label, type: 'function', detail: builtinDocumentation[label].signature, info: documentedCompletion(builtinDocumentation[label]) }))

const gespTurtlePriority = new Set(['forward', 'fd', 'backward', 'bk', 'right', 'rt', 'left', 'lt', 'goto', 'circle', 'speed', 'penup', 'pu', 'pendown', 'pd', 'pencolor', 'fillcolor', 'color', 'begin_fill', 'end_fill'])

function memberStaticCompletions(receiverKind: PythonReceiverKind): Completion[] {
  return pythonMemberDocumentationEntries(receiverKind).map(([label, documentation]) => ({
    label,
    type: /^[A-Z]/.test(label) ? 'class' : 'function',
    detail: documentation.signature,
    info: documentedCompletion(documentation),
    boost: gespTurtlePriority.has(label) ? 120 : 70,
  }))
}

export function pythonCompletionSource(context: CompletionContext): CompletionResult | null {
  const state = context.state
  const code = state?.doc.toString() ?? ''
  const linePrefix = state ? state.sliceDoc(state.doc.lineAt(context.pos).from, context.pos) : ''
  if (state && /[A-Za-z_]\w*\.[A-Za-z_]*$/.test(linePrefix)) {
    const receiverKind = inferPythonReceiverKind(code, context.pos)
    if (!receiverKind) return null
    const member = context.matchBefore(/[A-Za-z_]*$/)
    return { from: member?.from ?? context.pos, options: memberStaticCompletions(receiverKind), validFor: /^[A-Za-z_]\w*$/ }
  }
  const word = context.matchBefore(/[A-Za-z_]\w*/)
  if (!word || word.from === word.to && !context.explicit) return null
  if (word.from > 0 && context.state?.sliceDoc(word.from - 1, word.from) === '.') return null
  const turtleGlobals = /(?:^|[;\n])\s*from\s+turtle\s+import\s+\*/m.test(code) ? memberStaticCompletions('turtle') : []
  return { from: word.from, options: [...snippets, ...keywordCompletions, ...builtinCompletions, ...turtleGlobals], validFor: /^[A-Za-z_]\w*$/ }
}

function appendRestrictedInline(parent: HTMLElement, value: string) {
  const pattern = /!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\([^)]*\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let offset = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > offset) parent.append(document.createTextNode(value.slice(offset, index)))
    if (match[1] !== undefined) parent.append(document.createTextNode(`[图片：${match[1] || '未命名'}]`))
    else if (match[2] !== undefined) parent.append(document.createTextNode(match[2]))
    else {
      const element = document.createElement(match[3] !== undefined ? 'code' : match[4] !== undefined ? 'strong' : 'em')
      element.textContent = match[3] ?? match[4] ?? match[5] ?? ''
      parent.append(element)
    }
    offset = index + match[0].length
  }
  if (offset < value.length) parent.append(document.createTextNode(value.slice(offset)))
}

function isMarkdownBlockStart(line: string) {
  return /^\s*```/.test(line) || /^\s*(?:[-*]\s+|\d+\.\s+|>\s?|#{1,6}\s+)/.test(line)
}

export function restrictedDocumentationNode(value: string, format: DocumentationFormat): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'python-markdown'
  if (!value) return wrapper
  if (format === 'plaintext') {
    const paragraph = document.createElement('p')
    paragraph.className = 'python-plaintext'
    paragraph.textContent = value
    wrapper.append(paragraph)
    return wrapper
  }
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }
    const fence = line.match(/^\s*```([^`]*)$/)
    if (fence) {
      index += 1
      const codeLines: string[] = []
      while (index < lines.length && !/^\s*```/.test(lines[index])) codeLines.push(lines[index++])
      if (index < lines.length) index += 1
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      if (fence[1].trim()) code.dataset.language = fence[1].trim()
      code.textContent = codeLines.join('\n')
      pre.append(code)
      wrapper.append(pre)
      continue
    }
    const list = line.match(/^\s*([-*]|\d+\.)\s+(.+)$/)
    if (list) {
      const ordered = /\d+\./.test(list[1])
      const container = document.createElement(ordered ? 'ol' : 'ul')
      while (index < lines.length) {
        const item = lines[index].match(/^\s*([-*]|\d+\.)\s+(.+)$/)
        if (!item || /\d+\./.test(item[1]) !== ordered) break
        const li = document.createElement('li')
        appendRestrictedInline(li, item[2])
        container.append(li)
        index += 1
      }
      wrapper.append(container)
      continue
    }
    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      const blockquote = document.createElement('blockquote')
      appendRestrictedInline(blockquote, quote[1])
      wrapper.append(blockquote)
      index += 1
      continue
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/)
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`)
      appendRestrictedInline(element, heading[2])
      wrapper.append(element)
      index += 1
      continue
    }
    const paragraphLines = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) paragraphLines.push(lines[index++])
    const paragraph = document.createElement('p')
    paragraphLines.forEach((part, partIndex) => {
      appendRestrictedInline(paragraph, part)
      if (partIndex < paragraphLines.length - 1) paragraph.append(document.createElement('br'))
    })
    wrapper.append(paragraph)
  }
  return wrapper
}

function pyrightOriginalNode(detail: string, documentation: string, format: DocumentationFormat): HTMLElement {
  const original = document.createElement('div')
  original.className = 'python-original-documentation'
  if (detail) {
    const signature = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = detail
    signature.append(code)
    original.append(signature)
  }
  if (documentation) original.append(restrictedDocumentationNode(documentation, format))
  if (!detail && !documentation) {
    const empty = document.createElement('p')
    empty.textContent = 'Pyright 未提供更多说明。'
    original.append(empty)
  }
  return original
}

export function semanticDocumentationNode(
  detail: string,
  documentation: string,
  format: DocumentationFormat,
  localized?: PythonDocumentation,
): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = `python-documentation semantic ${localized ? 'localized' : 'original'}`
  if (localized) {
    const localizedNode = documentationNode(localized)
    while (localizedNode.firstChild) wrapper.append(localizedNode.firstChild)
    if (detail || documentation) {
      const details = document.createElement('details')
      details.className = 'python-type-details'
      const summary = document.createElement('summary')
      summary.textContent = '查看详细类型'
      details.append(summary, pyrightOriginalNode(detail, documentation, format))
      wrapper.append(details)
    }
    return wrapper
  }
  const badge = document.createElement('span')
  badge.className = 'python-original-badge'
  badge.textContent = 'Pyright 原文'
  wrapper.append(badge, pyrightOriginalNode(detail, documentation, format))
  return wrapper
}

function documentPosition(state: EditorState, position: { line: number; character: number }): number | null {
  if (position.line < 0 || position.line >= state.doc.lines) return null
  const line = state.doc.line(position.line + 1)
  return line.from + Math.max(0, Math.min(line.length, position.character))
}

export function inferPythonReceiverKind(code: string, position: number): PythonReceiverKind | undefined {
  const prefix = code.slice(0, position)
  const receiver = prefix.match(/([A-Za-z_]\w*)\.[A-Za-z_]*$/)?.[1]
  if (!receiver) return undefined
  if (['math', 'random', 'sys', 'collections', 'heapq', 'bisect', 'itertools', 'turtle'].includes(receiver)) return receiver as PythonReceiverKind
  const escaped = receiver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const annotation = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:\\s*(list|dict|str|set|tuple)\\b`, 'g')
  const annotated = [...code.matchAll(annotation)].at(-1)?.[1]
  if (annotated) return annotated as PythonReceiverKind
  const assignment = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*=\\s*([^\\n#]+)`, 'g')
  const value = [...code.matchAll(assignment)].at(-1)?.[1]?.trim() ?? ''
  if (/^(?:\[|list\s*\()/.test(value)) return 'list'
  if (/^(?:\{|dict\s*\()/.test(value)) return 'dict'
  if (/^(?:[rubf]*['"]|str\s*\()/.test(value)) return 'str'
  if (/^set\s*\(/.test(value)) return 'set'
  if (/^tuple\s*\(/.test(value) || /^\([^)]*,[^)]*\)/.test(value)) return 'tuple'
  const turtleImport = [...prefix.matchAll(/(?:^|[;\n])\s*import\s+turtle(?:\s+as\s+([A-Za-z_]\w*))?/g)].at(-1)
  const turtleAlias = turtleImport?.[1] || (turtleImport ? 'turtle' : undefined)
  if (turtleAlias) {
    const constructor = new RegExp(`(?:^|[;\\n])\\s*${escaped}\\s*=\\s*${turtleAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(Turtle|Screen)\\s*\\(`, 'g')
    const kind = [...prefix.matchAll(constructor)].at(-1)?.[1]
    if (kind === 'Turtle') return 'turtle_instance'
    if (kind === 'Screen') return 'turtle_screen'
    if (receiver === turtleAlias) return 'turtle'
  }
  const importedConstructor = new RegExp(`(?:^|[;\\n])\\s*${escaped}\\s*=\\s*(Turtle|Screen)\\s*\\(`, 'g')
  const importedKind = [...prefix.matchAll(importedConstructor)].at(-1)?.[1]
  if (/(?:^|[;\n])\s*from\s+turtle\s+import\s+(?:\*|[^\n;]*(?:Turtle|Screen))/m.test(prefix)) {
    if (importedKind === 'Turtle') return 'turtle_instance'
    if (importedKind === 'Screen') return 'turtle_screen'
  }
  const importAlias = new RegExp(`(?:^|\\n)\\s*import\\s+(math|random|sys|collections|heapq|bisect|itertools)\\s+as\\s+${escaped}\\b`, 'g')
  return [...prefix.matchAll(importAlias)].at(-1)?.[1] as PythonReceiverKind | undefined
}

export function createPyrightCompletionSource({
  sessionId,
  sessionItemId,
  onAvailability,
  enabled = () => true,
  request = api as ApiRequester,
}: {
  sessionId: () => number | undefined
  sessionItemId: () => number | undefined
  onAvailability: (state: CompletionAvailability) => void
  enabled?: () => boolean
  request?: ApiRequester
}) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (!enabled()) return null
    const currentSessionId = sessionId()
    const currentItemId = sessionItemId()
    if (!currentSessionId || !currentItemId) return null
    const word = context.matchBefore(/[A-Za-z_]\w*/)
    const previousCharacter = context.pos > 0 ? context.state.sliceDoc(context.pos - 1, context.pos) : ''
    const triggerCharacter = previousCharacter === '.' ? '.' : undefined
    const memberContext = /[A-Za-z_]\w*\.[A-Za-z_]*$/.test(context.state.sliceDoc(context.state.doc.lineAt(context.pos).from, context.pos))
    if (!context.explicit && !triggerCharacter && (!word || word.from === word.to)) return null

    const abortController = new AbortController()
    context.addEventListener('abort', () => abortController.abort())
    if (!context.explicit && !triggerCharacter) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 120)
        context.addEventListener('abort', () => { window.clearTimeout(timer); resolve() })
      })
    }
    if (context.aborted || !enabled()) return null

    const line = context.state.doc.lineAt(context.pos)
    const code = context.state.doc.toString()
    const receiverKind = memberContext ? inferPythonReceiverKind(code, context.pos) : undefined
    const localizedFor = (label: string, detail: string) => memberContext
      ? pythonMemberDocumentationFor(label, receiverKind, detail)
      : pythonDocumentationFor(label, undefined, detail)
        ?? (/(?:^|[;\n])\s*from\s+turtle\s+import\s+\*/m.test(code) ? pythonMemberDocumentationFor(label, 'turtle', detail) : undefined)
        ?? (keywordDescriptions[label]
        ? { signature: label, description: keywordDescriptions[label] }
        : undefined)
    onAvailability('checking')
    try {
      const response = await request<PyrightCompletionResponse>(`/api/exercises/sessions/${currentSessionId}/python-completions`, {
        method: 'POST',
        signal: abortController.signal,
        ...jsonBody({
          session_item_id: currentItemId,
          code,
          position: { line: line.number - 1, character: context.pos - line.from },
          trigger_character: triggerCharacter,
        }),
      })
      if (context.aborted || !enabled()) return null
      onAvailability(response.available ? 'ready' : 'unavailable')
      if (!response.available || !response.items.length) return null
      const replacementFrom = documentPosition(context.state, response.items[0].replace?.start ?? { line: line.number - 1, character: (word?.from ?? context.pos) - line.from })
      const from = replacementFrom == null || replacementFrom > context.pos ? word?.from ?? context.pos : replacementFrom
      const options: PythonCompletion[] = response.items.map((item) => {
        const apply = item.insert_text_format === 2 ? snippet(item.insert_text) : item.insert_text
        const localized = localizedFor(item.label, item.detail)
        return {
          label: item.label,
          type: item.type,
          detail: localized?.signature || item.detail,
          filterText: item.filter_text,
          sortText: item.sort_text,
          apply,
          pythonInsertText: item.insert_text,
          info: async () => {
            if (item.documentation) return semanticDocumentationNode(
              item.detail,
              item.documentation,
              item.documentation_format || 'plaintext',
              localizedFor(item.label, item.detail),
            )
            try {
              const resolved = await request<PyrightResolveResponse>(`/api/exercises/sessions/${currentSessionId}/python-completions/resolve`, {
                method: 'POST',
                ...jsonBody({ session_item_id: currentItemId, completion_id: item.id }),
              })
              const resolvedDetail = resolved.detail || item.detail
              return semanticDocumentationNode(
                resolvedDetail,
                resolved.documentation,
                resolved.documentation_format || 'plaintext',
                localizedFor(item.label, resolvedDetail),
              )
            } catch {
              return semanticDocumentationNode(item.detail, '', 'plaintext', localized)
            }
          },
        }
      })
      return { from, options, validFor: /^[A-Za-z_]\w*$/ }
    } catch (error) {
      if (!abortController.signal.aborted) onAvailability('unavailable')
      return null
    }
  }
}

export function createCombinedPythonCompletionSource(options: Parameters<typeof createPyrightCompletionSource>[0]) {
  const pyrightSource = createPyrightCompletionSource(options)
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (options.enabled && !options.enabled()) return null
    const staticResult = pythonCompletionSource(context)
    const semanticResult = await pyrightSource(context)
    if (!semanticResult) return staticResult
    if (!staticResult) return semanticResult
    const semanticKeys = new Set(semanticResult.options.map((item) => {
      const semantic = item as PythonCompletion
      return `${item.label}\u0000${semantic.pythonInsertText || item.label}`
    }))
    const remainingStatic = staticResult.options.filter((item) =>
      String(item.detail || '').includes('代码片段') || !semanticKeys.has(`${item.label}\u0000${item.label}`),
    )
    return {
      from: semanticResult.from,
      options: [...semanticResult.options, ...remainingStatic],
      validFor: semanticResult.validFor || staticResult.validFor,
    }
  }
}

export const pythonEditorKeyBindings: readonly KeyBinding[] = [
  { key: 'Tab', run: indentMore, shift: indentLess },
  { key: 'Enter', run: acceptCompletion },
]
export const PYTHON_SYNTAX_CHECK_SHORTCUT = 'Mod-Shift-Enter'
export const pythonEditorKeymap = Prec.highest(keymap.of(pythonEditorKeyBindings))

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
  '.cm-activeLine': { backgroundColor: 'rgba(75,82,97,.22)' },
  '.cm-activeLineGutter': { backgroundColor: '#2f343d' },
  '& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { background: '#315f91 !important' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { background: '#3b73ad !important' },
  '.cm-content ::selection': { backgroundColor: 'rgba(82,139,255,.62) !important' },
  '.cm-tooltip': { color: '#abb2bf', backgroundColor: '#21252b', border: '1px solid #3c414c' },
  '.cm-tooltip.cm-completionInfo': { maxWidth: 'min(480px, calc(100vw - 32px))', overflow: 'visible' },
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
  const receiverKind = before.slice(0, Math.max(0, before.length - left.length)).endsWith('.')
    ? inferPythonReceiverKind(state.doc.toString(), pos)
    : undefined
  const documentation = receiverKind
    ? pythonMemberDocumentationFor(word, receiverKind)
    : builtinDocumentation[word]
      ?? (/(?:^|[;\n])\s*from\s+turtle\s+import\s+\*/m.test(state.doc.toString()) ? pythonMemberDocumentationFor(word, 'turtle') : undefined)
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

function diagnosticPosition(state: EditorState, line: number, column: number): number {
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
    const from = diagnosticPosition(state, item.line, item.column)
    const to = Math.max(from, diagnosticPosition(state, item.end_line, item.end_column))
    return {
      from,
      to,
      severity: 'error',
      message: `${item.message}\nPython: ${item.python_message}`,
      source: item.code,
    }
  })
}

export function PythonCodeEditor({
  value,
  disabled,
  diagnostics,
  sessionId,
  sessionItemId,
  onChange,
  onBlur,
  onRun,
  runDisabled = false,
  runDisabledReason,
  runLabel = '运行样例',
  runLoading = false,
  autoCompletionEnabled = true,
  onAutoCompletionChange,
  autoSyntaxEnabled = true,
  onAutoSyntaxChange,
  onSyntaxCheck,
  syntaxCheckDisabled = false,
  syntaxStatus = 'idle',
  autoFormatEnabled = false,
  onAutoFormatChange,
  onFormat,
  formatDisabled = false,
  formatStatus = 'idle',
}: {
  value: string
  disabled: boolean
  diagnostics: PythonSyntaxDiagnostic[]
  sessionId?: number
  sessionItemId?: number
  onChange: (value: string) => void
  onBlur: (value: string) => void
  onRun?: () => void
  runDisabled?: boolean
  runDisabledReason?: string
  runLabel?: string
  runLoading?: boolean
  autoCompletionEnabled?: boolean
  onAutoCompletionChange?: (enabled: boolean) => void
  autoSyntaxEnabled?: boolean
  onAutoSyntaxChange?: (enabled: boolean) => void
  onSyntaxCheck?: () => void
  syntaxCheckDisabled?: boolean
  syntaxStatus?: PythonSyntaxStatus
  autoFormatEnabled?: boolean
  onAutoFormatChange?: (enabled: boolean) => void
  onFormat?: () => void
  formatDisabled?: boolean
  formatStatus?: PythonFormatStatus
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const [completionAvailability, setCompletionAvailability] = useState<CompletionAvailability>('ready')
  const syncingRef = useRef(false)
  const editableCompartmentRef = useRef(new Compartment())
  const completionCompartmentRef = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const onFormatRef = useRef(onFormat)
  const onSyntaxCheckRef = useRef(onSyntaxCheck)
  const syntaxCheckDisabledRef = useRef(syntaxCheckDisabled)
  const syntaxStatusRef = useRef(syntaxStatus)
  const sessionIdRef = useRef(sessionId)
  const sessionItemIdRef = useRef(sessionItemId)
  const autoCompletionEnabledRef = useRef(autoCompletionEnabled)
  onChangeRef.current = onChange
  onBlurRef.current = onBlur
  onFormatRef.current = onFormat
  onSyntaxCheckRef.current = onSyntaxCheck
  syntaxCheckDisabledRef.current = syntaxCheckDisabled
  syntaxStatusRef.current = syntaxStatus
  sessionIdRef.current = sessionId
  sessionItemIdRef.current = sessionItemId
  autoCompletionEnabledRef.current = autoCompletionEnabled

  useEffect(() => {
    if (!hostRef.current) return
    const editable = editableCompartmentRef.current
    const completion = completionCompartmentRef.current
    const completionExtension = () => autocompletion({ override: [
      createCombinedPythonCompletionSource({
        sessionId: () => sessionIdRef.current,
        sessionItemId: () => sessionItemIdRef.current,
        enabled: () => autoCompletionEnabledRef.current,
        onAvailability: setCompletionAvailability,
      }),
    ], activateOnTyping: true })
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
        completion.of(autoCompletionEnabledRef.current ? completionExtension() : []),
        hoverTooltip(pythonDocumentationTooltip, { hoverTime: 250, hideOnChange: true }),
        python(),
        syntaxHighlighting(softDarkHighlightStyle, { fallback: true }),
        indentUnit.of('    '),
        pythonEditorKeymap,
        Prec.highest(keymap.of([{ key: 'Shift-Alt-f', run: () => {
          if (!onFormatRef.current) return false
          onFormatRef.current()
          return true
        } }, { key: PYTHON_SYNTAX_CHECK_SHORTCUT, run: () => {
          if (!onSyntaxCheckRef.current) return false
          if (syntaxCheckDisabledRef.current || syntaxStatusRef.current === 'checking') return true
          onSyntaxCheckRef.current()
          return true
        } }])),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
        editable.of([EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)]),
        EditorView.contentAttributes.of({ 'aria-label': 'Python 3.13 代码', spellcheck: 'false', autocapitalize: 'off' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) onChangeRef.current(update.state.doc.toString())
          if (update.selectionSet || update.docChanged) setCursorPosition(pythonCursorPosition(update.state))
        }),
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
    const current = view.state.doc.toString()
    let from = 0
    while (from < current.length && from < value.length && current[from] === value[from]) from += 1
    let currentTo = current.length
    let valueTo = value.length
    while (currentTo > from && valueTo > from && current[currentTo - 1] === value[valueTo - 1]) {
      currentTo -= 1
      valueTo -= 1
    }
    view.dispatch({
      changes: { from, to: currentTo, insert: value.slice(from, valueTo) },
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
    closeCompletion(view)
    const extension = autoCompletionEnabled
      ? autocompletion({ override: [createCombinedPythonCompletionSource({
        sessionId: () => sessionIdRef.current,
        sessionItemId: () => sessionItemIdRef.current,
        enabled: () => autoCompletionEnabledRef.current,
        onAvailability: setCompletionAvailability,
      })], activateOnTyping: true })
      : []
    view.dispatch({ effects: completionCompartmentRef.current.reconfigure(extension) })
    if (!autoCompletionEnabled) setCompletionAvailability('ready')
  }, [autoCompletionEnabled])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch(setDiagnostics(view.state, editorDiagnostics(view.state, diagnostics)))
  }, [diagnostics])

  const showTools = !disabled && Boolean(onRun)
  const showAutomationTools = !disabled && Boolean(onAutoCompletionChange || onAutoSyntaxChange || onAutoFormatChange)
  const handleShellBlur = (event: FocusEvent<HTMLDivElement>) => {
    const shell = event.currentTarget
    const next = event.relatedTarget as Node | null
    if (next && shell.contains(next)) return
    window.setTimeout(() => {
      if (!shell.contains(document.activeElement)) onBlurRef.current(viewRef.current?.state.doc.toString() ?? value)
    }, 0)
  }

  return <div className="python-ide-shell" data-theme="soft-dark" onBlurCapture={handleShellBlur}>
    <header className="python-ide-tabbar">
      <div className="python-file-tab"><span className="python-file-icon" aria-hidden="true">Py</span><span>main.py</span></div>
      {showTools ? <div className="python-editor-toolbar" aria-label="代码编辑工具栏">
        {onRun && <span className="python-tool-wrap" tabIndex={runDisabled ? 0 : undefined}><button type="button" className="python-tool-button run" disabled={runDisabled} onClick={onRun} aria-label={runLabel}>{runLoading ? <LoaderCircle className="spin" /> : <Play />}<span>{runLabel}</span></button><span className="python-tool-tip" role="tooltip">{runDisabled ? runDisabledReason || '当前不能运行公开样例' : `${runLabel}：使用当前代码运行公开测试点`}</span></span>}
      </div> : <span className="python-ide-runtime">Python 3.13</span>}
    </header>
    <div ref={hostRef} className="python-code-editor" />
    <footer className="python-ide-statusbar" aria-label="编辑器状态">
      {showAutomationTools && <div className="python-status-automation" role="group" aria-label="编辑器自动功能">
        {onAutoCompletionChange && <span className="python-tool-wrap"><button type="button" className={`python-status-toggle auto-completion ${autoCompletionEnabled ? 'active' : ''}`} aria-label="智能补全" aria-pressed={autoCompletionEnabled} onClick={() => onAutoCompletionChange(!autoCompletionEnabled)}><Sparkles /><span className="python-toggle-track" aria-hidden="true"><span /></span></button><span className="python-tool-tip" role="tooltip">智能补全：{autoCompletionEnabled ? '已开启' : '已关闭'}</span></span>}
        {onAutoSyntaxChange && <span className="python-tool-wrap"><button type="button" className={`python-status-toggle auto-syntax ${autoSyntaxEnabled ? 'active' : ''}`} aria-label="自动语法检查" aria-pressed={autoSyntaxEnabled} onClick={() => onAutoSyntaxChange(!autoSyntaxEnabled)}><Search /><span className="python-toggle-track" aria-hidden="true"><span /></span></button><span className="python-tool-tip" role="tooltip">语法检查：{autoSyntaxEnabled ? '已开启' : '已关闭'}</span></span>}
        {onAutoFormatChange && <span className="python-tool-wrap"><button type="button" className={`python-status-toggle auto-format ${autoFormatEnabled ? 'active' : ''}`} aria-label="自动格式化" aria-pressed={autoFormatEnabled} onClick={() => onAutoFormatChange(!autoFormatEnabled)}><Braces /><span className="python-toggle-track" aria-hidden="true"><span /></span></button><span className="python-tool-tip" role="tooltip">代码格式化：{autoFormatEnabled ? '已开启' : '已关闭'}</span></span>}
      </div>}
      <div className="python-status-details"><span>行 {cursorPosition.line}，列 {cursorPosition.column}</span><span className="python-status-secondary">空格：4</span><span className="python-status-secondary">UTF-8</span>{disabled && <span>只读</span>}{formatStatus !== 'idle' && <span className={`python-format-state ${formatStatus}`} role="status">{formatStatus === 'formatting' ? '格式化中…' : formatStatus === 'formatted' ? '已格式化' : formatStatus === 'unchanged' ? '格式已规范' : '格式化失败'}</span>}{autoCompletionEnabled && completionAvailability !== 'ready' && <span className={`python-completion-availability ${completionAvailability}`}>{completionAvailability === 'checking' ? '正在补全…' : '补全暂不可用'}</span>}<span>Python 3.13</span></div>
    </footer>
  </div>
}
