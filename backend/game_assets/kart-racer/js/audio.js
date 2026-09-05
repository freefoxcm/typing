(function (root) {
  'use strict';
  class KartAudio {
    constructor(enabled = true) { this.enabled = enabled; this.context = null; this.available = true; }
    async unlock() {
      if (!this.enabled || !this.available) return;
      try {
        if (!this.context) {
          const AudioContext = root.AudioContext || root.webkitAudioContext;
          if (!AudioContext) { this.available = false; return; }
          this.context = new AudioContext();
          const ctx = this.context;
          this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
          this.engine = ctx.createOscillator(); this.engine.type = 'sawtooth'; this.engine.frequency.value = 55;
          this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
          const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 350; filter.Q.value = 0.5;
          this.engine.connect(filter); filter.connect(this.engineGain); this.engineGain.connect(this.master); this.engine.start();
          const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), values = buffer.getChannelData(0);
          for (let i = 0; i < values.length; i++) values[i] = Math.random() * 2 - 1;
          this.noise = ctx.createBufferSource(); this.noise.buffer = buffer; this.noise.loop = true;
          this.noiseFilter = ctx.createBiquadFilter(); this.noiseFilter.type = 'bandpass'; this.noiseFilter.frequency.value = 1600; this.noiseFilter.Q.value = 0.65;
          this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
          this.noise.connect(this.noiseFilter); this.noiseFilter.connect(this.noiseGain); this.noiseGain.connect(this.master); this.noise.start();
        }
        if (this.context.state === 'suspended') await this.context.resume();
      } catch { this.available = false; }
    }
    setEnabled(enabled) { this.enabled = enabled; if (enabled) void this.unlock(); else this.silence(); }
    silence() { if (this.context && this.master) this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.025); }
    update(car, active) {
      if (!this.context || !this.master || this.context.state !== 'running') return;
      const now = this.context.currentTime, on = active && this.enabled;
      this.master.gain.setTargetAtTime(on ? 0.2 : 0, now, 0.08);
      this.engine.frequency.setTargetAtTime(48 + Math.abs(car.speed) * 2.5 + (car.boost > 0 ? 20 : 0), now, 0.09);
      this.engineGain.gain.setTargetAtTime(on ? 0.12 + Math.abs(car.speed) / 800 : 0, now, 0.09);
      this.noiseGain.gain.setTargetAtTime(on ? (car.drift ? 0.24 : car.boost > 0 ? 0.2 : Math.abs(car.speed) * 0.001) : 0, now, 0.06);
      this.noiseFilter.frequency.setTargetAtTime(car.drift ? 1500 + car.charge * 6 : car.boost > 0 ? 650 : 400, now, 0.1);
    }
    tone(frequency = 660, duration = 0.16, delay = 0, type = 'sine') {
      if (!this.enabled || !this.context || !this.master || this.context.state !== 'running') return;
      const ctx = this.context, start = ctx.currentTime + delay, oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.type = type; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.23, start + 0.009); gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain); gain.connect(this.master); oscillator.start(start); oscillator.stop(start + duration + 0.02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
    event(type) {
      if (type === 'count') this.tone(520, 0.13);
      if (type === 'go') this.tone(1040, 0.4);
      if (type === 'charged') { this.tone(780, 0.13); this.tone(1170, 0.25, 0.1); }
      if (type === 'lap') { this.tone(660, 0.16); this.tone(880, 0.2, 0.12); }
      if (type === 'bump') this.tone(75, 0.1, 0, 'triangle');
      if (type === 'finish') [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.36, i * 0.12));
    }
  }
  root.KartAudio = KartAudio;
})(globalThis);
