export type TypingFinger = 'l2' | 'l3' | 'l4' | 'l5' | 'r2' | 'r3' | 'r4' | 'r5' | 'thumb'
export type HandFinger = 'l1' | 'l2' | 'l3' | 'l4' | 'l5' | 'r1' | 'r2' | 'r3' | 'r4' | 'r5'

export type VirtualKey = {
  code: string
  base: string
  shift?: string
  width?: number
  finger?: TypingFinger
  label?: string
}

export type KeyTarget = { code: string; shift: boolean; finger?: TypingFinger }

export type HandGuideTarget = {
  primary: HandFinger[]
  modifier: HandFinger[]
  label: string
}

export const HAND_FINGER_LABELS: Record<HandFinger, string> = {
  l1: '左手拇指',
  l2: '左手食指',
  l3: '左手中指',
  l4: '左手无名指',
  l5: '左手小拇指',
  r1: '右手拇指',
  r2: '右手食指',
  r3: '右手中指',
  r4: '右手无名指',
  r5: '右手小拇指',
}

export const KEY_ROWS: VirtualKey[][] = [
  [
    { code: 'Backquote', base: '`', shift: '~', finger: 'l5' },
    ...'12345'.split('').map<VirtualKey>((base, i) => ({ code: `Digit${base}`, base, shift: ['!', '@', '#', '$', '%'][i], finger: i === 0 ? 'l5' : i === 1 ? 'l4' : i === 2 ? 'l3' : 'l2' })),
    ...'67890'.split('').map<VirtualKey>((base, i) => ({ code: `Digit${base}`, base, shift: ['^', '&', '*', '(', ')'][i], finger: i < 2 ? 'r2' : i === 2 ? 'r3' : i === 3 ? 'r4' : 'r5' })),
    { code: 'Minus', base: '-', shift: '_', finger: 'r5' },
    { code: 'Equal', base: '=', shift: '+', finger: 'r5' },
    { code: 'Backspace', base: '', label: '⌫', width: 1.7, finger: 'r5' },
  ],
  [
    { code: 'Tab', base: '\t', label: 'Tab', width: 1.5, finger: 'l5' },
    ...'qwertyuiop'.split('').map<VirtualKey>((base, i) => ({ code: `Key${base.toUpperCase()}`, base, shift: base.toUpperCase(), finger: (['l5', 'l4', 'l3', 'l2', 'l2', 'r2', 'r2', 'r3', 'r4', 'r5'] as const)[i] })),
    { code: 'BracketLeft', base: '[', shift: '{', finger: 'r5' },
    { code: 'BracketRight', base: ']', shift: '}', finger: 'r5' },
    { code: 'Backslash', base: '\\', shift: '|', width: 1.5, finger: 'r5' },
  ],
  [
    { code: 'CapsLock', base: '', label: 'Caps', width: 1.8, finger: 'l5' },
    ...'asdfghjkl'.split('').map<VirtualKey>((base, i) => ({ code: `Key${base.toUpperCase()}`, base, shift: base.toUpperCase(), finger: (['l5', 'l4', 'l3', 'l2', 'l2', 'r2', 'r2', 'r3', 'r4'] as const)[i] })),
    { code: 'Semicolon', base: ';', shift: ':', finger: 'r5' },
    { code: 'Quote', base: "'", shift: '"', finger: 'r5' },
    { code: 'Enter', base: '\n', label: 'Enter', width: 2.2, finger: 'r5' },
  ],
  [
    { code: 'ShiftLeft', base: '', label: 'Shift', width: 2.3, finger: 'l5' },
    ...'zxcvbnm'.split('').map<VirtualKey>((base, i) => ({ code: `Key${base.toUpperCase()}`, base, shift: base.toUpperCase(), finger: (['l5', 'l4', 'l3', 'l2', 'l2', 'r2', 'r2'] as const)[i] })),
    { code: 'Comma', base: ',', shift: '<', finger: 'r3' },
    { code: 'Period', base: '.', shift: '>', finger: 'r4' },
    { code: 'Slash', base: '/', shift: '?', finger: 'r5' },
    { code: 'ShiftRight', base: '', label: 'Shift', width: 2.7, finger: 'r5' },
  ],
  [
    { code: 'ControlLeft', base: '', label: 'Ctrl', width: 1.4 },
    { code: 'MetaLeft', base: '', label: 'Win', width: 1.4 },
    { code: 'AltLeft', base: '', label: 'Alt', width: 1.4 },
    { code: 'Space', base: ' ', label: 'Space', width: 7, finger: 'thumb' },
    { code: 'AltRight', base: '', label: 'Alt', width: 1.4 },
    { code: 'MetaRight', base: '', label: 'Win', width: 1.4 },
    { code: 'ControlRight', base: '', label: 'Ctrl', width: 1.4 },
  ],
]

export function keyForCharacter(char: string): KeyTarget | null {
  for (const row of KEY_ROWS) {
    for (const key of row) {
      if (key.base === char) return { code: key.code, shift: false, finger: key.finger }
      if (key.shift === char) return { code: key.code, shift: true, finger: key.finger }
    }
  }
  return null
}

export function handGuideForCharacter(char: string): HandGuideTarget | null {
  const target = keyForCharacter(char)
  if (!target?.finger) return null

  if (target.finger === 'thumb') {
    return {
      primary: ['l1', 'r1'],
      modifier: [],
      label: '左手或右手拇指',
    }
  }

  const primary = target.finger as HandFinger
  const modifier: HandFinger[] = target.shift
    ? [primary.startsWith('l') ? 'r5' : 'l5']
    : []

  return {
    primary: [primary],
    modifier,
    label: `${HAND_FINGER_LABELS[primary]}${modifier.length ? ` + ${HAND_FINGER_LABELS[modifier[0]]}按 Shift` : ''}`,
  }
}
