import { handGuideForCharacter } from '../keyboard'
import type { HandFinger } from '../keyboard'
import { errorLabel } from '../typing'
import handsImage from '../assets/finger-guide-hands.webp'

export function FingerGuide({ expected }: { expected: string }) {
  const guide = handGuideForCharacter(expected)
  const primary = new Set(guide?.primary ?? [])
  const modifier = new Set(guide?.modifier ?? [])
  const keyLabel = expected ? errorLabel(expected) : '—'
  const announcement = guide
    ? `下一键 ${keyLabel}，使用${guide.label}`
    : `下一键 ${keyLabel}，暂无对应指法`

  const fingerClass = (finger: HandFinger) => {
    if (primary.has(finger)) return 'finger-hotspot is-primary'
    if (modifier.has(finger)) return 'finger-hotspot is-modifier'
    return 'finger-hotspot'
  }

  return (
    <aside className="finger-guide" aria-label="双手指法提示">
      <p className="finger-guide-eyebrow">指法提示</p>
      <div className="finger-guide-next">
        <span>下一键</span>
        <kbd>{keyLabel}</kbd>
      </div>
      <p className="finger-guide-instruction" aria-live="polite">{announcement}</p>
      <div className="hands-illustration" aria-hidden="true">
        <svg className="hands-diagram" viewBox="0 0 768 512">
          <image href={handsImage} width="768" height="512" />
          <g className="finger-hotspots">
            <path data-finger="l5" className={fingerClass('l5')} d="M99 130 C96 175 101 220 115 254" />
            <path data-finger="l4" className={fingerClass('l4')} d="M155 70 C154 126 153 181 157 221" />
            <path data-finger="l3" className={fingerClass('l3')} d="M206 44 C205 110 204 177 207 221" />
            <path data-finger="l2" className={fingerClass('l2')} d="M263 69 C259 126 251 181 244 222" />
            <path data-finger="l1" className={fingerClass('l1')} d="M338 205 C327 224 316 246 307 269" />

            <path data-finger="r1" className={fingerClass('r1')} d="M430 205 C441 224 452 246 461 269" />
            <path data-finger="r2" className={fingerClass('r2')} d="M505 69 C509 126 517 181 524 222" />
            <path data-finger="r3" className={fingerClass('r3')} d="M562 44 C563 110 564 177 561 221" />
            <path data-finger="r4" className={fingerClass('r4')} d="M613 70 C614 126 615 181 611 221" />
            <path data-finger="r5" className={fingerClass('r5')} d="M669 130 C672 175 667 220 653 254" />
          </g>
        </svg>
        <div className="hand-labels"><span>左手</span><span>右手</span></div>
      </div>
      <div className="finger-guide-legend" aria-hidden="true">
        <span><i className="legend-primary" />目标手指</span>
        {guide?.modifier.length ? <span><i className="legend-modifier" />Shift 手指</span> : null}
      </div>
    </aside>
  )
}
