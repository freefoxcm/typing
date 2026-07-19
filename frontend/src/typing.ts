import type { ErrorCount } from './types'

export function keyToCharacter(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>, expected: string): string | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null
  if (event.key === 'Enter') return '\n'
  if (event.key === 'Tab') return expected === '\t' ? '\t' : null
  if (event.key.length === 1) return event.key
  return null
}

export function calculateStats(chars: number, errors: number, durationMs: number) {
  const safeDuration = Math.max(100, durationMs)
  return {
    cpm: Math.round((chars * 60_000) / safeDuration),
    accuracy: Math.round((chars / Math.max(1, chars + errors)) * 10_000) / 100,
  }
}

export function shuffleBag<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

export function errorsToList(errors: Map<string, number>): ErrorCount[] {
  return [...errors.entries()].map(([key, count]) => {
    const separator = key.indexOf('\u0000')
    return { expected_char: key.slice(0, separator), actual_char: key.slice(separator + 1), count }
  })
}

export function errorLabel(char: string): string {
  if (char === ' ') return '空格'
  if (char === '\n') return '回车'
  if (char === '\t') return 'Tab'
  return char
}

