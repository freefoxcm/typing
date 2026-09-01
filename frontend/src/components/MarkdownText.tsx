import type { ReactNode } from 'react'
import katex from 'katex'

type MathDelimiter = '$' | '$$' | '\\(' | '\\['

const KATEX_OPTIONS = {
  output: 'htmlAndMathml' as const,
  trust: false,
  throwOnError: true,
  maxSize: 10,
  maxExpand: 1000,
  strict: 'ignore' as const,
}

function MathFormula({ source, displayMode, delimiter }: { source: string; displayMode: boolean; delimiter: MathDelimiter }) {
  try {
    const html = katex.renderToString(source, { ...KATEX_OPTIONS, displayMode })
    return <span className={displayMode ? 'math-formula math-display' : 'math-formula math-inline'} dangerouslySetInnerHTML={{ __html: html }} />
  } catch {
    const closing = delimiter === '\\(' ? '\\)' : delimiter === '\\[' ? '\\]' : delimiter
    return <span className="math-formula-error" title="公式格式无法解析">{delimiter}{source}{closing}</span>
  }
}

function plainText(value: string) {
  return value.replace(/\\\$/g, '$')
}

export function inlineMarkdown(text: string, prefix: string): ReactNode[] {
  const pattern = /`([^`]+)`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\\\((.+?)\\\)|(?<!\\)\$(?!\$)([^$\n，。；！？]+?)(?<!\\)\$/g
  const nodes: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(plainText(text.slice(cursor, index)))
    const key = `${prefix}-${index}`
    if (match[1] !== undefined) nodes.push(<code key={key}>{match[1]}</code>)
    else if (match[2] !== undefined) nodes.push(<span className="markdown-image-placeholder" key={key}>[图片：{match[2] || '未命名'}]</span>)
    else if (match[4] !== undefined) {
      const href = match[5]
      nodes.push(/^(https?:\/\/|\/)/.test(href) ? <a href={href} rel="noreferrer" target={href.startsWith('/') ? undefined : '_blank'} key={key}>{inlineMarkdown(match[4], `${key}-link`)}</a> : <span key={key}>{inlineMarkdown(match[4], `${key}-link`)}</span>)
    } else if (match[6] !== undefined) nodes.push(<strong key={key}>{inlineMarkdown(match[6], `${key}-strong`)}</strong>)
    else if (match[7] !== undefined) nodes.push(<MathFormula key={key} source={match[7]} displayMode={false} delimiter={'\\('} />)
    else nodes.push(<MathFormula key={key} source={match[8]} displayMode={false} delimiter="$" />)
    cursor = index + match[0].length
  }
  if (cursor < text.length) nodes.push(plainText(text.slice(cursor)))
  return nodes
}

function blockStart(line: string): boolean {
  return /^\s*```/.test(line) || /^\s*\$\$/.test(line) || /^\s*\\\[/.test(line) || /^\s{0,3}#{1,4}\s+/.test(line) || /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line) || /^\s*>\s+/.test(line)
}

function readMathBlock(lines: string[], start: number): { source: string; next: number; delimiter: '$$' | '\\[' } | null {
  const trimmed = lines[start].trim()
  const delimiter = trimmed.startsWith('$$') ? '$$' : trimmed.startsWith('\\[') ? '\\[' : null
  if (!delimiter) return null
  const closing = delimiter === '$$' ? '$$' : '\\]'
  const first = trimmed.slice(delimiter.length)
  if (first.endsWith(closing) && first.length > closing.length) return { source: first.slice(0, -closing.length).trim(), next: start + 1, delimiter }
  const content = first ? [first] : []
  let index = start + 1
  while (index < lines.length) {
    const line = lines[index]
    const closeIndex = line.lastIndexOf(closing)
    if (closeIndex >= 0) {
      if (line.slice(0, closeIndex)) content.push(line.slice(0, closeIndex))
      return { source: content.join('\n').trim(), next: index + 1, delimiter }
    }
    content.push(line)
    index += 1
  }
  return null
}

export function MarkdownText({ value, className = '' }: { value?: string; className?: string }) {
  const lines = (value || '—').replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }
    const mathBlock = readMathBlock(lines, index)
    if (mathBlock) {
      blocks.push(<MathFormula key={`math-${index}`} source={mathBlock.source} displayMode delimiter={mathBlock.delimiter} />)
      index = mathBlock.next
      continue
    }
    const fence = line.match(/^\s*```\s*([a-z0-9_+-]*)/i)
    if (fence) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index])) { code.push(lines[index]); index += 1 }
      if (index < lines.length) index += 1
      blocks.push(<pre key={`code-${index}`}><code data-language={fence[1] || undefined}>{code.join('\n').trimEnd()}</code></pre>)
      continue
    }
    const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+)$/)
    if (heading) {
      const content = inlineMarkdown(heading[2], `heading-${index}`)
      const level = heading[1].length
      blocks.push(level === 1 ? <h2 key={index}>{content}</h2> : level === 2 ? <h3 key={index}>{content}</h3> : <h4 key={index}>{content}</h4>)
      index += 1
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length) {
        const match = lines[index].match(/^\s*[-*+]\s+(.+)$/)
        if (!match) break
        items.push(<li key={index}>{inlineMarkdown(match[1], `ul-${index}`)}</li>)
        index += 1
      }
      blocks.push(<ul key={`ul-${index}`}>{items}</ul>)
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length) {
        const match = lines[index].match(/^\s*\d+\.\s+(.+)$/)
        if (!match) break
        items.push(<li key={index}>{inlineMarkdown(match[1], `ol-${index}`)}</li>)
        index += 1
      }
      blocks.push(<ol key={`ol-${index}`}>{items}</ol>)
      continue
    }
    const quote = line.match(/^\s*>\s+(.+)$/)
    if (quote) {
      blocks.push(<blockquote key={index}>{inlineMarkdown(quote[1], `quote-${index}`)}</blockquote>)
      index += 1
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !blockStart(lines[index])) { paragraph.push(lines[index]); index += 1 }
    blocks.push(<p key={`p-${index}`}>{paragraph.map((part, partIndex) => <span key={partIndex}>{inlineMarkdown(part, `p-${index}-${partIndex}`)}{partIndex < paragraph.length - 1 && <br />}</span>)}</p>)
  }
  return <div className={`markdown-text${className ? ` ${className}` : ''}`}>{blocks}</div>
}

export function MarkdownPreview({ value, readOnly = false, label = 'Markdown 源码' }: { value?: string; readOnly?: boolean; label?: string }) {
  if (readOnly) return <div className="markdown-readonly"><MarkdownText value={value} /><details><summary>查看 {label}</summary><pre>{value || '—'}</pre></details></div>
  return <details className="markdown-preview"><summary>渲染预览</summary><MarkdownText value={value} /></details>
}
