'use strict';
// Audio is created only in response to a player's interaction.
window.GameAudio = (() => {
  let context, master, enabled = true, nextBeat = 0, beat = 0, world = -1;
  let resuming = false;
  const musicVoices = new Set();
  const melodies = [
    [76,79,81,79,76,72,74,76,79,0,76,74,72,74,76,0],
    [69,72,73,76,73,72,69,0,67,69,72,69,67,64,67,0],
    [76,0,79,83,81,79,76,0,74,0,78,81,79,78,74,0],
    [57,60,64,63,60,57,59,0,56,59,62,65,64,62,59,0]
  ];
  const tempos = [.19, .22, .27, .17];
  function unlock() {
    if (!enabled) return;
    try {
      if (!context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        context = new Audio();
        master = context.createGain();
        master.gain.value = .65;
        master.connect(context.destination);
      }
      if (context.state === 'suspended' && !resuming) {
        resuming = true;
        Promise.resolve(context.resume()).catch(() => {}).finally(() => { resuming = false; });
      }
    } catch { /* Gameplay remains available when audio is unavailable. */ }
  }
  function tone(frequency, duration, when, volume, type, music = false) {
    if (!enabled || !context || context.state !== 'running') return;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, when);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(volume, when + .008);
    gain.gain.exponentialRampToValueAtTime(.001, when + duration);
    oscillator.connect(gain); gain.connect(master);
    if (music) musicVoices.add(oscillator);
    oscillator.onended = () => {
      musicVoices.delete(oscillator);
      oscillator.disconnect(); gain.disconnect();
    };
    oscillator.start(when); oscillator.stop(when + duration + .015);
  }
  function stopMusic() {
    for (const voice of musicVoices) { try { voice.stop(); } catch {} }
    musicVoices.clear(); nextBeat = 0; beat = 0;
  }
  function setEnabled(value) {
    enabled = value;
    if (master) master.gain.setValueAtTime(enabled ? .65 : 0, context.currentTime);
    if (!enabled) stopMusic();
    else unlock();
  }
  function effect(frequency = 520, duration = .09) {
    if (context) tone(frequency, duration, context.currentTime, .12, 'square');
  }
  function tick(playing, worldIndex) {
    if (!playing || !enabled) { if (nextBeat || musicVoices.size) stopMusic(); return; }
    if (!context || context.state !== 'running') return;
    if (world !== worldIndex) { stopMusic(); world = worldIndex; }
    const now = context.currentTime, step = tempos[world];
    if (!nextBeat || nextBeat < now - .25) nextBeat = now + .015;
    while (nextBeat < now + .1) {
      const note = melodies[world][beat % 16];
      if (note) tone(440 * 2 ** ((note - 69) / 12), step * .8, nextBeat, .065, world === 2 ? 'triangle' : 'square', true);
      if (beat % 2 === 0) {
        const bass = [48,45,52,33][world] + (beat % 8 >= 4 ? 7 : 0);
        tone(440 * 2 ** ((bass - 69) / 12), step * 1.5, nextBeat, .10, 'triangle', true);
      }
      beat++; nextBeat += step;
    }
  }
  return { unlock, setEnabled, effect, tick, stopMusic };
})();
