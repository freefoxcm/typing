import { KEY_ROWS, keyForCharacter } from '../keyboard'
import { errorLabel } from '../typing'

export function VirtualKeyboard({ expected, visible }: { expected: string; visible: boolean }) {
  if (!visible) return null
  const target = keyForCharacter(expected)
  return (
    <section className="keyboard-wrap" aria-label={`虚拟键盘，下一键 ${errorLabel(expected)}`}>
      <div className="finger-hint" aria-live="polite">
        <span className={`hand hand-left ${target?.finger?.startsWith('l') ? 'active' : ''}`}>左手</span>
        <span>下一键：<strong>{errorLabel(expected)}</strong>{target?.shift ? ' + Shift' : ''}</span>
        <span className={`hand hand-right ${target?.finger?.startsWith('r') ? 'active' : ''}`}>右手</span>
      </div>
      <div className="keyboard" aria-hidden="true">
        {KEY_ROWS.map((row, rowIndex) => (
          <div className="key-row" key={rowIndex}>
            {row.map((key) => {
              const active = key.code === target?.code
              const shiftActive = target?.shift && key.code.startsWith('Shift') && (
                target.finger?.startsWith('l') ? key.code === 'ShiftRight' : key.code === 'ShiftLeft'
              )
              return (
                <div
                  key={key.code}
                  className={`vkey finger-${key.finger ?? 'neutral'} ${active || shiftActive ? 'target' : ''}`}
                  style={{ flexGrow: key.width ?? 1 }}
                >
                  {key.shift && <small>{key.shift}</small>}
                  <span>{key.label ?? key.base.toUpperCase()}</span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

