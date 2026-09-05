/* Loaded before the engines. Preview may render, but only a live host lease enables play. */
(() => {
  'use strict';
  const context = window.rewardContext;
  let hooks, authorized = false, stopped = false, frozen = false, until = 0, deadline = 0;
  const origin = location.origin;
  const emit = (type, extra = {}) => {
    if (context && parent !== window) parent.postMessage({ channel: 'typing-reward', instanceId: context.instanceId, gameId: context.gameId, type, ...extra }, origin);
  };
  const storageKey = name => `typing:${context?.childId ?? 'none'}:${context?.gameId ?? 'none'}:${name}`;
  const nativeRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => nativeRaf(function frame(now) {
    if (stopped) return;
    if (frozen) return nativeRaf(frame);
    callback(now);
  });
  const lock = () => {
    authorized = false;
    hooks?.pause();
    hooks?.mute(true);
    frozen = true;
  };
  window.RewardBridge = {
    storageKey,
    canPlay: () => authorized && !stopped && performance.now() < until && performance.now() < deadline,
    requestStart: () => emit('request-start'),
    ready(api) { hooks = api; api.mute(true); emit('ready'); },
    error(message) { emit('error', { message }); },
  };
  window.addEventListener('message', event => {
    const data = event.data;
    if (!context || event.source !== parent || parent === window || event.origin !== origin || data?.channel !== 'typing-reward' || data.instanceId !== context.instanceId) return;
    if (data.type === 'authorize' && typeof data.remainingMs === 'number' && data.remainingMs > 0 && !stopped) {
      authorized = true; frozen = false;
      until = performance.now() + 15000;
      deadline = performance.now() + data.remainingMs;
      hooks?.mute(Boolean(data.muted));
      if (data.start) hooks?.start();
    } else if (data.type === 'help') hooks?.help?.();
    else if (data.type === 'pause') lock();
    else if (data.type === 'mute') hooks?.mute(Boolean(data.muted));
    else if (data.type === 'destroy') { lock(); stopped = true; hooks?.destroy?.(); }
  });
  const watchdog = setInterval(() => {
    if (stopped) { clearInterval(watchdog); return; }
    if (authorized && (performance.now() >= until || performance.now() >= deadline)) { lock(); emit('lease-lost'); }
  }, 200);
  document.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open], #guide-overlay:not([hidden])')) return;
    if (!window.RewardBridge.canPlay() && ['Space','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD','KeyP','Escape'].includes(event.code)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.code === 'Enter' || event.code === 'Space') emit('request-start');
    }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (!window.RewardBridge.canPlay() && event.target.closest?.('[data-key]')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('pagehide', () => { lock(); stopped = true; clearInterval(watchdog); });
  window.addEventListener('error', () => emit('error', { message: '游戏未能正常加载，请重新准备游戏。' }), { once: true });
})();
