(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const mod = (n, d) => ((n % d) + d) % d;
  const angleDelta = (a, b) => mod(a - b + Math.PI, TAU) - Math.PI;
  const lerp = (a, b, t) => a + (b - a) * t;
  const approach = (a, b, dt, rate) => lerp(a, b, 1 - Math.exp(-rate * dt));
  function spline(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function buildTrack(config) {
    const raw = [], points = config.points, n = points.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 64; j++) {
        const p = [points[mod(i - 1, n)], points[i], points[(i + 1) % n], points[(i + 2) % n]];
        raw.push({ x: spline(p[0][0], p[1][0], p[2][0], p[3][0], j / 64), z: spline(p[0][1], p[1][1], p[2][1], p[3][1], j / 64) });
      }
    }
    raw.push({ ...raw[0] });
    const cumulative = [0];
    for (let i = 1; i < raw.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z));
    const length = cumulative[cumulative.length - 1], count = 720, samples = [];
    let index = 0;
    for (let i = 0; i < count; i++) {
      const s = i * length / count;
      while (cumulative[index + 1] < s) index++;
      const f = (s - cumulative[index]) / (cumulative[index + 1] - cumulative[index]);
      samples.push({ x: lerp(raw[index].x, raw[index + 1].x, f), z: lerp(raw[index].z, raw[index + 1].z, f), s });
    }
    for (let i = 0; i < count; i++) {
      const prev = samples[mod(i - 1, count)], next = samples[(i + 1) % count];
      const dx = next.x - prev.x, dz = next.z - prev.z, d = Math.hypot(dx, dz);
      Object.assign(samples[i], { tx: dx / d, tz: dz / d, rx: dz / d, rz: -dx / d, heading: Math.atan2(dx, dz) });
    }
    const bounds = { minX: Math.min(...samples.map(p => p.x)), maxX: Math.max(...samples.map(p => p.x)), minZ: Math.min(...samples.map(p => p.z)), maxZ: Math.max(...samples.map(p => p.z)) };
    return { ...config, samples, length, bounds, gateCount: 12 };
  }
  function sample(track, distance, offset = 0) {
    const u = mod(distance, track.length) / track.length * track.samples.length;
    const i = Math.floor(u), t = u - i;
    const a = track.samples[i], b = track.samples[(i + 1) % track.samples.length];
    const heading = a.heading + angleDelta(b.heading, a.heading) * t;
    const tx = Math.sin(heading), tz = Math.cos(heading);
    return { x: lerp(a.x, b.x, t) + tz * offset, z: lerp(a.z, b.z, t) - tx * offset, tx, tz, rx: tz, rz: -tx, heading, s: mod(distance, track.length) };
  }
  function project(track, x, z) {
    let best = Infinity, result;
    const n = track.samples.length;
    for (let i = 0; i < n; i++) {
      const a = track.samples[i], b = track.samples[(i + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < best) {
        best = d2;
        const d = Math.hypot(dx, dz);
        result = { x: px, z: pz, s: mod((i + t) / n * track.length, track.length), lateral: (x - px) * dz / d - (z - pz) * dx / d, heading: Math.atan2(dx, dz), distance: Math.sqrt(d2) };
      }
    }
    return result;
  }
  const COLORS = ['#f17b46', '#3fafa7', '#f1be4b', '#8596d3', '#e486a4', '#90b56b'];
  const NAMES = ['你', '小风', '橘子', '阿森', '泡泡', '闪电'];
  class Race {
    constructor(track, color = COLORS[0]) {
      this.track = track;
      this.state = 'ready'; this.elapsed = 0; this.countdown = 3.4; this.laps = 3;
      this.events = []; this.finishedCount = 0;
      this.cars = Array.from({ length: 6 }, (_, id) => {
        const progress = -8 - Math.floor(id / 2) * 7;
        const pos = sample(track, progress, id % 2 ? 2.1 : -2.1);
        return { id, name: NAMES[id], color: id === 0 ? color : COLORS[id], x: pos.x, z: pos.z,
          heading: pos.heading, velocityHeading: pos.heading, speed: 0, steer: 0, drift: false,
          driftTime: 0, charge: 0, nitro: 0, boost: 0, progress, nextGate: 0,
          lastS: mod(progress, track.length), lateral: id % 2 ? 2.1 : -2.1, lap: 1,
          finishTime: null, finishPlace: null, lapTimes: [], lapStart: 0, bump: 0,
          resetCooldown: 0, wrongWay: 0, missedGate: false, lastSafeProgress: progress,
          aiLane: (id % 3 - 1) * 2.2, aiPace: 0.83 + id * 0.021 };
      });
    }
    get player() { return this.cars[0]; }
    start() { if (this.state === 'ready') this.state = 'countdown'; }
    pause() { if (this.state === 'racing' || this.state === 'countdown') { this.resumeState = this.state; this.state = 'paused'; } }
    resume() { if (this.state === 'paused') this.state = this.resumeState; }
    useNitro(car = this.player) {
      if (this.state !== 'racing' || car.finishTime !== null || car.nitro < 1 || car.boost > 0) return false;
      car.nitro--; car.boost = 2.3;
      this.events.push({ type: 'boost', id: car.id });
      return true;
    }
    resetCar(car = this.player) {
      if (this.state !== 'racing' || car.finishTime !== null || car.resetCooldown > 0) return false;
      // Reposition at or behind the last validated gate; reset cannot skip a gate.
      const gate = Math.max(0, car.nextGate - 1) * this.track.length / this.track.gateCount;
      const progress = Math.min(car.lastSafeProgress, gate + this.track.length / this.track.gateCount - 4);
      const p = sample(this.track, progress);
      Object.assign(car, { x: p.x, z: p.z, heading: p.heading, velocityHeading: p.heading, speed: 0, drift: false,
        progress, lastS: p.s, lateral: 0, boost: 0, resetCooldown: 2.2, wrongWay: 0, missedGate: false });
      this.events.push({ type: 'reset', id: car.id });
      return true;
    }
    aiInput(car) {
      const here = sample(this.track, car.progress);
      const ahead = sample(this.track, car.progress + 12 + Math.max(0, car.speed) * 0.38, car.aiLane);
      const later = sample(this.track, car.progress + 34);
      const delta = angleDelta(Math.atan2(ahead.x - car.x, ahead.z - car.z), car.heading);
      const curve = Math.abs(angleDelta(later.heading, here.heading));
      const target = clamp(43 - curve * 22, 19, 41) * car.aiPace;
      return { throttle: car.speed < target ? 1 : 0, brake: car.speed > target + 2, steer: clamp(delta * 2.2, -1, 1), drift: curve > 0.33 && curve < 1.35 && car.speed > 21 && Math.abs(delta) < 0.7 };
    }
    step(dt, input = {}) {
      if (this.state === 'countdown') {
        const before = Math.ceil(this.countdown);
        this.countdown -= dt;
        if (Math.ceil(this.countdown) !== before) this.events.push({ type: 'count', value: Math.max(0, Math.ceil(this.countdown)) });
        if (this.countdown <= 0) { this.state = 'racing'; this.events.push({ type: 'go' }); }
        return;
      }
      if (this.state !== 'racing') return;
      this.elapsed += dt;
      for (const car of this.cars) {
        if (car.finishTime !== null) { car.speed *= Math.exp(-dt * 2); continue; }
        const controls = car.id === 0 ? input : this.aiInput(car);
        if (car.id && car.nitro && car.boost <= 0 && Math.abs(controls.steer) < 0.15 && car.speed > 25) this.useNitro(car);
        this.drive(car, controls, dt);
      }
      this.collisions();
      for (const car of this.cars) {
        if (car.finishTime === null) this.updateProgress(car, dt);
      }
      if (this.player.finishTime !== null) { this.state = 'finished'; this.events.push({ type: 'finish' }); }
    }
    drive(car, input, dt) {
      car.bump = Math.max(0, car.bump - dt);
      car.resetCooldown = Math.max(0, car.resetCooldown - dt);
      car.boost = Math.max(0, car.boost - dt);
      const oldDrift = car.drift;
      const desiredSteer = clamp(Number(input.steer) || 0, -1, 1);
      // Player steering ramps up faster than AI: digital keys need a snappier lock.
      car.steer = approach(car.steer, desiredSteer, dt, car.id === 0 ? 18 : 10);
      car.drift = Boolean(input.drift && car.speed > 14 && Math.abs(car.steer) > 0.16 && Math.abs(car.lateral) < this.track.width / 2);
      const offroad = Math.abs(car.lateral) > this.track.width / 2;
      const top = offroad ? 19 : car.boost > 0 ? 61 : 42;
      const throttle = clamp(Number(input.throttle) || 0, 0, 1);
      if (throttle) car.speed += (car.boost > 0 ? 34 : 20) * throttle * dt;
      else car.speed = approach(car.speed, 0, dt, 0.36);
      if (input.brake) car.speed -= (car.speed > 1 ? 42 : 12) * dt;
      car.speed -= car.speed * (car.drift ? 0.16 : 0.06) * dt;
      if (car.speed > top) car.speed = approach(car.speed, top, dt, offroad ? 4 : 2.8);
      car.speed = clamp(car.speed, -9, 64);
      if (Math.abs(car.speed) < 0.02) car.speed = 0;
      const speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
      const turnRate = (1.15 - clamp(Math.abs(car.speed) / 70, 0, 0.65)) * (car.drift ? 1.65 : 1) * (car.id === 0 ? 1.25 : 1);
      car.heading += car.steer * turnRate * speedFactor * dt * (car.speed < 0 ? -1 : 1);
      const slipTarget = car.heading - (car.drift ? car.steer * 0.37 : 0);
      car.velocityHeading += angleDelta(slipTarget, car.velocityHeading) * (1 - Math.exp(-dt * (car.drift ? 5.5 : 12)));
      car.x += Math.sin(car.velocityHeading) * car.speed * dt;
      car.z += Math.cos(car.velocityHeading) * car.speed * dt;
      if (car.drift) {
        car.driftTime += dt;
        if (car.nitro < 2) {
          car.charge += dt * (22 + Math.abs(car.steer) * 12);
          if (car.charge >= 100) {
            car.charge -= 100; car.nitro++;
            this.events.push({ type: 'charged', id: car.id });
            if (car.nitro === 2) car.charge = 0;
          }
        }
      } else { car.driftTime = 0; }
      if (oldDrift && !car.drift && car.id === 0) this.events.push({ type: 'driftEnd', id: car.id });
    }
    collisions() {
      for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i], b = this.cars[j];
        if (a.finishTime !== null || b.finishTime !== null) continue;
        let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < 2.25) {
          if (d < 0.001) { dx = 1; dz = 0; d = 1; }
          const push = (2.25 - d) / 2;
          a.x -= dx / d * push; a.z -= dz / d * push;
          b.x += dx / d * push; b.z += dz / d * push;
          if (a.bump <= 0 && b.bump <= 0) {
            a.speed *= 0.87; b.speed *= 0.87; a.bump = b.bump = 0.6;
            this.events.push({ type: 'bump', id: a.id });
          }
        }
      }
    }
    updateProgress(car, dt) {
      let p = project(this.track, car.x, car.z), half = this.track.width / 2;
      car.lateral = p.lateral;
      let delta = p.s - car.lastS;
      if (delta > this.track.length / 2) delta -= this.track.length;
      if (delta < -this.track.length / 2) delta += this.track.length;
      // Nearest-segment switches and teleports never grant race distance.
      if (Math.abs(delta) <= Math.max(5, Math.abs(car.speed) * dt * 2 + 1)) car.progress += delta;
      car.lastS = p.s;
      if (Math.abs(p.lateral) > half + 3.3) {
        const pos = sample(this.track, p.s, Math.sign(p.lateral) * (half + 3.25));
        car.x = pos.x; car.z = pos.z;
        if (car.bump <= 0) {
          car.speed *= 0.52; car.bump = 0.7;
          this.events.push({ type: 'bump', id: car.id });
        }
        car.velocityHeading += angleDelta(p.heading, car.velocityHeading) * 0.24;
        // Re-project so gate checks below use the post-clamp position.
        p = project(this.track, car.x, car.z); car.lateral = p.lateral;
      }
      const gateSpacing = this.track.length / this.track.gateCount;
      const nextDistance = car.nextGate * gateSpacing;
      const crossedForward = delta > 0 && car.progress >= nextDistance && car.progress - delta < nextDistance;
      // Gate tolerance matches the physical wall (half + 3.3): any position the
      // car can actually reach counts, so running wide no longer silently misses a gate.
      if (crossedForward && Math.abs(p.lateral) <= half + 3.3) {
        if (car.nextGate > 0 && car.nextGate % this.track.gateCount === 0) {
          car.lapTimes.push(this.elapsed - car.lapStart); car.lapStart = this.elapsed;
          if (car.nextGate === this.track.gateCount * this.laps) {
            car.finishTime = this.elapsed; car.finishPlace = ++this.finishedCount;
            this.events.push({ type: 'carFinish', id: car.id });
          } else {
            car.lap++; this.events.push({ type: 'lap', id: car.id, lap: car.lap });
          }
        }
        car.nextGate++;
      }
      // Safe respawn only follows progress that has passed every preceding gate.
      if (Math.abs(p.lateral) < half && car.progress < car.nextGate * gateSpacing && car.progress > (car.nextGate - 1) * gateSpacing) car.lastSafeProgress = car.progress;
      car.missedGate = car.finishTime === null && car.progress > car.nextGate * gateSpacing + 4;
      car.wrongWay = car.speed > 4 && Math.cos(angleDelta(car.velocityHeading, p.heading)) < -0.35 ? car.wrongWay + dt : Math.max(0, car.wrongWay - dt * 2);
      if (car.id && (Math.abs(p.lateral) > half + 2 || car.wrongWay > 1.2 || car.missedGate)) this.resetCar(car);
    }
    standings() {
      const spacing = this.track.length / this.track.gateCount;
      const score = c => c.nextGate === 0 ? c.progress : Math.min(c.progress, c.nextGate * spacing);
      return [...this.cars].sort((a, b) => {
        if (a.finishTime !== null && b.finishTime !== null) return a.finishPlace - b.finishPlace;
        if (a.finishTime !== null) return -1;
        if (b.finishTime !== null) return 1;
        return score(b) - score(a) || a.id - b.id;
      });
    }
    drainEvents() { const events = this.events; this.events = []; return events; }
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    const ms = Math.floor(Math.max(0, seconds) * 1000);
    return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  }
  const api = { Race, buildTrack, sample, project, clamp, lerp, mod, angleDelta, approach, formatTime, COLORS };
  root.KartCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
