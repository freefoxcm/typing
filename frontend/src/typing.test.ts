import { calculateStats, keyToCharacter, shuffleBag } from './typing'

describe('typing helpers', () => {
  it('maps Enter and Tab only when gradable', () => {
    const base = { ctrlKey: false, altKey: false, metaKey: false }
    expect(keyToCharacter({ ...base, key: 'Enter' }, '\n')).toBe('\n')
    expect(keyToCharacter({ ...base, key: 'Tab' }, 'a')).toBeNull()
    expect(keyToCharacter({ ...base, key: 'Tab' }, '\t')).toBe('\t')
  })

  it('ignores shortcuts and keeps case', () => {
    expect(keyToCharacter({ key: 'A', ctrlKey: false, altKey: false, metaKey: false }, 'A')).toBe('A')
    expect(keyToCharacter({ key: 'a', ctrlKey: true, altKey: false, metaKey: false }, 'a')).toBeNull()
  })

  it('calculates CPM and accuracy with duration protection', () => {
    expect(calculateStats(60, 0, 60_000)).toEqual({ cpm: 60, accuracy: 100 })
    expect(calculateStats(8, 2, 10_000).accuracy).toBe(80)
    expect(calculateStats(1, 0, 0).cpm).toBe(600)
  })

  it('returns every bag item exactly once', () => {
    const result = shuffleBag([1, 2, 3, 4], () => 0.25)
    expect(new Set(result)).toEqual(new Set([1, 2, 3, 4]))
    expect(result).toHaveLength(4)
  })
})

