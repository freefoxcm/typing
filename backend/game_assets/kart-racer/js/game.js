(function () {
  'use strict';
  const C = globalThis.KartCore;
  const $ = id => document.getElementById(id);
  const dom = Object.fromEntries(['stage', 'game-canvas', 'loading', 'error-panel', 'error-message', 'start-button', 'race-hud', 'countdown', 'position', 'lap', 'race-time', 'lap-time', 'speed', 'speed-bar', 'drive-status', 'nitro-1', 'nitro-2', 'charge-bar', 'charge-label', 'minimap', 'map-title', 'leaderboard', 'pause-overlay', 'results-overlay', 'guide-overlay', 'toast', 'wrong-way', 'boost-vignette'].map(id => [id, $(id)]));
  function getSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(window.RewardBridge.storageKey('progress-v1')));
      return saved && typeof saved === 'object' ? saved : {};
    } catch { return {}; }
  }
  const saved = getSaved();
  let sound = saved.sound !== false, color = ['#f17b46', '#3fafa7', '#8596d3'].includes(saved.color) ? saved.color : '#f17b46';
  let selectedIndex = Math.max(0, KartTracks.findIndex(t => t.id === saved.track));
  const records = Object.create(null);
  for (const t of KartTracks) {
    const value = saved.records && saved.records[t.id];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1000000) records[t.id] = value;
  }
  function persist() {
    try { localStorage.setItem(window.RewardBridge.storageKey('progress-v1'), JSON.stringify({ sound, color, track: tracks[selectedIndex].id, records })); } catch { /* Private browsing or blocked storage does not prevent racing. */ }
  }
  const tracks = KartTracks.map(C.buildTrack), audio = new KartAudio(sound);
  let world = null, race = null, preview = true, accumulator = 0, previousFrame = 0, hudTimer = 0;
  let toastUntil = 0, goUntil = 0, shownCountdown = -1, resultShown = false, lastRankOrder = '', finishAudioUntil = 0, driftReadyUntil = 0;
  const driftFeedback = $('drift-feedback'), nitroPanel = $('nitro-panel');
  let guideReturnFocus = null;
  const keys = new Set(), gameKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyR', 'Escape']);
  const mapCtx = dom.minimap.getContext('2d');
  function mapTransform(track, width, height, padding) {
    const b = track.bounds, scale = Math.min((width - 2 * padding) / (b.maxX - b.minX), (height - 2 * padding) / (b.maxZ - b.minZ));
    return p => ({ x: width / 2 + (p.x - (b.minX + b.maxX) / 2) * scale, y: height / 2 - (p.z - (b.minZ + b.maxZ) / 2) * scale });
  }
  function pathTrack(ctx, track, transform) {
    ctx.beginPath(); track.samples.forEach((p, i) => { const q = transform(p); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }); ctx.closePath();
  }
  function thumbnail(canvas, track) {
    canvas.width = 190; canvas.height = 135;
    const ctx = canvas.getContext('2d'), to = mapTransform(track, 190, 135, 21);
    ctx.fillStyle = track.theme === 'coast' ? '#c4e2d7' : track.theme === 'forest' ? '#d0dbbf' : '#e6d3c0'; ctx.fillRect(0, 0, 190, 135);
    ctx.fillStyle = track.ground; ctx.beginPath(); ctx.ellipse(95, 73, 84, 69, -0.17, 0, Math.PI * 2); ctx.fill();
    pathTrack(ctx, track, to); ctx.lineJoin = 'round'; ctx.lineWidth = 16; ctx.strokeStyle = track.sand; ctx.stroke();
    pathTrack(ctx, track, to); ctx.lineWidth = 9; ctx.strokeStyle = '#677e72'; ctx.stroke();
    pathTrack(ctx, track, to); ctx.lineWidth = 0.7; ctx.strokeStyle = '#eef2d8'; ctx.setLineDash([2, 4]); ctx.stroke(); ctx.setLineDash([]);
    const p = to(track.samples[0]); ctx.fillStyle = '#fff6df'; ctx.fillRect(p.x - 4, p.y - 2, 8, 3);
    ctx.fillStyle = track.accent; ctx.beginPath(); ctx.arc(p.x, p.y - 1, 3.5, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 8; i++) { const x = 25 + i * 21 % 143, y = 12 + i * 37 % 101; ctx.fillStyle = i % 2 ? '#527d6377' : '#ffffff33'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
  }
  function buildTrackButtons() {
    const list = $('track-list');
    tracks.forEach((track, i) => {
      const button = document.createElement('button'); button.className = 'track-card'; button.dataset.track = track.id; button.setAttribute('aria-label', `${track.name}，${track.difficulty}`);
      const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); button.append(canvas); thumbnail(canvas, track);
      const text = document.createElement('span'), strong = document.createElement('strong'), small = document.createElement('small');
      strong.textContent = track.name;
      const difficulty = document.createElement('span'); difficulty.className = 'difficulty';
      for (let j = 0; j < 3; j++) { const bar = document.createElement('i'); if (j < track.level) bar.className = 'on'; difficulty.append(bar); }
      small.append(difficulty, document.createTextNode(track.difficulty)); text.append(strong, small); button.append(text);
      const check = document.createElement('span'); check.className = 'track-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true'); button.append(check);
      button.addEventListener('click', () => { if (preview) selectTrack(i); }); list.append(button);
    });
  }
  function updateSelection() {
    const track = tracks[selectedIndex];
    document.querySelectorAll('.track-card').forEach((button, i) => { button.classList.toggle('selected', i === selectedIndex); button.setAttribute('aria-pressed', String(i === selectedIndex)); });
    $('preview-title').textContent = track.name; $('preview-english').textContent = track.english;
    $('preview-description').textContent = track.description;
    $('preview-number').firstChild.textContent = String(selectedIndex + 1).padStart(2, '0');
    dom['map-title'].textContent = track.name;
    $('best-time').textContent = records[track.id] ? `个人最佳 ${C.formatTime(records[track.id])}` : '新的赛道，等你留下纪录';
    document.querySelectorAll('.color-choice').forEach(button => { button.classList.toggle('selected', button.dataset.color === color); button.setAttribute('aria-pressed', String(button.dataset.color === color)); });
  }
  function selectTrack(index) {
    selectedIndex = index; race = new C.Race(tracks[index], color); resultShown = false;
    updateSelection(); world.load(tracks[index], race); persist();
  }
  function toast(message, duration = 2200) { dom.toast.textContent = message; dom.toast.hidden = false; toastUntil = performance.now() + duration; }
  function startRace() {
    if (!window.RewardBridge.canPlay()) { window.RewardBridge.requestStart(); return; }
    if (!world || dom['guide-overlay'].hidden === false) return;
    void audio.unlock();
    keys.clear(); preview = false; resultShown = false; accumulator = 0; shownCountdown = -1; lastRankOrder = ''; finishAudioUntil = 0; goUntil = 0; driftReadyUntil = 0;
    race = new C.Race(tracks[selectedIndex], color); world.load(tracks[selectedIndex], race);
    race.start();
    document.body.classList.add('racing');
    dom['race-hud'].hidden = false; dom['pause-overlay'].hidden = true; dom['results-overlay'].hidden = true; dom.toast.hidden = true; dom['wrong-way'].hidden = true;
    dom.countdown.hidden = false; dom.countdown.querySelector('span').textContent = 'READY TO RACE'; dom.countdown.querySelector('p').textContent = '按住 ↑ 或 W，准备出发';
    dom['game-canvas'].focus({ preventScroll: true }); world.resize(); updateHud();
  }
  function returnMenu() {
    keys.clear(); preview = true; accumulator = 0; finishAudioUntil = 0; audio.silence();
    document.body.classList.remove('racing');
    ['race-hud', 'pause-overlay', 'results-overlay', 'countdown', 'toast', 'wrong-way'].forEach(id => dom[id].hidden = true);
    dom['boost-vignette'].classList.remove('active');
    selectTrack(selectedIndex); world.resize(); dom['start-button'].focus({ preventScroll: true });
  }
  function pauseRace() {
    if (!race || preview || !['racing', 'countdown'].includes(race.state)) return;
    race.pause(); keys.clear(); accumulator = 0; audio.silence();
    dom['pause-overlay'].hidden = false; dom.countdown.hidden = true; $('resume-button').focus({ preventScroll: true });
  }
  function resumeRace() {
    if (!window.RewardBridge.canPlay()) return;
    if (!race || race.state !== 'paused' || !dom['guide-overlay'].hidden) return;
    void audio.unlock(); race.resume(); keys.clear(); accumulator = 0;
    dom['pause-overlay'].hidden = true; dom.countdown.hidden = race.state !== 'countdown';
    dom['game-canvas'].focus({ preventScroll: true });
  }
  function showResults() {
    if (resultShown) return;
    resultShown = true; keys.clear(); const p = race.player, track = tracks[selectedIndex];
    const newRecord = !records[track.id] || p.finishTime < records[track.id];
    if (newRecord) { records[track.id] = p.finishTime; persist(); }
    $('results-title').textContent = p.finishPlace === 1 ? '冠军，非你莫属！' : '漂亮完赛！';
    $('result-subtitle').textContent = `${track.name} · ${p.finishPlace <= 3 ? '这趟兜风，值得庆祝。' : '下一个弯，继续超越。'}`;
    $('result-place').firstChild.textContent = p.finishPlace;
    $('result-time').textContent = C.formatTime(p.finishTime);
    $('record-label').textContent = newRecord ? '✦ 新的个人最佳纪录！' : `个人最佳 ${C.formatTime(records[track.id])}`;
    $('result-laps').replaceChildren();
    p.lapTimes.forEach((time, i) => { const li = document.createElement('li'), span = document.createElement('span'), strong = document.createElement('strong'); span.textContent = `第 ${i + 1} 圈`; strong.textContent = C.formatTime(time); li.append(span, strong); $('result-laps').append(li); });
    dom['results-overlay'].hidden = false; dom.countdown.hidden = true; dom.toast.hidden = true;
    $('again-button').focus({ preventScroll: true });
  }
  function drawMinimap() {
    const ctx = mapCtx, track = race.track, to = mapTransform(track, 280, 240, 28);
    ctx.clearRect(0, 0, 280, 240); pathTrack(ctx, track, to); ctx.lineWidth = 15; ctx.strokeStyle = '#f9ffe126'; ctx.lineJoin = 'round'; ctx.stroke();
    pathTrack(ctx, track, to); ctx.lineWidth = 3; ctx.strokeStyle = '#e8f2d98c'; ctx.stroke();
    const start = to(track.samples[0]); ctx.fillStyle = '#ffffff'; ctx.fillRect(start.x - 5, start.y - 2, 10, 4);
    for (const car of [...race.cars.slice(1), race.player]) {
      const p = to(car); ctx.beginPath(); ctx.arc(p.x, p.y, car.id === 0 ? 7.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = car.color; ctx.fill(); ctx.lineWidth = car.id === 0 ? 3 : 1; ctx.strokeStyle = '#fffae8'; ctx.stroke();
      if (car.id === 0) { ctx.beginPath(); ctx.moveTo(p.x + Math.sin(car.heading) * 13, p.y - Math.cos(car.heading) * 13); ctx.lineTo(p.x + Math.sin(car.heading + 2.2) * 5, p.y - Math.cos(car.heading + 2.2) * 5); ctx.lineTo(p.x + Math.sin(car.heading - 2.2) * 5, p.y - Math.cos(car.heading - 2.2) * 5); ctx.closePath(); ctx.fillStyle = '#fff7dd'; ctx.fill(); }
    }
  }
  function updateHud() {
    if (!race) return;
    const p = race.player, standings = race.standings();
    dom.position.textContent = p.finishPlace || standings.findIndex(c => c.id === 0) + 1;
    dom.lap.textContent = Math.min(3, p.lap); dom['race-time'].textContent = C.formatTime(race.elapsed);
    dom['lap-time'].textContent = '本圈 ' + C.formatTime(race.elapsed - p.lapStart);
    dom.speed.textContent = Math.round(Math.abs(p.speed) * 3.6); dom['speed-bar'].style.width = `${Math.min(100, Math.abs(p.speed) / 61 * 100)}%`;
    dom['drive-status'].textContent = race.state === 'countdown' ? '准备出发' : p.boost > 0 ? '氮气加速中 ↗' : p.drift ? '漂亮漂移 ✦' : Math.abs(p.lateral) > race.track.width / 2 ? '驶回路面，恢复速度' : p.speed < -0.5 ? '倒车中' : '享受这一路的风';
    dom['nitro-1'].classList.toggle('filled', p.nitro >= 1); dom['nitro-2'].classList.toggle('filled', p.nitro >= 2);
    dom['charge-bar'].style.width = `${p.nitro === 2 ? 100 : p.charge}%`;
    dom['charge-label'].textContent = p.nitro === 2 ? '氮气已满 · 空格释放' : p.drift ? `漂移集气 ${Math.floor(p.charge)}%` : '按住 Shift 转弯 · 漂移集气';
    const driftActive = race.state === 'racing' && p.drift;
    const justCharged = race.state === 'racing' && race.elapsed < driftReadyUntil;
    nitroPanel.classList.toggle('drifting', driftActive);
    nitroPanel.classList.toggle('drift-gold', p.charge >= 65 || p.nitro === 2 || justCharged);
    nitroPanel.classList.toggle('charge-ready', justCharged);
    driftFeedback.classList.toggle('active', driftActive || justCharged);
    driftFeedback.querySelector('strong').textContent = justCharged ? 'NITRO READY' : 'DRIFT';
    driftFeedback.querySelector('span').textContent = justCharged ? '氮气就绪 · 空格释放' : `持续 ${p.driftTime.toFixed(1)}s`;
    dom['boost-vignette'].classList.toggle('active', p.boost > 0 && race.state === 'racing');
    dom['wrong-way'].textContent = p.missedGate ? '漏过检查点，按 R 回到赛道' : '↶ 逆行啦！请掉头返回赛道';
    dom['wrong-way'].hidden = (!p.missedGate && p.wrongWay < 1.1) || race.state !== 'racing';
    const order = standings.map(c => c.id + (c.finishTime !== null ? 'f' : '')).join(',');
    if (order !== lastRankOrder) {
      lastRankOrder = order; dom.leaderboard.replaceChildren();
      standings.forEach((car, i) => {
        const li = document.createElement('li'); if (car.id === 0) li.className = 'player';
        const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = i + 1;
        const dot = document.createElement('i'); dot.className = 'racer-dot'; dot.style.setProperty('--car', car.color);
        li.append(rank, dot, document.createTextNode(car.name));
        if (car.finishTime !== null) { const tag = document.createElement('span'); tag.className = 'finished-tag'; tag.textContent = '完赛'; li.append(tag); }
        dom.leaderboard.append(li);
      });
    }
    if (race.state === 'countdown') {
      const count = Math.min(3, Math.max(1, Math.ceil(race.countdown)));
      if (count !== shownCountdown) { shownCountdown = count; dom.countdown.querySelector('strong').textContent = count; }
    }
    drawMinimap();
  }
  function handleEvents() {
    for (const event of race.drainEvents()) {
      if (event.id !== undefined && event.id !== 0) continue;
      audio.event(event.type);
      if (event.type === 'go') { dom.countdown.querySelector('strong').textContent = 'GO!'; dom.countdown.querySelector('span').textContent = 'MAKE IT A GOOD RIDE'; dom.countdown.querySelector('p').textContent = '向着下一阵风出发'; goUntil = performance.now() + 900; }
      if (event.type === 'charged') { world.driftBurst(); driftReadyUntil = race.elapsed + 0.85; toast('✦ 氮气就绪！按空格，全速出发'); }
      if (event.type === 'boost') toast('N₂O  氮气加速！', 950);
      if (event.type === 'lap') toast(event.lap === 3 ? '最后一圈！把快乐开到全速' : `第 ${event.lap} 圈，继续加油！`, 2000);
      if (event.type === 'reset') { world.cameraReady = false; world.resetDriftEffects(); driftReadyUntil = 0; toast('已回到赛道，重新出发', 1500); }
      if (event.type === 'finish') { finishAudioUntil = performance.now() + 1300; showResults(); }
    }
  }
  function input() {
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    return {
      throttle: keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0,
      brake: keys.has('ArrowDown') || keys.has('KeyS'),
      // Forward is +Z: positive yaw turns left in the rear-following camera.
      steer: Number(left) - Number(right),
      drift: keys.has('ShiftLeft') || keys.has('ShiftRight')
    };
  }
  function frame(now) {
    const dt = Math.min(0.1, previousFrame ? (now - previousFrame) / 1000 : 1 / 60); previousFrame = now;
    if (race && world) {
      if (!preview) {
        if (race.state === 'racing' || race.state === 'countdown') {
          accumulator += dt;
          while (accumulator >= 1 / 60) { race.step(1 / 60, input()); accumulator -= 1 / 60; }
          handleEvents();
        } else accumulator = 0;
        hudTimer += dt;
        if (hudTimer >= 0.07) { hudTimer = 0; updateHud(); }
        if (goUntil && now > goUntil) { dom.countdown.hidden = true; goUntil = 0; }
        if (toastUntil && now > toastUntil) { dom.toast.hidden = true; toastUntil = 0; }
      }
      audio.update(race.player, !preview && (race.state === 'racing' || race.state === 'countdown' || now < finishAudioUntil));
      if (!document.hidden) world.update(race, dt, preview);
    }
    requestAnimationFrame(frame);
  }
  function openGuide() {
    guideReturnFocus = document.activeElement;
    if (!preview) pauseRace();
    dom['guide-overlay'].hidden = false; $('close-guide').focus({ preventScroll: true });
  }
  function closeGuide() {
    dom['guide-overlay'].hidden = true;
    if (!preview && race && race.state === 'paused') $('resume-button').focus({ preventScroll: true });
    else if (guideReturnFocus) guideReturnFocus.focus({ preventScroll: true });
  }
  function updateSoundButton() {
    $('sound-button').setAttribute('aria-label', sound ? '关闭声音' : '开启声音'); $('sound-button').setAttribute('aria-pressed', String(sound));
    $('sound-button').querySelector('use').setAttribute('href', sound ? '#i-sound' : '#i-muted');
  }
  function showError(message) {
    dom.loading.hidden = true; dom['error-panel'].hidden = false; dom['error-message'].textContent = message;
    dom['start-button'].disabled = true; audio.silence();
    document.querySelectorAll('.track-card').forEach(button => { button.disabled = true; });
  }
  document.addEventListener('keydown', event => {
    // Keep keyboard focus inside the topmost modal, including Shift+Tab.
    const modal = !dom['guide-overlay'].hidden ? dom['guide-overlay'] : !dom['results-overlay'].hidden ? dom['results-overlay'] : !dom['pause-overlay'].hidden ? dom['pause-overlay'] : null;
    if (modal && event.code === 'Tab') {
      const focusable = [...modal.querySelectorAll('button:not([disabled]),a[href],[tabindex="0"]')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
      return;
    }
    if (event.code === 'Escape') {
      event.preventDefault(); if (event.repeat) return;
      if (!dom['guide-overlay'].hidden) closeGuide();
      else if (race && race.state === 'paused') resumeRace();
      else pauseRace();
      return;
    }
    if (preview || modal || !race) return;
    if (gameKeys.has(event.code)) event.preventDefault();
    keys.add(event.code);
    if (!event.repeat && event.code === 'Space') { if (!race.useNitro() && race.state === 'racing') toast(race.player.boost > 0 ? '正在加速，稍等一下' : '先按住 Shift 转向漂移，集满氮气', 1800); }
    if (!event.repeat && event.code === 'KeyR') race.resetCar();
  });
  document.addEventListener('keyup', event => { keys.delete(event.code); if (!preview && gameKeys.has(event.code)) event.preventDefault(); });
  window.addEventListener('blur', () => { keys.clear(); pauseRace(); audio.silence(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); pauseRace(); audio.silence(); } });
  dom['game-canvas'].addEventListener('webglcontextlost', event => { event.preventDefault(); pauseRace(); window.RewardBridge.error('显卡连接中断，请重新准备游戏'); showError('显卡连接暂时中断，请重新加载页面恢复比赛。'); });
  $('start-button').addEventListener('click', startRace);
  $('pause-button').addEventListener('click', pauseRace); $('resume-button').addEventListener('click', resumeRace);
  $('restart-button').addEventListener('click', startRace); $('again-button').addEventListener('click', startRace);
  $('menu-button').addEventListener('click', returnMenu); $('results-menu-button').addEventListener('click', returnMenu);
  $('guide-button').addEventListener('click', openGuide); $('more-guide').addEventListener('click', openGuide);
  $('close-guide').addEventListener('click', closeGuide); $('guide-done').addEventListener('click', closeGuide);
  dom['guide-overlay'].addEventListener('click', event => { if (event.target === dom['guide-overlay']) closeGuide(); });
  $('sound-button').addEventListener('click', () => { sound = !sound; audio.setEnabled(sound); updateSoundButton(); persist(); });
  $('fullscreen-button').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('可使用浏览器的全屏功能', 2500);
    } catch { toast('浏览器暂不允许全屏，可使用窗口模式游玩', 2500); }
  });
  document.addEventListener('fullscreenchange', () => { $('fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '全屏游戏'); });
  document.querySelectorAll('.color-choice').forEach(button => button.addEventListener('click', () => { if (!preview) return; color = button.dataset.color; if (race) race.player.color = color; if (world) world.setColor(color); updateSelection(); persist(); }));
  buildTrackButtons(); updateSelection(); updateSoundButton();
  try {
    if (!globalThis.KartWorld) throw new Error('引擎文件未加载，请保留 vendor 文件夹，并使用解压后的完整游戏文件夹打开 index.html。');
    world = new KartWorld(dom['game-canvas']); selectTrack(selectedIndex); dom.loading.hidden = true; dom['start-button'].disabled = false;
    requestAnimationFrame(frame);
    window.RewardBridge.ready({help:openGuide,start:()=>race?.state==='paused'?resumeRace():startRace(),pause:pauseRace,mute:(value)=>{sound=!value;audio.setEnabled(!value);},destroy:()=>audio.silence()});
  } catch (error) {
    console.error('Breeze Kart initialization failed:', error);
    window.RewardBridge.error('这台设备暂时无法启动赛车的 3D 画面，请检查硬件加速。');
    showError(error.message.includes('引擎文件') ? error.message : '这台设备暂时无法启动 3D 画面。请使用支持 WebGL 2 的新版 Chrome、Edge、Firefox 或 Safari，并启用硬件加速。');
  }
  // Read-only diagnostics for QA. No test-only race controls are shipped to players.
  Object.defineProperty(window, '__kart', { value: Object.freeze({
    snapshot: () => race ? { state: race.state, preview, track: race.track.id, elapsed: race.elapsed, countdown: race.countdown,
      player: { ...race.player, lapTimes: [...race.player.lapTimes] }, standings: race.standings().map(c => ({ id: c.id, lap: c.lap, nextGate: c.nextGate, finishTime: c.finishTime })),
      render: world ? world.stats() : null, audio: { enabled: sound, available: audio.available, state: audio.context?.state || 'locked' } } : null
  }), writable: false });
})();
