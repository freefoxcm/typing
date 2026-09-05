(function (root) {
  'use strict';
  const T = root.THREE, C = root.KartCore;
  if (!T) return;
  function random(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  class World {
    constructor(canvas) {
      this.canvas = canvas;
      this.motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = this.motionPreference.matches;
      this.motionPreference.addEventListener('change', () => {
        this.reducedMotion = this.motionPreference.matches;
        if (this.sparkFX) this.resetDriftEffects();
      });
      this.effectDensity = (navigator.deviceMemory !== undefined ? navigator.deviceMemory <= 2 : navigator.hardwareConcurrency <= 4) ? 0.55 : 1;
      this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.24;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(49, 1, 0.2, 1800);
      this.cameraPosition = new T.Vector3(); this.cameraTarget = new T.Vector3(); this.cameraHeading = 0;
      this.ambient = new T.HemisphereLight('#f6fff7', '#819779', 2.1);
      this.scene.add(this.ambient);
      this.sun = new T.DirectionalLight('#fff4d5', 3.1);
      this.sun.position.set(-60, 100, 55);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 400;
      this.sun.shadow.camera.left = -70; this.sun.shadow.camera.right = 70;
      this.sun.shadow.camera.top = 70; this.sun.shadow.camera.bottom = -70;
      this.sun.shadow.bias = -0.00035;
      this.sun.shadow.normalBias = 0.12;
      this.scene.add(this.sun, this.sun.target);
      this.level = null; this.carModels = []; this.materials = new Map();
      this.clock = 0; this.lastWidth = 0; this.lastHeight = 0;
      this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas.parentElement);
      this.resize();
    }
    material(color, options = {}) {
      const key = color + JSON.stringify(options);
      if (!this.materials.has(key)) this.materials.set(key, new T.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.02, ...options }));
      return this.materials.get(key);
    }
    mesh(geometry, color, x = 0, y = 0, z = 0, parent = this.level) {
      const mesh = new T.Mesh(geometry, typeof color === 'string' ? this.material(color) : color);
      mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
    }
    box(w, h, d, color, x, y, z, parent = this.level) { return this.mesh(new T.BoxGeometry(w, h, d), color, x, y, z, parent); }
    ball(r, color, x, y, z, parent = this.level, detail = 1) { return this.mesh(new T.IcosahedronGeometry(r, detail), color, x, y, z, parent); }
    rounded(w, h, d, color, x, y, z, parent) {
      const radius = Math.min(w, h, d) * 0.22;
      const shape = new T.Shape();
      shape.moveTo(-w / 2 + radius, -h / 2);
      shape.lineTo(w / 2 - radius, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + radius);
      shape.lineTo(w / 2, h / 2 - radius); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - radius, h / 2);
      shape.lineTo(-w / 2 + radius, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - radius);
      shape.lineTo(-w / 2, -h / 2 + radius); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + radius, -h / 2);
      const geometry = new T.ExtrudeGeometry(shape, { depth: d - radius * 2, bevelEnabled: true, bevelSize: radius, bevelThickness: radius, bevelSegments: 3, steps: 1, curveSegments: 4 });
      geometry.translate(0, 0, -d / 2 + radius);
      return this.mesh(geometry, color, x, y, z, parent);
    }
    clear() {
      if (!this.level) return;
      const geometries = new Set(), materials = new Set(), textures = new Set();
      for (const group of [this.level, this.carsGroup, this.effectsGroup]) {
        group.traverse(obj => { if (obj.geometry) geometries.add(obj.geometry); if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => { materials.add(m); if (m.map) textures.add(m.map); }); });
        this.scene.remove(group);
      }
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
      this.materials.clear(); this.carModels = [];
    }
    load(track, race) {
      this.clear(); this.track = track; this.race = race;
      this.level = new T.Group(); this.carsGroup = new T.Group(); this.effectsGroup = new T.Group();
      this.scene.add(this.level, this.carsGroup, this.effectsGroup);
      this.scene.background = new T.Color(track.sky); this.scene.fog = new T.Fog(track.fog, 140, 440);
      this.ambient.groundColor.set(track.theme === 'city' ? '#ac9988' : '#7f9874');
      this.sun.color.set(track.theme === 'city' ? '#ffd4a0' : '#fff3d0');
      const { minX, maxX, minZ, maxZ } = track.bounds;
      this.center = new T.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
      const water = this.mesh(new T.PlaneGeometry(2400, 2400), track.water, this.center.x, -0.75, this.center.z);
      water.rotation.x = -Math.PI / 2; water.castShadow = false;
      const rx = (maxX - minX) / 2 + 49, rz = (maxZ - minZ) / 2 + 49;
      const island = this.mesh(new T.CylinderGeometry(1, 1.015, 2, 96), track.sand, this.center.x, -1, this.center.z);
      island.scale.set(rx + 7, 1, rz + 7);
      const grass = this.mesh(new T.CylinderGeometry(1, 1.018, 0.5, 96), track.ground, this.center.x, -0.16, this.center.z);
      grass.scale.set(rx, 1, rz);
      this.road();
      const rand = random(track.seed);
      for (let i = 0; i < 210; i++) {
        const x = minX - 30 + rand() * (maxX - minX + 60), z = minZ - 30 + rand() * (maxZ - minZ + 60);
        if (((x - this.center.x) / (rx - 12)) ** 2 + ((z - this.center.z) / (rz - 12)) ** 2 > 1) continue;
        if (C.project(track, x, z).distance < track.width / 2 + 8) continue;
        if (Math.abs(x) < 16 && z > -35 && z < 35) continue;
        if (track.theme === 'coast') {
          if (i % 5 === 0) this.hut(x, z, rand);
          else if (i % 3 === 0) this.rock(x, z, rand);
          else this.palm(x, z, 0.7 + rand() * 0.9, rand);
        } else if (track.theme === 'forest') {
          if (i % 7 === 0) this.rock(x, z, rand);
          else this.pine(x, z, 0.8 + rand() * 1.1, rand);
        } else {
          if (i % 4 === 0) this.roundTree(x, z, 0.8 + rand() * 0.4);
          else if (i % 2 === 0) this.building(x, z, rand);
        }
      }
      // Small details at the start make the preview an actual piece of the track.
      this.gantry();
      this.billboard(-13.2, 17, 'BREEZE', '#ec824e', 0.1);
      this.billboard(13.2, 39, 'GOOD VIBES', track.dark, -0.15);
      for (let i = 0; i < 17; i++) {
        const theta = i * Math.PI * 2 / 17;
        const x = this.center.x + Math.cos(theta) * (rx + 55 + rand() * 25), z = this.center.z + Math.sin(theta) * (rz + 55 + rand() * 25);
        if (track.theme !== 'city' && i % 2 === 0) {
          const hill = this.mesh(new T.ConeGeometry(20 + rand() * 25, 25 + rand() * 22, 7), i % 3 ? '#9bc59d' : '#bed4ac', x, 8, z);
          hill.rotation.y = rand() * 5; hill.castShadow = false;
        }
        for (let j = 0; j < 4; j++) {
          const cloud = this.ball(5 + rand() * 5, '#fffdf0', x + j * 6, 45 + Math.sin(i) * 13 + rand() * 2, z, this.level, 2);
          cloud.scale.set(1.4, 0.6, 0.8); cloud.castShadow = false;
        }
        if (track.theme === 'coast') {
          for (let j = 0; j < 3; j++) {
            const wave = this.mesh(new T.TorusGeometry(11 + j * 3, 0.11, 3, 22, 1.3), '#b8e6df', x, -0.65, z);
            wave.rotation.x = -Math.PI / 2; wave.rotation.z = theta; wave.castShadow = false;
          }
        }
      }
      this.mergeStatic();
      for (const car of race.cars) this.carModels.push(this.createKart(car.color));
      this.createEffects();
      this.cameraReady = false;
      this.update(race, 1 / 60, true);
    }
    ribbon(left, right, y, material, filter = null) {
      if (left > right) [left, right] = [right, left];
      const pos = [], normals = [], n = this.track.samples.length;
      const vertex = (p, offset) => { pos.push(p.x + p.rx * offset, y, p.z + p.rz * offset); normals.push(0, 1, 0); };
      for (let i = 0; i < n; i++) {
        if (filter && !filter(i)) continue;
        const a = this.track.samples[i], b = this.track.samples[(i + 1) % n];
        vertex(a, left); vertex(b, left); vertex(a, right);
        vertex(a, right); vertex(b, left); vertex(b, right);
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
      const m = this.mesh(geometry, material); m.castShadow = false;
    }
    road() {
      const track = this.track, w = track.width / 2;
      this.ribbon(-w - 4, w + 4, 0.105, track.sand);
      this.ribbon(-w, w, 0.16, '#647575');
      for (const side of [-1, 1]) {
        this.ribbon(side * w, side * (w + 0.8), 0.18, '#fff6dc', i => Math.floor(i / 6) % 2 === 0);
        this.ribbon(side * w, side * (w + 0.8), 0.18, track.accent, i => Math.floor(i / 6) % 2 === 1);
        this.ribbon(side * (w - 0.5), side * (w - 0.36), 0.175, '#c4d1c1');
      }
      for (let s = 4; s < track.length; s += 12) {
        const p = C.sample(track, s);
        const dash = this.box(0.14, 0.015, 3.4, '#c4d0c1', p.x, 0.18, p.z); dash.rotation.y = p.heading; dash.castShadow = false;
      }
      for (let s = 0; s < track.length; s += 9) {
        for (const side of [-1, 1]) {
          const p = C.sample(track, s, side * (w + 3.65));
          this.box(0.3, 1.35, 0.3, '#fff4df', p.x, 0.65, p.z);
          const rail = this.box(0.24, 0.28, 9.4, s % 27 === 0 ? track.accent : '#eee9d5', p.x, 0.94, p.z); rail.rotation.y = p.heading;
        }
      }
      // Start line: locally generated geometry, no image loading.
      for (let x = -w; x < w; x += 1) for (let row = 0; row < 2; row++) {
        const p = C.sample(track, row - 0.5, x + 0.5);
        const tile = this.box(1, 0.025, 1, (Math.floor(x + w) + row) % 2 ? '#faf7e3' : '#344e4b', p.x, 0.2, p.z);
        tile.rotation.y = p.heading; tile.castShadow = false;
      }
      for (let i = 0; i < 6; i++) {
        const p = C.sample(track, -8 - Math.floor(i / 2) * 7, i % 2 ? 2.1 : -2.1);
        for (const offset of [-1.7, 1.7]) { const box = this.box(0.1, 0.02, 4.2, '#e0e5d4', p.x + p.rx * offset, 0.18, p.z + p.rz * offset); box.rotation.y = p.heading; box.castShadow = false; }
      }
      for (let s = 35; s < track.length; s += 38) {
        const p = C.sample(track, s), ahead = C.sample(track, s + 24);
        const turn = C.angleDelta(ahead.heading, p.heading);
        if (Math.abs(turn) > 0.18) {
          const sign = C.sample(track, s, -Math.sign(turn) * (w + 2.3));
          this.chevron(sign, turn < 0);
        }
      }
    }
    palm(x, z, scale, rand) {
      const group = new T.Group(); group.position.set(x, 0, z); group.rotation.y = rand() * 6; group.scale.setScalar(scale); this.level.add(group);
      for (let i = 0; i < 4; i++) { const t = this.mesh(new T.CylinderGeometry(0.24 - i * 0.025, 0.29 - i * 0.025, 1.8, 7), i % 2 ? '#ac9270' : '#c1a276', i * 0.16, 0.9 + i * 1.65, 0, group); t.rotation.z = -0.08; }
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2, positions = [];
        for (let j = 0; j < 6; j++) {
          const v = t => { const r = t * 4.5, w = Math.sin(t * Math.PI) * 0.64; return [[Math.cos(a) * r + Math.sin(a) * w + 0.55, 6.8 + Math.sin(t * Math.PI) * 1.0 - t * 2, Math.sin(a) * r - Math.cos(a) * w], [Math.cos(a) * r - Math.sin(a) * w + 0.55, 6.8 + Math.sin(t * Math.PI) * 1.0 - t * 2, Math.sin(a) * r + Math.cos(a) * w]]; };
          const a1 = v(j / 6), b1 = v((j + 1) / 6); positions.push(...a1[0], ...a1[1], ...b1[0], ...b1[0], ...a1[1], ...b1[1]);
        }
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); g.computeVertexNormals();
        this.mesh(g, this.material(i % 2 ? '#548c68' : '#739e62', { side: T.DoubleSide }), 0, 0, 0, group);
      }
      this.ball(0.38, '#987153', 0.8, 6.4, 0.3, group); this.ball(0.3, '#a47d53', 0.15, 6.5, -0.25, group);
      const bush = this.ball(1.1, '#8eb871', 1.5, 0.7, 0.4, group); bush.scale.y = 0.75;
    }
    pine(x, z, scale, rand) {
      const group = new T.Group(); group.position.set(x, 0, z); group.scale.setScalar(scale); this.level.add(group);
      this.mesh(new T.CylinderGeometry(0.35, 0.5, 3, 6), '#9f8560', 0, 1.5, 0, group);
      for (let i = 0; i < 3; i++) { const tree = this.mesh(new T.ConeGeometry(3.0 - i * 0.67, 4.4 - i * 0.6, 7), ['#467765', '#508b6d', '#6a9d76'][i], 0, 3.1 + i * 1.8, 0, group); tree.rotation.y = rand(); }
    }
    roundTree(x, z, scale) {
      this.mesh(new T.CylinderGeometry(0.32, 0.4, 4 * scale, 7), '#b29977', x, 2 * scale, z);
      const crown = this.ball(2.6 * scale, '#8cae7d', x, 4.8 * scale, z, this.level, 2); crown.scale.y = 1.12;
      this.ball(1.7 * scale, '#adc38a', x - scale, 4.5 * scale, z + scale);
    }
    rock(x, z, rand) {
      const r = 1.3 + rand() * 2;
      const rock = this.ball(r, rand() > 0.5 ? '#b9b6a1' : '#a5b8a0', x, r * 0.43, z); rock.scale.set(1.3, 0.72, 1); rock.rotation.set(rand(), rand(), rand());
      for (let i = 0; i < 2; i++) this.ball(0.65, '#9ab479', x + i * 1.5, 0.35, z + r);
    }
    hut(x, z, rand) {
      const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = rand() * 6; this.level.add(g);
      this.box(4.7, 3.4, 4.3, rand() > 0.5 ? '#f4cf97' : '#e7b199', 0, 1.7, 0, g);
      const roof = this.mesh(new T.ConeGeometry(4.1, 2.1, 4), '#85b6a0', 0, 4.4, 0, g); roof.rotation.y = Math.PI / 4;
      this.box(1, 2, 0.1, '#698c82', 0, 1.2, 2.2, g);
      for (const side of [-1, 1]) this.box(0.85, 0.85, 0.12, '#ebf3d9', side * 1.5, 2, 2.21, g);
    }
    building(x, z, rand) {
      const w = 6 + rand() * 5, h = 7 + rand() * 17, d = 6 + rand() * 4;
      const colors = ['#dba994', '#a7b9b1', '#dfc9a6', '#b5bec3', '#cfb9a9'];
      this.box(w, h, d, colors[Math.floor(rand() * colors.length)], x, h / 2, z);
      this.box(w + 0.5, 0.5, d + 0.5, '#eee5d0', x, h, z);
      for (let y = 2; y < h - 1; y += 2.6) for (let dx = -w / 2 + 1.3; dx < w / 2 - 0.5; dx += 2) {
        for (const side of [-1, 1]) this.box(0.85, 1.25, 0.06, rand() > 0.3 ? '#7c989b' : '#f4d4a5', x + dx, y, z + side * (d / 2 + 0.04));
      }
    }
    textMaterial(text, background, foreground = '#fff7e3', width = 768, height = 160) {
      const c = document.createElement('canvas'); c.width = width; c.height = height;
      const ctx = c.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = foreground; ctx.font = `800 ${height * 0.56}px "Avenir Next",Arial,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, width / 2, height * 0.54, width * 0.87);
      const map = new T.CanvasTexture(c); map.colorSpace = T.SRGBColorSpace;
      return new T.MeshStandardMaterial({ map, roughness: 1, side: T.DoubleSide });
    }
    gantry() {
      const p = C.sample(this.track, 13), g = new T.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = p.heading; this.level.add(g);
      const w = this.track.width / 2 + 1.4;
      for (const side of [-1, 1]) {
        this.box(0.65, 7.2, 0.65, '#f7e5bb', side * w, 3.6, 0, g);
        this.box(1.2, 0.6, 1.2, '#bba78b', side * w, 0.3, 0, g);
      }
      this.rounded(w * 2 + 1.2, 2.1, 0.65, '#f09a62', 0, 7.2, 0, g);
      this.mesh(new T.PlaneGeometry(w * 2 - 1.4, 1.42), this.textMaterial('BREEZE KART', '#f09a62'), 0, 7.2, -0.345, g).rotation.y = Math.PI;
      this.mesh(new T.PlaneGeometry(w * 2 - 1.4, 1.42), this.textMaterial('HAVE A GOOD RIDE', '#f09a62'), 0, 7.2, 0.345, g);
      for (let i = -2; i <= 2; i++) this.ball(0.17, i % 2 ? '#fcd885' : '#8abb91', i * 1.1, 5.8, 0, g);
      for (const side of [-1, 1]) {
        const flag = this.box(2, 1.25, 0.08, this.track.accent, side * (w + 1.3), 6.1, 0, g); flag.rotation.z = side * 0.08;
      }
    }
    billboard(x, z, text, color, rotation) {
      const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = rotation; this.level.add(g);
      for (const i of [-1, 1]) this.box(0.12, 1.8, 0.12, '#a89477', i * 1.8, 0.9, 0, g);
      this.box(5.3, 1.8, 0.3, color, 0, 2.1, 0, g);
      this.mesh(new T.PlaneGeometry(5.05, 1.48), this.textMaterial(text, color), 0, 2.1, -0.16, g).rotation.y = Math.PI;
      this.mesh(new T.PlaneGeometry(5.05, 1.48), this.textMaterial(text, color), 0, 2.1, 0.16, g);
    }
    chevron(p, right) {
      const g = new T.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = p.heading + Math.PI; this.level.add(g);
      this.box(0.14, 2.3, 0.14, '#c9ba97', 0, 1.15, 0, g);
      this.box(2.2, 1.5, 0.12, '#f5edd4', 0, 2.1, 0, g);
      this.mesh(new T.PlaneGeometry(2, 1.25), this.textMaterial(right ? '››' : '‹‹', '#f5edd4', '#e68448', 256, 160), 0, 2.1, 0.075, g);
    }
    mergeStatic() {
      // Batch scenery by material to keep draw calls low on integrated GPUs.
      this.level.updateMatrixWorld(true);
      const batches = new Map(), originals = new Set();
      this.level.traverse(obj => {
        if (!obj.isMesh) return;
        const geom = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
        geom.applyMatrix4(obj.matrixWorld); originals.add(obj.geometry);
        const key = obj.material.uuid;
        if (!batches.has(key)) batches.set(key, { material: obj.material, positions: [], normals: [], uvs: [], shadow: false });
        const batch = batches.get(key);
        for (const value of geom.attributes.position.array) batch.positions.push(value);
        for (const value of geom.attributes.normal.array) batch.normals.push(value);
        const uv = geom.attributes.uv;
        if (uv) for (const value of uv.array) batch.uvs.push(value);
        else for (let i = 0; i < geom.attributes.position.count * 2; i++) batch.uvs.push(0);
        batch.shadow ||= obj.castShadow;
        geom.dispose();
      });
      this.level.clear(); originals.forEach(g => g.dispose());
      for (const b of batches.values()) {
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute(b.positions, 3));
        geometry.setAttribute('normal', new T.Float32BufferAttribute(b.normals, 3));
        geometry.setAttribute('uv', new T.Float32BufferAttribute(b.uvs, 2));
        geometry.computeBoundingSphere();
        const m = new T.Mesh(geometry, b.material); m.castShadow = b.shadow; m.receiveShadow = true; this.level.add(m);
      }
    }
    createKart(color) {
      const group = new T.Group(), body = new T.Group(); group.add(body); this.carsGroup.add(group);
      const paint = new T.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.09 });
      this.rounded(2.28, 0.4, 3.2, '#394946', 0, 0.49, 0, body);
      this.rounded(2.05, 0.49, 3, paint, 0, 0.77, 0, body);
      this.rounded(2.4, 0.36, 0.66, paint, 0, 0.53, 1.6, body);
      this.rounded(1.35, 0.34, 1.05, paint, 0, 0.96, 1.14, body);
      this.rounded(0.29, 0.022, 1.46, '#fff7d9', 0, 1.148, 1.02, body);
      this.rounded(1.04, 0.66, 0.6, '#445350', 0, 1.03, -0.66, body);
      this.box(0.8, 0.09, 0.7, '#737e66', 0, 0.72, -0.17, body);
      for (const side of [-1, 1]) {
        this.rounded(0.47, 0.54, 1.37, paint, side * 1.03, 0.68, -0.27, body);
        this.rounded(0.36, 0.18, 0.05, '#fff4c4', side * 0.73, 0.71, 1.953, body);
        this.rounded(0.27, 0.12, 0.06, '#d6503b', side * 0.78, 0.75, -1.6, body);
        this.mesh(new T.CylinderGeometry(0.16, 0.18, 0.49, 10), '#586262', side * 0.67, 0.48, -1.8, body).rotation.x = Math.PI / 2;
        this.box(0.08, 0.6, 0.1, '#485b54', side * 0.85, 1.1, -1.3, body);
      }
      this.rounded(2.45, 0.18, 0.51, paint, 0, 1.42, -1.3, body);
      const wheels = [];
      for (const side of [-1, 1]) for (const z of [-1.04, 1.1]) {
        const wheel = new T.Group(); wheel.position.set(side * 1.25, 0.47, z); group.add(wheel); wheels.push(wheel);
        const tire = this.mesh(new T.CylinderGeometry(0.49, 0.49, 0.42, 16), '#2f3c3b', 0, 0, 0, wheel); tire.rotation.z = Math.PI / 2;
        const hub = this.mesh(new T.CylinderGeometry(0.27, 0.27, 0.44, 12), '#e5deca', 0, 0, 0, wheel); hub.rotation.z = Math.PI / 2;
        const center = this.mesh(new T.CylinderGeometry(0.12, 0.12, 0.46, 8), paint, 0, 0, 0, wheel); center.rotation.z = Math.PI / 2;
      }
      const driver = new T.Group(); body.add(driver);
      const torso = this.mesh(new T.SphereGeometry(0.42, 14, 10), '#f3eada', 0, 1.17, -0.24, driver); torso.scale.set(1, 1.1, 0.85);
      const helmet = this.mesh(new T.SphereGeometry(0.68, 20, 14), paint, 0, 1.99, -0.29, driver); helmet.scale.set(1.04, 1.03, 1);
      const stripe = this.mesh(new T.SphereGeometry(0.691, 16, 12, 0, 0.26), '#fff4d4', 0, 1.99, -0.29, driver); stripe.rotation.y = -0.13;
      this.rounded(1.02, 0.33, 0.25, '#314f54', 0, 1.98, 0.3, driver);
      this.rounded(0.66, 0.14, 0.035, '#a2d3cf', -0.06, 2.04, 0.437, driver);
      this.rounded(0.61, 0.2, 0.11, '#ffe2b8', 0, 1.69, 0.28, driver);
      for (const side of [-1, 1]) {
        const arm = this.mesh(new T.CapsuleGeometry(0.13, 0.38, 3, 8), '#f6e8d5', side * 0.43, 1.29, 0.09, driver); arm.rotation.x = -0.8; arm.rotation.z = side * 0.4;
        this.ball(0.16, '#735f4e', side * 0.36, 1.28, 0.37, driver, 1);
      }
      const wheel = this.mesh(new T.TorusGeometry(0.35, 0.055, 5, 14), '#3a514c', 0, 1.31, 0.51, body); wheel.rotation.x = -0.55;
      const flames = [];
      for (const side of [-1, 1]) {
        const flame = this.mesh(new T.ConeGeometry(0.29, 1.55, 7), new T.MeshBasicMaterial({ color: '#8aeeee', transparent: true, opacity: 0.85 }), side * 0.67, 0.5, -2.4, body);
        flame.rotation.x = -Math.PI / 2; flame.visible = false; flames.push(flame);
      }
      return { group, body, driver, wheels, paint, flames };
    }
    setColor(color) { this.carModels[0].paint.color.set(color); }
    createParticlePool(count, spark) {
      const geometry = new T.BufferGeometry();
      const attributes = { position: 3, aTint: 3, aSize: 1, aOpacity: 1, aRotation: 1 };
      for (const [name, size] of Object.entries(attributes)) geometry.setAttribute(name, new T.BufferAttribute(new Float32Array(count * size), size).setUsage(T.DynamicDrawUsage));
      const material = new T.ShaderMaterial({
        transparent: true, depthWrite: false, toneMapped: false,
        blending: spark ? T.AdditiveBlending : T.NormalBlending,
        uniforms: { uScale: { value: 600 }, uSpark: { value: spark ? 1 : 0 } },
        vertexShader: `
          attribute vec3 aTint;
          attribute float aSize;
          attribute float aOpacity;
          attribute float aRotation;
          uniform float uScale;
          varying vec3 vTint;
          varying float vOpacity;
          varying float vRotation;
          void main() {
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * viewPosition;
            gl_PointSize = clamp(aSize * uScale / max(0.1, -viewPosition.z), 1.0, 160.0);
            vTint = aTint;
            vOpacity = aOpacity;
            vRotation = aRotation;
          }`,
        fragmentShader: `
          uniform float uSpark;
          varying vec3 vTint;
          varying float vOpacity;
          varying float vRotation;
          void main() {
            vec2 uv = (gl_PointCoord - 0.5) * 2.0;
            float cs = cos(vRotation), sn = sin(vRotation);
            vec2 q = mat2(cs, -sn, sn, cs) * uv;
            float radius = length(q);
            float alpha;
            vec3 tint = vTint;
            if (uSpark > 0.5) {
              float core = pow(max(0.0, 1.0 - length(q * vec2(3.0, 0.85))), 1.4);
              float halo = 0.28 * exp(-dot(q, q) * 5.0);
              alpha = (core + halo) * (1.0 - smoothstep(0.7, 1.0, radius));
              tint = mix(tint, vec3(1.0), core * 0.72);
            } else {
              float softness = 1.0 - smoothstep(0.1, 1.0, radius);
              float wisps = 0.87 + 0.13 * sin(q.x * 8.0 + q.y * 4.0) * cos(q.y * 7.0);
              alpha = softness * softness * wisps;
            }
            alpha *= vOpacity;
            if (alpha < 0.006) discard;
            gl_FragColor = vec4(tint, alpha);
            #include <colorspace_fragment>
          }`
      });
      const mesh = new T.Points(geometry, material);
      mesh.name = spark ? 'drift-sparks' : 'drift-smoke'; mesh.frustumCulled = false; mesh.visible = false;
      // Draw translucent smoke first, then the brighter wheel sparks.
      mesh.renderOrder = spark ? 2 : 1; this.effectsGroup.add(mesh);
      return { mesh, count, spark, cursor: 0, active: 0,
        life: new Float32Array(count), duration: new Float32Array(count),
        velocity: new Float32Array(count * 3), size: new Float32Array(count), opacity: new Float32Array(count) };
    }
    createEffects() {
      this.sparkFX = this.createParticlePool(Math.ceil(240 * this.effectDensity), true);
      this.smokeFX = this.createParticlePool(Math.ceil(96 * this.effectDensity), false);
      this.driftBlue = new T.Color('#72ddff'); this.driftGold = new T.Color('#ffba52');
      this.driftTint = this.driftBlue.clone(); this.smokeTint = new T.Color('#e2e2db');
      this.wheelHistory = [null, null]; this.sparkCarry = 0; this.smokeCarry = 0; this.burstTime = 0; this.glowStrength = 0;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d'), gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255,255,255,0.9)'); gradient.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
      const glowMap = new T.CanvasTexture(canvas); glowMap.colorSpace = T.SRGBColorSpace;
      this.tireGlow = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: this.driftBlue, map: glowMap, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }), 2);
      this.tireGlow.name = 'drift-wheel-glow'; this.tireGlow.frustumCulled = false; this.tireGlow.visible = false; this.effectsGroup.add(this.tireGlow);
      this.skidCursor = 0; this.skidCount = 550;
      this.skids = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: '#293e3b', transparent: true, opacity: 0.6, depthWrite: false }), this.skidCount);
      const dummy = new T.Object3D(); dummy.position.y = -20; dummy.updateMatrix();
      for (let i = 0; i < this.skidCount; i++) this.skids.setMatrixAt(i, dummy.matrix);
      this.skids.instanceMatrix.setUsage(T.DynamicDrawUsage); this.skids.frustumCulled = false; this.effectsGroup.add(this.skids); this.effectDummy = dummy;
    }
    spawnParticle(pool, x, z, hx, hz, side, speed, burst = false) {
      const i = pool.cursor++ % pool.count, a = pool.mesh.geometry.attributes;
      const spark = pool.spark, life = spark ? 0.28 + Math.random() * 0.27 : 0.85 + Math.random() * 0.3;
      pool.life[i] = pool.duration[i] = life;
      pool.size[i] = spark ? (burst ? 0.65 : 0.38) + Math.random() * 0.32 : 0.65 + Math.random() * 0.45;
      pool.opacity[i] = spark ? 0.96 : 0.42;
      a.position.array.set([x, spark ? 0.27 : 0.36, z], i * 3);
      const tint = spark ? (burst ? this.driftGold : this.driftTint) : this.smokeTint;
      a.aTint.array.set([tint.r, tint.g, tint.b], i * 3);
      a.aSize.array[i] = pool.size[i]; a.aOpacity.array[i] = pool.opacity[i] * (spark ? 1 : 0.32); a.aRotation.array[i] = Math.random() * Math.PI * 2;
      const spread = spark ? (burst ? 6 : 3.5) : 0.7;
      const along = spark ? -2.5 : speed * 0.1;
      pool.velocity.set([hx * along + hz * side * spread + (Math.random() - 0.5) * 2, spark ? 1.1 + Math.random() * 2.6 : 0.4 + Math.random() * 0.55, hz * along - hx * side * spread + (Math.random() - 0.5) * 2], i * 3);
    }
    ageParticles(pool, dt) {
      const a = pool.mesh.geometry.attributes;
      for (let i = 0; i < pool.count; i++) {
        if (pool.life[i] <= 0) continue;
        pool.life[i] = Math.max(0, pool.life[i] - dt);
        const age = 1 - pool.life[i] / pool.duration[i];
        for (let k = 0; k < 3; k++) a.position.array[i * 3 + k] += pool.velocity[i * 3 + k] * dt;
        if (pool.spark) pool.velocity[i * 3 + 1] -= 7 * dt;
        a.aSize.array[i] = pool.size[i] * (pool.spark ? 1 - age * 0.4 : 1 + age * 2.7);
        a.aOpacity.array[i] = pool.opacity[i] * (1 - age) * (pool.spark ? 1 : Math.min(1, (age * pool.duration[i] + 0.04) / 0.12));
        if (a.position.array[i * 3 + 1] < 0.2 || pool.life[i] === 0) { pool.life[i] = 0; a.aOpacity.array[i] = 0; }
      }
    }
    resetDriftEffects() {
      for (const pool of [this.sparkFX, this.smokeFX]) {
        pool.life.fill(0); pool.mesh.geometry.attributes.aOpacity.array.fill(0); pool.mesh.geometry.attributes.aOpacity.needsUpdate = true;
        pool.active = 0; pool.mesh.visible = false;
      }
      this.wheelHistory = [null, null]; this.sparkCarry = this.smokeCarry = this.burstTime = this.glowStrength = 0;
      this.tireGlow.visible = false; this.tireGlow.material.opacity = 0;
    }
    driftBurst() {
      if (this.reducedMotion || this.race.state !== 'racing') return;
      this.burstTime = 0.65;
      const car = this.race.player, hx = Math.sin(car.heading), hz = Math.cos(car.heading);
      for (const side of [-1, 1]) for (let i = 0; i < Math.ceil(18 * this.effectDensity); i++) this.spawnParticle(this.sparkFX, car.x - hx + hz * side * 1.24, car.z - hz - hx * side * 1.24, hx, hz, side, car.speed, true);
    }
    updateEffects(car, dt) {
      this.ageParticles(this.sparkFX, dt); this.ageParticles(this.smokeFX, dt);
      const drifting = car.drift && this.race.state === 'racing';
      const intensity = car.nitro === 2 ? 1 : C.clamp(car.charge / 100, 0, 1);
      this.driftTint.lerpColors(this.driftBlue, this.driftGold, C.clamp((intensity - 0.3) / 0.5, 0, 1));
      this.burstTime = Math.max(0, this.burstTime - dt);
      this.glowStrength = C.approach(this.glowStrength, !this.reducedMotion && drifting ? 0.36 + intensity * 0.3 : 0, dt, drifting ? 12 : 7);
      this.tireGlow.visible = this.glowStrength > 0.01 || this.burstTime > 0;
      this.tireGlow.material.color.copy(this.burstTime > 0 ? this.driftGold : this.driftTint);
      this.tireGlow.material.opacity = Math.min(0.85, this.glowStrength + this.burstTime * 0.6);
      const hx = Math.sin(car.heading), hz = Math.cos(car.heading);
      // Emission uses elapsed time; interpolate wheel positions to avoid gaps at low FPS.
      if (drifting && !this.reducedMotion) {
        this.sparkCarry += dt * (55 + intensity * 28) * this.effectDensity;
        this.smokeCarry += dt * (18 + Math.max(0, car.speed) * 0.2) * this.effectDensity;
      }
      const sparks = Math.floor(this.sparkCarry), smoke = Math.floor(this.smokeCarry);
      this.sparkCarry -= sparks; this.smokeCarry -= smoke;
      for (let wheel = 0; wheel < 2; wheel++) {
        const side = wheel ? 1 : -1;
        const x = car.x - hx * 1.04 + hz * side * 1.25, z = car.z - hz * 1.04 - hx * side * 1.25;
        const dummy = this.effectDummy, glowSize = 1.8 + intensity * 0.6 + this.burstTime * 0.8;
        dummy.position.set(x, 0.207, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(glowSize, 1, glowSize); dummy.updateMatrix(); this.tireGlow.setMatrixAt(wheel, dummy.matrix);
        if (drifting) {
          let previous = this.wheelHistory[wheel] || { x, z };
          const distance = Math.hypot(x - previous.x, z - previous.z);
          if (distance > 7) previous = { x, z };
          if (!this.reducedMotion) for (const [pool, count] of [[this.sparkFX, sparks], [this.smokeFX, smoke]]) {
            for (let j = 0; j < count; j++) {
              const t = (j + 1) / Math.max(1, count);
              this.spawnParticle(pool, C.lerp(previous.x, x, t), C.lerp(previous.z, z, t), hx, hz, side, car.speed);
            }
          }
          if (distance >= 0.2 && distance <= 7) {
            dummy.position.set((x + previous.x) / 2, 0.194, (z + previous.z) / 2);
            dummy.rotation.set(0, Math.atan2(x - previous.x, z - previous.z), 0); dummy.scale.set(0.25, 1, distance + 0.06); dummy.updateMatrix();
            this.skids.setMatrixAt(this.skidCursor++ % this.skidCount, dummy.matrix); this.skids.instanceMatrix.needsUpdate = true;
          }
          if (!this.wheelHistory[wheel] || distance >= 0.2) this.wheelHistory[wheel] = { x, z };
        } else this.wheelHistory[wheel] = null;
      }
      if (!drifting) this.sparkCarry = this.smokeCarry = 0;
      this.tireGlow.instanceMatrix.needsUpdate = true;
      const scale = this.renderer.domElement.height / (2 * Math.tan(this.camera.fov * Math.PI / 360));
      for (const pool of [this.sparkFX, this.smokeFX]) {
        pool.active = 0;
        for (let i = 0; i < pool.count; i++) if (pool.life[i] > 0) pool.active++;
        pool.mesh.visible = pool.active > 0;
        pool.mesh.material.uniforms.uScale.value = scale;
        for (const a of Object.values(pool.mesh.geometry.attributes)) a.needsUpdate = true;
      }
    }
    resize() {
      const width = this.canvas.parentElement.clientWidth, height = this.canvas.parentElement.clientHeight;
      if (width === this.lastWidth && height === this.lastHeight) return;
      this.lastWidth = width; this.lastHeight = height;
      this.renderer.setSize(width, height, false); this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
    }
    update(race, dt, preview) {
      this.clock += dt;
      for (let i = 0; i < race.cars.length; i++) {
        const car = race.cars[i], model = this.carModels[i];
        model.group.position.set(car.x, 0.17, car.z); model.group.rotation.y = car.heading;
        model.body.rotation.z = this.reducedMotion ? 0 : -car.steer * Math.min(car.speed / 42, 1) * 0.045;
        model.driver.rotation.z = this.reducedMotion ? 0 : -car.steer * 0.1;
        model.body.position.y = !this.reducedMotion && Math.abs(car.speed) > 2 ? Math.sin(this.clock * 25) * 0.012 : 0;
        model.wheels.forEach((w, j) => { if (j % 2 === 1) w.rotation.y = car.steer * 0.34; });
        model.flames.forEach((f, j) => { f.visible = car.boost > 0 && race.state === 'racing'; f.scale.y = this.reducedMotion ? 1 : 0.85 + Math.sin(this.clock * 47 + j) * 0.25; });
      }
      const p = race.player;
      if (preview) {
        const s = C.sample(this.track, p.progress);
        const angle = s.heading + 0.69 + (this.reducedMotion ? 0 : Math.sin(this.clock * 0.15) * 0.1);
        const distance = this.camera.aspect < 1.5 ? 22 : 20;
        const wanted = new T.Vector3(p.x + Math.sin(angle) * distance, 10.5, p.z + Math.cos(angle) * distance);
        const target = new T.Vector3(p.x + s.rx * 1.5, 0.9, p.z + s.rz * 1.5);
        this.cameraPosition.copy(wanted); this.cameraTarget.copy(target);
        this.camera.fov = 45;
      } else {
        if (!this.cameraReady) this.cameraHeading = p.heading;
        this.cameraHeading += C.angleDelta(p.velocityHeading, this.cameraHeading) * (1 - Math.exp(-dt * 5));
        const distance = 10.4 + Math.max(0, p.speed) * 0.028 + (this.reducedMotion ? 0 : p.boost > 0 ? 0.9 : 0);
        const hx = Math.sin(this.cameraHeading), hz = Math.cos(this.cameraHeading);
        const wanted = new T.Vector3(p.x - hx * distance, 5.6, p.z - hz * distance);
        const target = new T.Vector3(p.x + hx * 11, 1.2, p.z + hz * 11);
        if (!this.cameraReady) { this.cameraPosition.copy(wanted); this.cameraTarget.copy(target); }
        else { this.cameraPosition.lerp(wanted, 1 - Math.exp(-dt * 9)); this.cameraTarget.lerp(target, 1 - Math.exp(-dt * 11)); }
        this.camera.fov = C.approach(this.camera.fov, this.reducedMotion ? 57 : 54 + p.speed * 0.11 + (p.boost > 0 ? 5 : 0), dt, 3);
      }
      this.cameraReady = !preview;
      this.camera.position.copy(this.cameraPosition); this.camera.lookAt(this.cameraTarget); this.camera.updateProjectionMatrix();
      this.sun.position.set(p.x - 45, 85, p.z + 35); this.sun.target.position.set(p.x, 0, p.z);
      if (!preview && race.state !== 'paused') this.updateEffects(p, dt);
      this.renderer.render(this.scene, this.camera);
    }
    stats() { return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures,
      effects: { sparks: this.sparkFX.active, smoke: this.smokeFX.active, skids: Math.min(this.skidCursor, this.skidCount), glow: this.tireGlow.material.opacity, capacity: this.sparkFX.count + this.smokeFX.count, reducedMotion: this.reducedMotion } }; }
  }
  root.KartWorld = World;
})(globalThis);
