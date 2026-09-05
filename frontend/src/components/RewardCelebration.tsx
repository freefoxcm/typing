import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { games, type Reward } from '../rewards'

export function GiftArt() {
  return <svg viewBox="0 0 160 160" fill="none" aria-hidden="true"><ellipse cx="80" cy="143" rx="51" ry="9" fill="#173f5f" opacity=".15" /><path d="M32 69h96v62c-27 13-63 13-96 0Z" fill="#ed553b" /><path d="M80 75h48v56c-13 7-29 10-48 10Z" fill="#cf432f" /><path d="M69 66h23v76H69z" fill="#f6d55c" /><g className="gift-lid"><path d="M23 53h114v26H23z" fill="#f77958" /><path d="M69 53h23v26H69z" fill="#ffe99a" /><path d="M80 53C35 53 41 17 61 27c12 6 19 26 19 26Zm0 0c45 0 39-36 19-26C87 33 80 53 80 53Z" stroke="#f6d55c" strokeWidth="10" strokeLinejoin="round" /></g><path d="m44 94 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z" fill="#fff4bc" /></svg>
}

export function RewardCelebration({ reward, onDone }: { reward: Reward; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [randomIcon, setRandomIcon] = useState(0)
  const upgrade = reward.display_version > 1
  const duration = reduced ? 600 : upgrade ? 1500 : 3000
  const doneRef = useRef(onDone); doneRef.current = onDone
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const changed = () => setReduced(media?.matches ?? false)
    media?.addEventListener?.('change', changed)
    return () => media?.removeEventListener?.('change', changed)
  }, [])
  useEffect(() => {
    const score = document.querySelector('.exercise-score')
    score?.classList.add('reward-score-lit')
    const target = document.querySelector('[data-reward-anchor]')?.getBoundingClientRect()
    if (target && wrapper.current) {
      wrapper.current.style.setProperty('--gift-x', `${target.left + 35 - innerWidth / 2}px`)
      wrapper.current.style.setProperty('--gift-y', `${Math.max(70, Math.min(innerHeight - 70, target.top + 35)) - innerHeight / 2}px`)
    }
    const timer = window.setTimeout(() => doneRef.current(), duration)
    const keydown = (event: KeyboardEvent) => { if (event.code === 'Escape') { event.preventDefault(); doneRef.current() } }
    window.addEventListener('keydown', keydown)
    return () => { clearTimeout(timer); window.removeEventListener('keydown', keydown); score?.classList.remove('reward-score-lit') }
  }, [duration])
  useEffect(() => {
    if (reduced || reward.mode !== 'random') return
    const timer = window.setInterval(() => setRandomIcon(value => value + 1), 100)
    const stop = window.setTimeout(() => clearInterval(timer), 1400)
    return () => { clearInterval(timer); clearTimeout(stop) }
  }, [reduced, reward.mode])
  useEffect(() => {
    if (reduced) return
    let frame = 0
    try {
      const element = canvas.current, ctx = element?.getContext('2d')
      if (!element || !ctx) return
      const width = innerWidth, height = innerHeight, ratio = Math.min(devicePixelRatio || 1, 2)
      element.width = width * ratio; element.height = height * ratio; ctx.scale(ratio, ratio)
      const colors = ['#f6d55c', '#ed553b', '#3caea3', '#ffffff', '#8cc7e7']
      const points = Array.from({ length: width < 650 ? 38 : 85 }, (_, i) => ({ angle: Math.random() * Math.PI * 2, speed: 130 + Math.random() * 400, size: 3 + Math.random() * 6, color: colors[i % colors.length], star: i % 4 === 0 }))
      const start = performance.now()
      const draw = (now: number) => {
        const elapsed = (now - start) / 1000, burst = upgrade ? .2 : .9
        ctx.clearRect(0, 0, width, height)
        points.forEach((p, i) => {
          let x, y, alpha
          if (elapsed < burst) {
            const radius = (burst - elapsed) * 250 + 30
            x = width / 2 + Math.cos(p.angle + elapsed) * radius; y = height / 2 - 30 + Math.sin(p.angle + elapsed) * radius
            alpha = elapsed / burst
          } else {
            const t = elapsed - burst
            x = width / 2 + Math.cos(p.angle) * p.speed * t; y = height / 2 - 30 + Math.sin(p.angle) * p.speed * t + 150 * t * t
            alpha = Math.max(0, 1 - t / 2)
          }
          ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = p.color; ctx.translate(x, y); ctx.rotate(elapsed * (i % 2 ? 3 : -3))
          if (p.star) { ctx.beginPath(); for (let n = 0; n < 10; n++) { const r = n % 2 ? p.size / 2 : p.size; ctx.lineTo(Math.cos(n * Math.PI / 5) * r, Math.sin(n * Math.PI / 5) * r) } ctx.closePath(); ctx.fill() }
          else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * .65)
          ctx.restore()
        })
        if (elapsed * 1000 < duration) frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)
    } catch { /* The reward card remains available even without Canvas. */ }
    return () => cancelAnimationFrame(frame)
  }, [duration, reduced, upgrade])
  return createPortal(<div ref={wrapper} className={`reward-celebration ${upgrade ? 'is-upgrade' : ''} ${reduced ? 'is-reduced' : ''}`}>
    <canvas ref={canvas} aria-hidden="true" /><div className="reward-wave" aria-hidden="true" />
    <div className="celebration-content"><div className="celebration-gift"><GiftArt /></div>
      <div className="celebration-reveal"><p className="eyebrow">努力，值得被庆祝</p><h2>{upgrade ? '新游戏加入奖励！' : '隐藏彩蛋解锁！'}</h2>
        <p>{upgrade ? '更多选择，同一份快乐时光' : `获得 ${reward.duration_minutes} 分钟游戏时光`}</p>
        {reward.mode === 'random' && !reduced && <div className="reward-random-spin" aria-hidden="true">{randomIcon % 2 ? '⚑' : '✦'}</div>}
        <div className="celebration-games">{reward.games.map((id, i) => <div key={id} style={{ '--card-delay': `${i * 120}ms` } as React.CSSProperties}><span>{games[id].icon}</span><strong>{games[id].name}</strong></div>)}</div>
        <small>{reward.games.length > 1 ? `共享 ${reward.duration_minutes} 分钟 · ` : ''}当天领取，开始游戏后才计时</small>
      </div>
    </div><button className="celebration-skip" onClick={onDone}>跳过动画 · Esc</button>
  </div>, document.body)
}
