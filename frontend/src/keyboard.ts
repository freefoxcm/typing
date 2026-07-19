export type VirtualKey = { code: string; base: string; shift?: string; width?: number; finger?: string; label?: string }

export const KEY_ROWS: VirtualKey[][] = [
  [
    { code: 'Backquote', base: '`', shift: '~', finger: 'l5' },
    ...'12345'.split('').map((base, i) => ({ code: `Digit${base}`, base, shift: ['!', '@', '#', '$', '%'][i], finger: i === 0 ? 'l5' : i === 1 ? 'l4' : i === 2 ? 'l3' : 'l2' })),
    ...'67890'.split('').map((base, i) => ({ code: `Digit${base}`, base, shift: ['^', '&', '*', '(', ')'][i], finger: i < 2 ? 'r2' : i === 2 ? 'r3' : i === 3 ? 'r4' : 'r5' })),
    { code: 'Minus', base: '-', shift: '_', finger: 'r5' },
    { code: 'Equal', base: '=', shift: '+', finger: 'r5' },
    { code: 'Backspace', base: '', label: '⌫', width: 1.7, finger: 'r5' },
  ],
  [
    { code: 'Tab', base: '\t', label: 'Tab', width: 1.5, finger: 'l5' },
    ...'qwertyuiop'.split('').map((base, i) => ({ code: `Key${base.toUpperCase()}`, base, shift: base.toUpperCase(), finger: ['l5', 'l4', 'l3', 'l2', 'l2', 'r2', 'r2', 'r3', 'r4', 'r5'][i] })),
    { code: 'BracketLeft', base: '[', shift: '{', finger: 'r5' },
    { code: 'BracketRight', base: ']', shift: '}', finger: 'r5' },
    { code: 'Backslash', base: '\\', shift: '|', width: 1.5, finger: 'r5' },
  ],
  [
    { code: 'CapsLock', base: '', label: 'Caps', width: 1.8, finger: 'l5' },
    ...'asdfghjkl'.split('').map((base, i) => ({ code: `Key${base.toUpperCase()}`, base, shift: base.toUpperCase(), finger: ['l5', 'l4', 'l3', 'l2', 'l2', 'r2', 'r2', 'r3', 'r4'][i] })),
    { code: 'Semicolon', base: ';', shift: ':', finger: 'r5' },
    { code: 'Quote', base: "'", shift: '"', finger: 'r5' },
    { code: 'Enter', base: '\n', label: 'Enter', width: 2.2, finger: 'r5' },
  ],
  [
    { code: 'ShiftLeft', base: '', label: 'Shift', width: 2.3, finger: 'l5' },
    ...'zxcvbnm'.split('').map((base, i) => ({ code: `Key${base.toUpperCase()}`, base, shift: base.toUpperCase(), finger: ['l5', 'l4', 'l3', 'l2', 'l2', 'r2', 'r2'][i] })),
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

export function keyForCharacter(char: string): { code: string; shift: boolean; finger?: string } | null {
  for (const row of KEY_ROWS) {
    for (const key of row) {
      if (key.base === char) return { code: key.code, shift: false, finger: key.finger }
      if (key.shift === char) return { code: key.code, shift: true, finger: key.finger }
    }
  }
  return null
}

