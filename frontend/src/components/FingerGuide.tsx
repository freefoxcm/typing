import { handGuideForCharacter } from '../keyboard'
import type { HandFinger } from '../keyboard'
import { errorLabel } from '../typing'

export function FingerGuide({ expected }: { expected: string }) {
  const guide = handGuideForCharacter(expected)
  const primary = new Set(guide?.primary ?? [])
  const modifier = new Set(guide?.modifier ?? [])
  const keyLabel = expected ? errorLabel(expected) : '—'
  const announcement = guide
    ? `下一键 ${keyLabel}，使用${guide.label}`
    : `下一键 ${keyLabel}，暂无对应指法`

  const fingerClass = (finger: HandFinger) => {
    if (primary.has(finger)) return 'finger-shape is-primary'
    if (modifier.has(finger)) return 'finger-shape is-modifier'
    return 'finger-shape'
  }

  return (
    <aside className="finger-guide" aria-label="双手指法提示">
      <p className="finger-guide-eyebrow">指法提示</p>
      <div className="finger-guide-next">
        <span>下一键</span>
        <kbd>{keyLabel}</kbd>
      </div>
      <p className="finger-guide-instruction" aria-live="polite">{announcement}</p>
      <svg className="hands-diagram" viewBox="0 0 360 235" aria-hidden="true">
        <g className="hand-illustration left-hand">
          <path className="hand-palm" d="M46 101 C46 86 57 76 72 76 H126 C143 76 154 89 154 106 V173 C154 194 137 208 116 208 H75 C56 208 42 194 42 175 Z" />
          <rect className={fingerClass('l5')} x="18" y="67" width="26" height="91" rx="13" transform="rotate(-9 31 112)" />
          <rect className={fingerClass('l4')} x="48" y="35" width="27" height="113" rx="13.5" transform="rotate(-3 61 91)" />
          <rect className={fingerClass('l3')} x="79" y="20" width="28" height="128" rx="14" />
          <rect className={fingerClass('l2')} x="111" y="38" width="28" height="111" rx="14" transform="rotate(3 125 93)" />
          <path className={fingerClass('l1')} d="M48 137 C40 125 30 118 20 122 C9 126 8 139 16 149 L55 193 C64 203 80 199 83 187 C85 181 82 175 78 170 Z" />
        </g>

        <g className="hand-illustration right-hand">
          <path className="hand-palm" d="M314 101 C314 86 303 76 288 76 H234 C217 76 206 89 206 106 V173 C206 194 223 208 244 208 H285 C304 208 318 194 318 175 Z" />
          <rect className={fingerClass('r5')} x="316" y="67" width="26" height="91" rx="13" transform="rotate(9 329 112)" />
          <rect className={fingerClass('r4')} x="285" y="35" width="27" height="113" rx="13.5" transform="rotate(3 298 91)" />
          <rect className={fingerClass('r3')} x="253" y="20" width="28" height="128" rx="14" />
          <rect className={fingerClass('r2')} x="221" y="38" width="28" height="111" rx="14" transform="rotate(-3 235 93)" />
          <path className={fingerClass('r1')} d="M312 137 C320 125 330 118 340 122 C351 126 352 139 344 149 L305 193 C296 203 280 199 277 187 C275 181 278 175 282 170 Z" />
        </g>

        <text className="hand-label" x="94" y="228" textAnchor="middle">左手</text>
        <text className="hand-label" x="266" y="228" textAnchor="middle">右手</text>
      </svg>
      <div className="finger-guide-legend" aria-hidden="true">
        <span><i className="legend-primary" />目标手指</span>
        {guide?.modifier.length ? <span><i className="legend-modifier" />Shift 手指</span> : null}
      </div>
    </aside>
  )
}
