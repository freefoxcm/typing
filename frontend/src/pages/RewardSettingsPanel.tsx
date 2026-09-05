import { useEffect, useState } from 'react'
import { Gift, Save } from 'lucide-react'
import { api, jsonBody } from '../api'
import type { RewardSettings } from '../rewards'

export function RewardSettingsPanel() {
  const [settings, setSettings] = useState<RewardSettings | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = () => { setError(''); void api<RewardSettings>('/api/admin/easter-egg-settings').then(setSettings).catch(e => setError(e.message)) }
  useEffect(load, [])
  const change = (patch: Partial<RewardSettings>) => { setSettings(value => value && { ...value, ...patch }); setSaved(false) }
  return <section className="reward-settings"><div className="section-title"><div><p className="eyebrow">彩蛋设置</p><h2>学习彩蛋</h2><p>认真练习之后，留一点时间给惊喜。</p></div><Gift size={36} /></div>
    {error && <p className="notice error" role="alert">{error} {!settings && <button onClick={load}>重试</button>}</p>}
    {!settings ? <p>正在读取设置…</p> : <form className="card reward-settings-form" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError(''); setSaved(false)
      try { setSettings(await api<RewardSettings>('/api/admin/easter-egg-settings', { method: 'PUT', ...jsonBody(settings) })); setSaved(true) }
      catch (e) { setError(e instanceof Error ? e.message : '保存失败') } finally { setBusy(false) }
    }}>
      <label className="reward-toggle"><input type="checkbox" checked={settings.enabled} onChange={e => change({ enabled: e.target.checked })} /><span><strong>启用学习彩蛋</strong><small>所有学生共用规则，每人每天最多一次。</small></span></label>
      <p className="muted">关闭并保存会结束正在进行的游戏，撤销尚未使用的奖励；重新开启不会恢复旧奖励。</p>
      <div className="reward-setting-grid"><label>每次奖励时长（分钟）<input type="number" min={1} max={60} required value={settings.duration_minutes} onChange={e => change({ duration_minutes: e.target.valueAsNumber })} /></label>
        <label>最低练习题量<input type="number" min={1} max={10000} required value={settings.minimum_questions} onChange={e => change({ minimum_questions: e.target.valueAsNumber })} /></label>
        <label>解锁方式<select value={settings.mode} onChange={e => change({ mode: e.target.value as RewardSettings['mode'] })}><option value="score">按分数解锁</option><option value="random">达标后随机游戏</option></select></label>
        {settings.mode === 'random' ? <label>随机奖励门槛（百分制）<input type="number" min={0} max={100} required value={settings.random_threshold} onChange={e => change({ random_threshold: e.target.valueAsNumber })} /></label> : <>
          <label>星光冒险门槛（百分制）<input type="number" min={0} max={100} required value={settings.adventure_threshold} onChange={e => change({ adventure_threshold: e.target.valueAsNumber })} /></label>
          <label>卡丁赛车门槛（百分制）<input type="number" min={0} max={100} required value={settings.racer_threshold} onChange={e => change({ racer_threshold: e.target.valueAsNumber })} /></label></>}
      </div>
      <div className="reward-rule-preview"><strong>规则预览</strong><p>完成至少 {settings.minimum_questions || '—'} 题的整套练习或随机组题，{settings.mode === 'random' ? `达到 ${settings.random_threshold} 分必定随机获得一个游戏` : `达到 ${settings.adventure_threshold} 分解锁星光冒险，达到 ${settings.racer_threshold} 分解锁卡丁赛车`}，共享 {settings.duration_minutes || '—'} 分钟游戏时光。</p><p>当天领取，开始后连续计时。暂停和退出不延长时间；错题重练不参与。</p></div>
      <button className="primary" disabled={busy}><Save size={17} />{busy ? '正在保存…' : '保存设置'}</button>{saved && <span className="reward-saved" role="status">设置已保存</span>}
    </form>}
  </section>
}
