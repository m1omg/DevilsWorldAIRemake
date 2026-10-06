/*
 * Devil's Maze — renderer.
 *
 * Draws the game state onto a canvas. Static parts (the maze for the current
 * scene, the stone frame, the vignette) are painted once into offscreen
 * canvases at the current resolution; moving parts are drawn every frame,
 * interpolated between the last two simulation ticks so motion is smooth at any
 * refresh rate.
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});
  const C = DM.C;
  const A = DM.art;
  const G = DM.game;
  const { mod, wrapDelta, pad, clamp } = DM.util;

  const LW = C.LW;
  const LH = C.LH;
  const VX = C.VIEW_X;
  const VY = C.VIEW_Y;
  const VWP = C.VIEW_W * 16;
  const VHP = C.VIEW_H * 16;
  const MWP = C.MAZE_W * 16;
  const MHP = C.MAZE_H * 16;
  const SPLITP_X = (VWP + MWP) / 2;
  const SPLITP_Y = (VHP + MHP) / 2;
  const TAU = Math.PI * 2;

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
      } catch (e) {
        /* fall through */
      }
    }
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
  }

  // Small seeded generator for decorative noise (stable between redraws).
  function hashRand(a, b, c) {
    let h = (Math.imul(a + 1013, 0x9e3779b1) ^ Math.imul(b + 7919, 0x85ebca6b) ^ Math.imul(c + 31, 0xc2b2ae35)) >>> 0;
    return () => {
      h = (h + 0x6d2b79f5) >>> 0;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- wall outlines ----------------------------------------------------------

  // Trace the outlines of all wall regions in the cell window [x0,x1)x[y0,y1).
  // Returns closed loops of grid corner points, wall on the right-hand side.
  function traceWalls(isWall, x0, y0, x1, y1) {
    const inside = (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1 && isWall(x, y);
    const key = (x, y) => (x + 64) * 4096 + (y + 64);
    const out = new Map();
    const add = (ax, ay, bx, by) => {
      const k = key(ax, ay);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push([ax, ay, bx, by]);
    };
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!inside(x, y)) continue;
        if (!inside(x, y - 1)) add(x, y, x + 1, y);
        if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
        if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
        if (!inside(x - 1, y)) add(x, y + 1, x, y);
      }
    }
    const loops = [];
    for (;;) {
      let first = null;
      for (const list of out.values()) {
        if (list.length) {
          first = list.pop();
          break;
        }
      }
      if (!first) break;
      const pts = [[first[0], first[1]]];
      let cur = first;
      for (let guard = 0; guard < 100000; guard++) {
        const list = out.get(key(cur[2], cur[3]));
        if (!list || !list.length) break;
        let pick = 0;
        if (list.length > 1) {
          // Pinch point: take the sharpest right turn so diagonal walls stay apart.
          const dx = cur[2] - cur[0];
          const dy = cur[3] - cur[1];
          let best = -2;
          list.forEach((e, k) => {
            const ex = e[2] - e[0];
            const ey = e[3] - e[1];
            const turn = dx * ey - dy * ex;
            const score = turn > 0 ? 1 : turn === 0 ? 0 : -1;
            if (score > best) {
              best = score;
              pick = k;
            }
          });
        }
        cur = list.splice(pick, 1)[0];
        if (cur[0] === first[0] && cur[1] === first[1]) break;
        pts.push([cur[0], cur[1]]);
      }
      // drop collinear points
      const simple = [];
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[(i - 1 + pts.length) % pts.length];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        const cross = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0]);
        if (cross !== 0) simple.push(p1);
      }
      if (simple.length >= 4) loops.push(simple);
    }
    return loops;
  }

  function addRoundedLoop(path, pts, scale, rConvex, rConcave) {
    const n = pts.length;
    const P = (i) => pts[(i + n) % n];
    const a = P(-1);
    const b = P(0);
    path.moveTo(((a[0] + b[0]) / 2) * scale, ((a[1] + b[1]) / 2) * scale);
    for (let i = 0; i < n; i++) {
      const p0 = P(i - 1);
      const p1 = P(i);
      const p2 = P(i + 1);
      const cross = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0]);
      path.arcTo(p1[0] * scale, p1[1] * scale, ((p1[0] + p2[0]) / 2) * scale, ((p1[1] + p2[1]) / 2) * scale, cross > 0 ? rConvex : rConcave);
    }
    path.closePath();
  }

  // ---- renderer ----------------------------------------------------------------

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.k = 1;
      this.cache = {};
      this.low = false;
      this.vxp = 0;
      this.vyp = 0;
    }

    setLowFx(low) {
      this.low = !!low;
      this.cache = {};
    }

    resize(cssW, cssH) {
      const dpr = Math.min(3, (root.devicePixelRatio || 1));
      const scale = Math.max(0.25, Math.min(cssW / LW, cssH / LH));
      const w = Math.round(LW * scale);
      const h = Math.round(LH * scale);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (this.canvas.width !== pw || this.canvas.height !== ph) {
        this.canvas.width = pw;
        this.canvas.height = ph;
        this.cache = {};
      }
      this.k = pw / LW;
      return { width: w, height: h };
    }

    // ---- cached layers ----

    mazeLayer(mz, scene) {
      const id = 'maze:' + mz.id + ':' + scene;
      if (this.cache[id]) return this.cache[id];
      const pal = A.MAZE_PALETTES[mz.palette];
      const w = Math.round(MWP * this.k);
      const h = Math.round(MHP * this.k);
      const cv = makeCanvas(w, h);
      const g = cv.getContext('2d');
      const sx = w / MWP;
      const sy = h / MHP;
      g.setTransform(sx, 0, 0, sy, 0, 0);
      const M = 2;
      const W = mz.W;
      const H = mz.H;
      const wall = (x, y) => DM.mazes.cell(mz, x, y) !== 0;
      const seed = mz.id.length * 131 + mz.id.charCodeAt(0);

      g.fillStyle = pal.floor;
      g.fillRect(0, 0, MWP, MHP);
      // floor tiles
      for (let y = -M; y < H + M; y++) {
        for (let x = -M; x < W + M; x++) {
          if (wall(x, y)) continue;
          const r = hashRand(mod(x, W), mod(y, H), seed);
          const X = x * 16;
          const Y = y * 16;
          const v = r();
          A.roundRect(g, X + 0.7, Y + 0.7, 14.6, 14.6, 2.4);
          g.fillStyle = pal.floorTile;
          g.fill();
          g.fillStyle = `rgba(255,255,255,${0.012 + v * 0.03})`;
          g.fill();
          g.strokeStyle = pal.floorLine;
          g.lineWidth = 0.5;
          g.stroke();
          for (let k = 0; k < 5; k++) {
            g.fillStyle = `rgba(255,255,255,${0.025 + r() * 0.04})`;
            g.fillRect(X + 2 + r() * 12, Y + 2 + r() * 12, 0.6, 0.6);
          }
          if (r() < 0.09) {
            // faint rune: one of three small sigils
            const kind = Math.floor(r() * 3);
            g.save();
            g.translate(X + 8, Y + 8);
            g.rotate(Math.floor(r() * 4) * (Math.PI / 2));
            g.strokeStyle = pal.rune;
            g.globalAlpha = 0.18;
            g.lineWidth = 0.6;
            g.beginPath();
            if (kind === 0) {
              g.arc(0, 0, 4.2, 0, TAU);
              g.moveTo(0, -3.2);
              g.lineTo(2.8, 1.6);
              g.lineTo(-2.8, 1.6);
              g.closePath();
            } else if (kind === 1) {
              g.arc(0, 0, 4.2, -2.6, 2.6);
              g.moveTo(2.4, 0);
              g.arc(0, 0, 2.4, 0, TAU);
            } else {
              for (let k = 0; k < 6; k++) {
                const a = (k / 6) * TAU;
                g.moveTo(Math.cos(a) * 2, Math.sin(a) * 2);
                g.lineTo(Math.cos(a) * 4.4, Math.sin(a) * 4.4);
              }
            }
            g.stroke();
            g.restore();
          }
        }
      }
      // walls
      const loops = traceWalls(wall, -M, -M, W + M, H + M);
      const path = new Path2D();
      for (const lp of loops) addRoundedLoop(path, lp, 16, 4.6, 2.6);

      g.save();
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 5 * this.k;
      g.shadowOffsetX = 1.5 * this.k;
      g.shadowOffsetY = 3 * this.k;
      g.translate(0, 1.8);
      g.fillStyle = pal.wallSide;
      g.fill(path);
      g.restore();

      g.fillStyle = A.linear(g, 0, 0, MWP, MHP, [
        [0, pal.wallMid],
        [0.5, pal.wallTop],
        [1, pal.wallMid],
      ]);
      g.fill(path);
      g.save();
      g.clip(path);
      g.globalAlpha = 0.55;
      g.fillStyle = pal.wallMid;
      g.fillRect(0, 0, MWP, MHP);
      g.globalAlpha = 1;
      // texture
      const r = hashRand(seed, 7, 3);
      for (let k = 0; k < 900; k++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.10)';
        g.fillRect(r() * MWP, r() * MHP, 0.8, 0.8);
      }
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.lineWidth = 0.5;
      for (let k = 0; k < 40; k++) {
        const x = r() * MWP;
        const y = r() * MHP;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + r() * 10 - 5, y + r() * 10 - 5, x + r() * 16 - 8, y + r() * 16 - 8);
        g.stroke();
      }
      // emboss: light from the top-left
      g.save();
      g.translate(1.1, 1.1);
      g.strokeStyle = pal.wallHi;
      g.globalAlpha = 0.65;
      g.lineWidth = 2.2;
      g.stroke(path);
      g.restore();
      g.save();
      g.translate(-1.1, -1.1);
      g.strokeStyle = pal.wallLo;
      g.globalAlpha = 0.7;
      g.lineWidth = 2.2;
      g.stroke(path);
      g.restore();
      g.restore();
      g.strokeStyle = pal.edge;
      g.globalAlpha = 0.45;
      g.lineWidth = 0.6;
      g.stroke(path);
      g.globalAlpha = 1;

      if (!mz.bonus) this.paintNest(g, mz, pal);
      else this.paintVault(g, mz, pal);

      const layer = { canvas: cv, w, h };
      this.cache[id] = layer;
      return layer;
    }

    paintNest(g, mz, pal) {
      const n = mz.nest;
      const x0 = n.x0 * 16;
      const y0 = n.y0 * 16;
      const cx = (n.cx + 0.5) * 16;
      const cy = (n.cy + 0.5) * 16;
      A.roundRect(g, x0 + 3, y0 + 9, 42, 36, 6);
      g.fillStyle = A.radial(g, cx, cy, 26, [
        [0, '#3a0308'],
        [0.6, '#16020a'],
        [1, '#050106'],
      ]);
      g.fill();
      g.strokeStyle = 'rgba(255,60,80,0.35)';
      g.lineWidth = 0.8;
      g.stroke();
      g.save();
      g.translate(cx, cy + 1);
      g.strokeStyle = 'rgba(255,50,70,0.55)';
      g.lineWidth = 0.7;
      g.beginPath();
      g.arc(0, 0, 12, 0, TAU);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 8.5, 0, TAU);
      g.stroke();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        g.beginPath();
        g.moveTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5);
        g.lineTo(Math.cos(a + 0.18) * 12, Math.sin(a + 0.18) * 12);
        g.stroke();
      }
      g.restore();
      // gate in the top wall
      const [dx, dy] = n.door;
      const gx = dx * 16;
      const gy = dy * 16;
      g.beginPath();
      g.moveTo(gx + 2, gy + 16);
      g.lineTo(gx + 2, gy + 7);
      g.quadraticCurveTo(gx + 8, gy - 1, gx + 14, gy + 7);
      g.lineTo(gx + 14, gy + 16);
      g.closePath();
      g.fillStyle = '#0a0207';
      g.fill();
      g.strokeStyle = pal.edge;
      g.globalAlpha = 0.5;
      g.lineWidth = 0.8;
      g.stroke();
      g.globalAlpha = 1;
      g.strokeStyle = '#6a5a70';
      g.lineWidth = 1;
      g.beginPath();
      for (const bx of [5, 8, 11]) {
        g.moveTo(gx + bx, gy + 5 + (bx === 8 ? -1.5 : 0));
        g.lineTo(gx + bx, gy + 16);
      }
      g.stroke();
      // horns over the gate
      g.fillStyle = '#e8d6b0';
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(gx + 8 + s * 5, gy + 4);
        g.quadraticCurveTo(gx + 8 + s * 9, gy + 1, gx + 8 + s * 8, gy - 3);
        g.quadraticCurveTo(gx + 8 + s * 6.5, gy + 1, gx + 8 + s * 3, gy + 2.5);
        g.fill();
      }
    }

    paintVault(g, mz, pal) {
      const n = mz.nest;
      const cx = (n.cx + 0.5) * 16;
      const cy = (n.cy + 0.5) * 16;
      g.save();
      g.translate(cx, cy);
      A.roundRect(g, -21, -21, 42, 42, 7);
      g.fillStyle = A.radial(g, 0, 0, 30, [
        [0, '#3a2a08'],
        [1, '#120c02'],
      ]);
      g.fill();
      g.strokeStyle = pal.edge;
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = '#ffd35a';
      g.globalAlpha = 0.85;
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU - Math.PI / 2;
        const r = k % 2 ? 5 : 12;
        g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      g.restore();
    }

    frameLayer(palId) {
      const id = 'frame:' + palId;
      if (this.cache[id]) return this.cache[id];
      const pal = A.MAZE_PALETTES[palId];
      const k = this.k;
      const cv = makeCanvas(Math.round(LW * k), Math.round(LH * k));
      const g = cv.getContext('2d');
      g.setTransform(cv.width / LW, 0, 0, cv.height / LH, 0, 0);
      g.fillStyle = A.linear(g, 0, 0, 0, LH, [
        [0, pal.bg2],
        [0.45, pal.bg1],
        [1, pal.bg2],
      ]);
      g.fillRect(0, 0, LW, LH);
      const r = hashRand(3, 5, palId.length);
      for (let y = 0; y < LH; y += 12) {
        const off = (y / 12) % 2 ? 12 : 0;
        for (let x = -off; x < LW; x += 24) {
          g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
          g.fillRect(x + 0.5, y + 0.5, 23, 11);
          g.strokeStyle = 'rgba(255,255,255,0.035)';
          g.lineWidth = 0.5;
          g.strokeRect(x + 0.5, y + 0.5, 23, 11);
        }
      }
      // top glow behind the Devil
      g.fillStyle = A.radial(g, LW / 2, 30, 90, [
        [0, 'rgba(255,60,40,0.25)'],
        [1, 'rgba(255,60,40,0)'],
      ]);
      g.fillRect(0, 0, LW, 70);
      // pillars
      for (const x of [5, LW - 27]) {
        A.roundRect(g, x, VY - 6, 22, VHP + 12, 4);
        g.fillStyle = A.linear(g, x, 0, x + 22, 0, [
          [0, pal.frameHi],
          [0.35, pal.frame],
          [1, '#05030a'],
        ]);
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.lineWidth = 0.8;
        g.stroke();
        A.roundRect(g, x + 8, VY - 2, 6, VHP + 4, 3);
        g.fillStyle = '#05030a';
        g.fill();
        for (let y = VY + 6; y < VY + VHP; y += 22) {
          A.circle(g, x + 4, y, 1);
          g.fillStyle = 'rgba(255,255,255,0.25)';
          g.fill();
          A.circle(g, x + 18, y + 11, 1);
          g.fill();
        }
      }
      // ledge under the Devil
      A.roundRect(g, VX - 6, VY - 9, VWP + 12, 7, 2.5);
      g.fillStyle = A.linear(g, 0, VY - 9, 0, VY - 2, [
        [0, pal.frameHi],
        [1, pal.frame],
      ]);
      g.fill();
      g.beginPath();
      g.moveTo(LW / 2 - 26, VY - 9);
      g.lineTo(LW / 2 - 20, VY - 15);
      g.lineTo(LW / 2 + 20, VY - 15);
      g.lineTo(LW / 2 + 26, VY - 9);
      g.closePath();
      g.fillStyle = pal.frameHi;
      g.fill();
      // bottom ledge + HUD plate
      A.roundRect(g, VX - 6, VY + VHP + 2, VWP + 12, 7, 2.5);
      g.fillStyle = A.linear(g, 0, VY + VHP + 2, 0, VY + VHP + 9, [
        [0, pal.frameHi],
        [1, pal.frame],
      ]);
      g.fill();
      A.roundRect(g, 36, LH - 22, LW - 72, 18, 5);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.10)';
      g.lineWidth = 0.6;
      g.stroke();
      // HUD plates
      for (const x of [5, LW - 105]) {
        A.roundRect(g, x, 4, 100, 46, 6);
        g.fillStyle = 'rgba(0,0,0,0.42)';
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.10)';
        g.stroke();
      }
      // window bezel
      A.roundRect(g, VX - 2.5, VY - 2.5, VWP + 5, VHP + 5, 3);
      g.strokeStyle = pal.frameHi;
      g.lineWidth = 2;
      g.stroke();
      const layer = { canvas: cv };
      this.cache[id] = layer;
      return layer;
    }

    vignette() {
      if (this.cache.vignette) return this.cache.vignette;
      const k = this.k;
      const cv = makeCanvas(Math.round(VWP * k), Math.round(VHP * k));
      const g = cv.getContext('2d');
      g.setTransform(cv.width / VWP, 0, 0, cv.height / VHP, 0, 0);
      g.fillStyle = A.radial(g, VWP / 2, VHP / 2, VWP * 0.62, [
        [0, 'rgba(0,0,0,0)'],
        [0.7, 'rgba(0,0,0,0.12)'],
        [1, 'rgba(0,0,0,0.5)'],
      ]);
      g.fillRect(0, 0, VWP, VHP);
      g.fillStyle = A.linear(g, 0, 0, 0, 10, [
        [0, 'rgba(0,0,0,0.55)'],
        [1, 'rgba(0,0,0,0)'],
      ]);
      g.fillRect(0, 0, VWP, 10);
      const layer = { canvas: cv };
      this.cache.vignette = layer;
      return layer;
    }

    dotSprite(color) {
      const id = 'dot:' + color;
      if (this.cache[id]) return this.cache[id];
      const k = this.k;
      const size = Math.max(4, Math.round(12 * k));
      const cv = makeCanvas(size, size);
      const g = cv.getContext('2d');
      const c = size / 2;
      const rgb = DM.hexRgb(color);
      let grad = g.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, `rgba(${rgb},0.55)`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      grad = g.createRadialGradient(c - size * 0.05, c - size * 0.05, 0, c, c, size * 0.18);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, color);
      grad.addColorStop(1, `rgba(${rgb},0.9)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(c, c, size * 0.17, 0, TAU);
      g.fill();
      this.cache[id] = cv;
      return cv;
    }

    // ---- coordinate helpers ----

    toScreen(mx, my) {
      let dx = mod(mx - this.vxp, MWP);
      if (dx >= SPLITP_X) dx -= MWP;
      let dy = mod(my - this.vyp, MHP);
      if (dy >= SPLITP_Y) dy -= MHP;
      return [VX + dx, VY + dy];
    }

    lerpPos(px, x, py, y, alpha) {
      const ix = mod(px + wrapDelta(px, x, C.MW) * alpha, C.MW) / 16;
      const iy = mod(py + wrapDelta(py, y, C.MH) * alpha, C.MH) / 16;
      return this.toScreen(ix, iy);
    }

    cellScreen(cx, cy) {
      return this.toScreen(cx * 16 + 8, cy * 16 + 8);
    }

    visible(sx, sy, m) {
      return sx > VX - m && sx < VX + VWP + m && sy > VY - m && sy < VY + VHP + m;
    }

    // ---- main draw ----

    draw(s, alpha, fx, opts) {
      const o = opts || {};
      const ctx = this.ctx;
      const k = this.k;
      const T = (s.tick + alpha) / 60;
      const mz = G.maze(s);
      const pal = A.MAZE_PALETTES[mz.palette];
      A.lowFx = this.low;
      fx.low = this.low;

      this.vxp = mod(s.view.px + wrapDelta(s.view.px, s.view.x, C.MW) * alpha, C.MW) / 16;
      this.vyp = mod(s.view.py + wrapDelta(s.view.py, s.view.y, C.MH) * alpha, C.MH) / 16;
      const [shx, shy] = fx.shakeOffset(T);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.frameLayer(mz.palette).canvas, 0, 0, this.canvas.width, this.canvas.height);

      // ----- the maze window -----
      ctx.save();
      ctx.setTransform(k, 0, 0, k, shx * k, shy * k);
      ctx.beginPath();
      ctx.rect(VX, VY, VWP, VHP);
      ctx.clip();
      const layer = this.mazeLayer(mz, s.scene);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const lsx = layer.w / MWP;
      const lsy = layer.h / MHP;
      const bx = Math.round((VX + shx) * k - this.vxp * lsx);
      const by = Math.round((VY + shy) * k - this.vyp * lsy);
      for (let ox = 0; ox < 2; ox++) {
        for (let oy = 0; oy < 2; oy++) ctx.drawImage(layer.canvas, bx + ox * layer.w, by + oy * layer.h);
      }
      ctx.setTransform(k, 0, 0, k, shx * k, shy * k);

      this.drawFloorItems(s, T, mz);
      this.drawDots(s, T, mz, pal);
      this.drawPickups(s, T, mz);
      this.drawEnemies(s, alpha, T, mz);
      this.drawPlayers(s, alpha, T);
      for (const f of s.fires) {
        const [x, y] = this.lerpPos(f.px, f.x, f.py, f.y, alpha);
        ctx.save();
        ctx.translate(x, y);
        A.drawFireball(ctx, T, f.d);
        ctx.restore();
      }
      fx.draw(ctx, 'maze', T, (x, y) => this.toScreen(x, y));
      this.drawDangerEdge(s, T);
      ctx.drawImage(this.vignette().canvas, VX, VY, VWP, VHP);
      const fa = fx.flashAlpha(T);
      if (fa > 0) {
        ctx.fillStyle = `rgba(${fx.flashColor},${fa * 0.45})`;
        ctx.fillRect(VX, VY, VWP, VHP);
      }
      this.drawBubbles(s, T, o);
      this.drawBanner(s, T, o);
      ctx.restore();

      // ----- frame furniture and HUD -----
      ctx.setTransform(k, 0, 0, k, 0, 0);
      this.drawFrameMotion(s, T, pal);
      this.drawDevil(s, T);
      this.drawHud(s, T, o);
      fx.draw(ctx, 'screen', T, null);
    }

    drawFloorItems(s, T, mz) {
      const ctx = this.ctx;
      for (const c of s.crosses) {
        const [x, y] = this.cellScreen(c.x, c.y);
        if (!this.visible(x, y, 16)) continue;
        ctx.save();
        ctx.translate(x, y);
        A.drawCrossMarker(ctx, c.cd === 0);
        if (c.cd > 0) {
          ctx.beginPath();
          ctx.arc(0, 0, 6.2, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - c.cd / C.CROSS_RESPAWN));
          ctx.strokeStyle = 'rgba(255,220,120,0.55)';
          ctx.lineWidth = 0.9;
          ctx.stroke();
        }
        ctx.restore();
      }
      for (const q of s.seals) {
        const [x, y] = this.cellScreen(q.x, q.y);
        if (!this.visible(x, y, 16)) continue;
        ctx.save();
        ctx.translate(x, y);
        A.drawSeal(ctx, T, q.sealed);
        ctx.restore();
      }
      for (const a of s.arrows) {
        const [x, y] = this.cellScreen(a.x, a.y);
        if (!this.visible(x, y, 16)) continue;
        ctx.save();
        ctx.translate(x, y);
        A.drawArrowTile(ctx, T, a.d, s.scroll.wantDir === a.d);
        ctx.restore();
      }
      // eyes glowing in the nest
      if (!mz.bonus) {
        const waiting = s.enemies.filter((e) => e.st === 'nest').length;
        const [nx, ny] = this.cellScreen(mz.nest.cx, mz.nest.cy);
        if (this.visible(nx, ny, 24)) {
          const ready = waiting > 0 && s.hatchT < 40;
          if (ready) A.glow(ctx, nx, ny - 14, 10, 'rgba(255,60,80,0.8)', 0.5 + 0.5 * Math.sin(T * 12));
          for (let k = 0; k < Math.min(3, waiting); k++) {
            const ex = nx + (k - (Math.min(3, waiting) - 1) / 2) * 9;
            const ey = ny + 2 + Math.sin(T * 2 + k) * 1.5;
            const blink = (T * 0.7 + k * 0.37) % 2.4 < 0.1;
            if (blink) continue;
            ctx.fillStyle = '#ffdf4a';
            for (const s2 of [-1.4, 1.4]) {
              A.ellipse(ctx, ex + s2, ey, 0.9, 0.6);
              ctx.fill();
            }
          }
        }
      }
    }

    drawDots(s, T, mz, pal) {
      if (s.scene !== 'dots' || !s.dots.length) return;
      const ctx = this.ctx;
      const sprite = this.dotSprite(pal.dot);
      const cx0 = Math.floor(this.vxp / 16) - 1;
      const cy0 = Math.floor(this.vyp / 16) - 1;
      for (let j = 0; j <= C.VIEW_H + 2; j++) {
        for (let i = 0; i <= C.VIEW_W + 2; i++) {
          const cx = mod(cx0 + i, mz.W);
          const cy = mod(cy0 + j, mz.H);
          if (!s.dots[cy * mz.W + cx]) continue;
          const [x, y] = this.cellScreen(cx, cy);
          ctx.globalAlpha = 0.72 + 0.28 * Math.sin(T * 3.2 - (cx + cy) * 0.55);
          ctx.drawImage(sprite, x - 6, y - 6, 12, 12);
        }
      }
      ctx.globalAlpha = 1;
    }

    drawPickups(s, T, mz) {
      const ctx = this.ctx;
      const at = (cx, cy, fn) => {
        const [x, y] = this.cellScreen(cx, cy);
        if (!this.visible(x, y, 16)) return;
        ctx.save();
        ctx.translate(x, y);
        fn();
        ctx.restore();
      };
      for (const c of s.crosses) if (c.cd === 0) at(c.x, c.y, () => A.drawCross(ctx, T + c.x));
      for (const t of s.treats) {
        if (t.t <= 0 || (t.t < 120 && Math.floor(T * 8) % 2)) continue;
        at(t.x, t.y, () => A.drawTreat(ctx, T + t.x));
      }
      for (const t of s.toasts) {
        if (t.t < 90 && Math.floor(T * 8) % 2) continue;
        at(G.cellOf(t.x), G.cellOf(t.y), () => A.drawToast(ctx, T, t.kind));
      }
      for (const b of s.bibles) if (b.st === 0) at(b.x, b.y, () => A.drawBible(ctx, T + b.x, 0.8));
      for (const c of s.chests) at(c.x, c.y, () => A.drawChest(ctx, T + c.x, c.open));
    }

    squash(ctx, s, e, x, y) {
      if (!e.squeeze) return;
      const rx = x - VX;
      const ry = y - VY;
      const amt = clamp(e.squeeze / C.CRUSH_TOL, 0, 1) * 0.35;
      const nearX = Math.min(rx, VWP - rx);
      const nearY = Math.min(ry, VHP - ry);
      if (nearX < nearY) ctx.scale(1 - amt, 1 + amt * 0.6);
      else ctx.scale(1 + amt * 0.6, 1 - amt);
    }

    drawEnemies(s, alpha, T, mz) {
      const ctx = this.ctx;
      const [nx, ny] = [mz.nest.cx * 16 + 8, mz.nest.cy * 16 + 8];
      for (const e of s.enemies) {
        if (e.st === 'nest') continue;
        if (e.st === 'spirit') {
          const u = clamp(1 - (e.t - alpha) / 50, 0, 1);
          const sx = e.sx / 16;
          const sy = e.sy / 16;
          const ix = sx + wrapDelta(sx, nx, MWP) * u;
          const iy = sy + wrapDelta(sy, ny, MHP) * u - Math.sin(u * Math.PI) * 10;
          const [x, y] = this.toScreen(ix, iy);
          if (!this.visible(x, y, 16)) continue;
          ctx.save();
          ctx.translate(x, y);
          ctx.globalAlpha = 1 - u * 0.6;
          A.drawSpirit(ctx, T, e.kind);
          ctx.restore();
          continue;
        }
        const [x, y] = this.lerpPos(e.px, e.x, e.py, e.y, alpha);
        if (!this.visible(x, y, 16)) continue;
        ctx.save();
        ctx.translate(x, y);
        if (e.st === 'hatch') {
          const u = clamp(1 - (e.t - alpha) / 45, 0, 1);
          A.glow(ctx, 0, 0, 12, e.kind === 'garg' ? 'rgba(90,220,255,0.8)' : 'rgba(200,90,255,0.8)', 1 - u);
          ctx.translate(0, 6);
          ctx.scale(u, u);
          ctx.translate(0, -6);
          ctx.globalAlpha = 0.4 + u * 0.6;
        }
        this.squash(ctx, s, e, x, y);
        if (e.kind === 'garg') {
          const frozen = e.st === 'frozen' ? 1 : 0;
          A.drawGargling(ctx, { t: T + e.id, walk: e.walkT, dir: e.dir, frozen, thaw: frozen && e.t < 45 ? 1 - e.t / 45 : 0 });
        } else A.drawSlime(ctx, { kind: e.kind, t: T + e.id * 0.7, walk: e.walkT, dir: e.dir });
        ctx.restore();
      }
    }

    drawPlayers(s, alpha, T) {
      const ctx = this.ctx;
      for (let i = 0; i < s.pl.length; i++) {
        const p = s.pl[i];
        if (p.st !== 'walk' && p.st !== 'dead') continue;
        const [x, y] = p.st === 'dead' ? this.toScreen(p.x / 16, p.y / 16) : this.lerpPos(p.px, p.x, p.py, p.y, alpha);
        if (!this.visible(x, y, 20)) continue;
        ctx.save();
        ctx.translate(x, y);
        if (p.st === 'dead') {
          const u = clamp(1 - (p.deadT - alpha) / C.DEATH_TICKS, 0, 1);
          if (p.deadKind === 'crush') {
            ctx.translate(0, 6);
            ctx.scale(1.25 + u * 0.3, Math.max(0.12, 0.35 - u * 0.2));
            ctx.translate(0, -6);
            ctx.globalAlpha = 1 - Math.max(0, u - 0.6) / 0.4;
            A.drawDragon(ctx, { hero: i, face: 2, t: T, moving: false });
          } else {
            ctx.rotate(u * TAU * 2.5);
            ctx.scale(1 - u * 0.7, 1 - u * 0.7);
            ctx.globalAlpha = 1 - Math.max(0, u - 0.5) / 0.5;
            A.drawDragon(ctx, { hero: i, face: 2, t: T, moving: false });
          }
          ctx.restore();
          continue;
        }
        if (p.inv > 0 && Math.floor(T * 15) % 2) ctx.globalAlpha = 0.35;
        const fire = G.hasFire(p);
        if (fire) {
          const warn = p.bible < 0 && p.power < 120;
          if (!warn || Math.floor(T * 10) % 2) {
            A.glow(ctx, 0, 0, 14, p.bible >= 0 ? 'rgba(255,250,210,0.75)' : 'rgba(255,214,90,0.8)', 0.75);
            ctx.save();
            ctx.rotate(T * 2);
            ctx.strokeStyle = p.bible >= 0 ? 'rgba(255,250,220,0.7)' : 'rgba(255,220,110,0.7)';
            ctx.setLineDash([2.5, 3]);
            ctx.lineWidth = 0.8;
            A.circle(ctx, 0, 0, 10.5);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
        }
        ctx.save();
        this.squash(ctx, s, p, x, y);
        A.drawDragon(ctx, { hero: i, face: p.face, t: T + i * 0.3, moving: p.moving, walk: p.walkT / 16, mouth: p.fireAnim / 14 });
        ctx.restore();
        if (p.bible >= 0) {
          ctx.save();
          ctx.translate(0, -13);
          ctx.scale(0.62, 0.62);
          A.drawBible(ctx, T, 0.6);
          ctx.restore();
        }
        if (p.squeeze > 24) {
          ctx.fillStyle = `rgba(255,60,60,${0.25 + 0.25 * Math.sin(T * 30)})`;
          A.circle(ctx, 0, 0, 9);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    drawBubbles(s, T, o) {
      const ctx = this.ctx;
      for (let i = 0; i < s.pl.length; i++) {
        const p = s.pl[i];
        if (p.st !== 'bubble') continue;
        ctx.save();
        ctx.translate(VX + p.bx / 16, VY + p.by / 16);
        A.drawBubble(ctx, T + i, i);
        if (s.phase === 'play' && p.bt > 30 && !o.demo) {
          ctx.globalAlpha = 0.6 + 0.4 * Math.sin(T * 6);
          this.text(s.players === 2 ? (i ? 'P2' : 'P1') : 'GO!', 0, -15, 5.5, '#ffffff', 'center');
        }
        ctx.restore();
      }
    }

    drawDangerEdge(s, T) {
      const ctx = this.ctx;
      const d = s.devil;
      let dir = -1;
      let amt = 0;
      if (s.scene === 'bonus') {
        if (s.scroll.speed > 0) {
          dir = s.scroll.dir;
          amt = 0.5;
        }
      } else if (d.mode === 'warn') {
        dir = d.nextDir;
        amt = 0.35 + 0.35 * Math.sin(T * 20);
      } else if (d.mode === 'scroll') {
        dir = d.dir;
        amt = 0.55 + 0.15 * Math.sin(T * 8);
      }
      if (dir < 0 || amt <= 0) return;
      const w = 22;
      let g;
      if (dir === 3) g = A.linear(ctx, VX, 0, VX + w, 0, [[0, `rgba(255,40,40,${amt})`], [1, 'rgba(255,40,40,0)']]);
      else if (dir === 1) g = A.linear(ctx, VX + VWP, 0, VX + VWP - w, 0, [[0, `rgba(255,40,40,${amt})`], [1, 'rgba(255,40,40,0)']]);
      else if (dir === 0) g = A.linear(ctx, 0, VY, 0, VY + w, [[0, `rgba(255,40,40,${amt})`], [1, 'rgba(255,40,40,0)']]);
      else g = A.linear(ctx, 0, VY + VHP, 0, VY + VHP - w, [[0, `rgba(255,40,40,${amt})`], [1, 'rgba(255,40,40,0)']]);
      ctx.fillStyle = g;
      if (dir === 3) ctx.fillRect(VX, VY, w, VHP);
      else if (dir === 1) ctx.fillRect(VX + VWP - w, VY, w, VHP);
      else if (dir === 0) ctx.fillRect(VX, VY, VWP, w);
      else ctx.fillRect(VX, VY + VHP - w, VWP, w);
    }

    drawFrameMotion(s, T, pal) {
      const ctx = this.ctx;
      const chainCol = 'rgba(200,190,170,0.75)';
      A.drawChain(ctx, 16, VY - 2, 16, VY + VHP + 2, this.vyp, chainCol);
      A.drawChain(ctx, LW - 16, VY - 2, LW - 16, VY + VHP + 2, this.vyp, chainCol);
      A.drawChain(ctx, VX + 6, VY - 5.5, VX + VWP - 6, VY - 5.5, this.vxp, chainCol);
      A.drawChain(ctx, VX + 6, VY + VHP + 5.5, VX + VWP - 6, VY + VHP + 5.5, this.vxp, chainCol);
      const rot = (this.vxp + this.vyp) / 7;
      for (const [x, y] of [
        [VX - 4, VY - 5],
        [VX + VWP + 4, VY - 5],
        [VX - 4, VY + VHP + 5],
        [VX + VWP + 4, VY + VHP + 5],
      ]) {
        ctx.save();
        ctx.translate(x, y);
        A.drawGear(ctx, 6.5, 10, rot, '#9a8456');
        ctx.restore();
      }
      const busy = s.scroll.speed > 0;
      ctx.save();
      ctx.translate(20, LH - 14);
      A.drawImp(ctx, T, rot * 1.6, busy, false);
      ctx.restore();
      ctx.save();
      ctx.translate(LW - 20, LH - 14);
      A.drawImp(ctx, T + 1.3, -rot * 1.6, busy, true);
      ctx.restore();
    }

    drawDevil(s, T) {
      const ctx = this.ctx;
      const d = s.devil;
      let mode = d.mode;
      let dir = d.dir;
      if (mode === 'warn') dir = d.nextDir;
      const warnT = mode === 'warn' ? 1 - d.timer / Math.max(1, G.diffOf(s).warnTicks) : 1;
      ctx.save();
      ctx.translate(LW / 2, 36);
      A.drawDevil(ctx, { t: T, mode, dir, laugh: d.laughT > 0 ? 1 : 0, warn: warnT });
      ctx.restore();
      const showDir = s.scene === 'bonus' ? (s.scroll.speed > 0 ? s.scroll.dir : -1) : mode === 'warn' ? d.nextDir : mode === 'scroll' ? d.dir : -1;
      const lit = s.scene === 'bonus' ? showDir >= 0 : mode === 'warn' || mode === 'scroll';
      for (const x of [LW / 2 - 52, LW / 2 + 52]) {
        ctx.save();
        ctx.translate(x, 40);
        A.drawArrowBadge(ctx, showDir, lit, T);
        ctx.restore();
      }
    }

    text(str, x, y, size, color, align, font, stroke) {
      const ctx = this.ctx;
      ctx.font = `${size}px ${font || DM.FONT_DISPLAY}`;
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'middle';
      if (stroke !== false) {
        ctx.lineWidth = Math.max(1, size * 0.22);
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineJoin = 'round';
        ctx.strokeText(str, x, y);
      }
      ctx.fillStyle = color;
      ctx.fillText(str, x, y);
    }

    drawPlayerHud(s, i, x0, T) {
      const ctx = this.ctx;
      const p = s.pl[i];
      const hero = A.HEROES[i];
      this.text(i ? '2UP' : '1UP', x0 + 7, 12, 7, hero.ui);
      this.text(hero.name.toUpperCase(), x0 + 30, 12, 5, 'rgba(255,255,255,0.55)', 'left', DM.FONT_UI, false);
      this.text(pad(p.score, 7), x0 + 7, 25, 11, '#ffffff');
      // lives
      ctx.save();
      ctx.translate(x0 + 12, 41);
      ctx.scale(0.5, 0.5);
      A.drawDragon(ctx, { hero: i, face: 2, t: T, moving: false });
      ctx.restore();
      this.text('×' + p.lives, x0 + 19, 41, 6.5, p.st === 'out' ? '#ff7a7a' : '#ffffff');
      // power meter
      const bx = x0 + 38;
      const bw = 56;
      A.roundRect(ctx, bx, 38, bw, 6, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      let frac = 0;
      let col = '#ffd35a';
      if (p.bible >= 0) {
        frac = 1;
        col = '#fff3c8';
      } else if (p.power > 0) {
        frac = p.power / G.diffOf(s).crossTicks;
        if (p.power < 120 && Math.floor(T * 10) % 2) col = '#ff7a5a';
      }
      if (frac > 0) {
        A.roundRect(ctx, bx, 38, Math.max(6, bw * clamp(frac, 0, 1)), 6, 3);
        ctx.fillStyle = col;
        ctx.fill();
      }
      if (p.st === 'out') this.text('OUT', bx + bw / 2, 41, 5, '#ff9a9a', 'center', DM.FONT_UI, false);
      else if (p.bible >= 0) this.text('BIBLE', bx + bw / 2, 41, 4.5, '#5a3a10', 'center', DM.FONT_UI, false);
      else if (p.power > 0) this.text('CROSS', bx + bw / 2, 41, 4.5, '#5a3a10', 'center', DM.FONT_UI, false);
      else this.text('NO POWER', bx + bw / 2, 41, 4.5, 'rgba(255,255,255,0.35)', 'center', DM.FONT_UI, false);
    }

    drawHud(s, T, o) {
      const ctx = this.ctx;
      this.drawPlayerHud(s, 0, 5, T);
      if (s.players === 2) this.drawPlayerHud(s, 1, LW - 105, T);
      else {
        this.text('TOP', LW - 98, 12, 7, '#ffcf4a');
        this.text(pad(Math.max(s.top, o.top || 0), 7), LW - 98, 25, 11, '#ffffff');
        this.text(G.maze(s).name.toUpperCase(), LW - 98, 41, 5.5, 'rgba(255,255,255,0.6)', 'left', DM.FONT_UI, false);
      }
      // bottom bar
      const y = LH - 13;
      this.text('ROUND ' + pad(s.round, 2), 44, y, 7.5, '#ffffff');
      const scLabel = s.scene === 'dots' ? 'SCENE 1' : s.scene === 'bibles' ? 'SCENE 2' : 'BONUS';
      this.text(scLabel, 116, y, 6, '#ffcf4a');
      const two = s.players === 2;
      const barW = two ? 46 : 70;
      const bar = (frac, color) => {
        A.roundRect(ctx, 152, y - 3, barW, 6, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        A.roundRect(ctx, 152, y - 3, Math.max(6, barW * clamp(frac, 0, 1)), 6, 3);
        ctx.fillStyle = color;
        ctx.fill();
      };
      if (s.scene === 'dots') {
        bar(s.dotsTotal ? 1 - s.dotsLeft / s.dotsTotal : 0, A.MAZE_PALETTES[G.maze(s).palette].dot);
        this.text(String(s.dotsLeft), 156 + barW, y, 6, '#ffffff', 'left', DM.FONT_UI, true);
      } else if (s.scene === 'bibles') {
        s.seals.forEach((q, k) => {
          ctx.save();
          ctx.translate(158 + k * (two ? 12 : 14), y);
          ctx.scale(two ? 0.55 : 0.62, two ? 0.55 : 0.62);
          A.drawSeal(ctx, T, q.sealed);
          ctx.restore();
        });
      } else {
        const frac = s.bonusT / C.BONUS_TICKS;
        bar(frac, frac < 0.25 && Math.floor(T * 6) % 2 ? '#ff6a5a' : '#5ad1ff');
        this.text(Math.ceil(s.bonusT / 60) + 's', 156 + barW, y, 6, '#ffffff', 'left', DM.FONT_UI, true);
      }
      if (two) {
        this.text('TOP', 226, y, 5, '#ffcf4a', 'left', DM.FONT_UI, false);
        this.text(pad(Math.max(s.top, o.top || 0), 7), LW - 42, y, 6.5, '#ffffff', 'right');
      }
    }

    drawBanner(s, T, o) {
      let title = '';
      let sub = '';
      let u = 1;
      if (s.phase === 'intro') {
        u = clamp((130 - s.phaseT) / 20, 0, 1) * clamp(s.phaseT / 15, 0, 1);
        title = s.scene === 'bonus' ? 'BONUS ROUND' : 'ROUND ' + s.round;
        sub =
          s.scene === 'dots'
            ? 'Grab a cross, then clear every magic dot!'
            : s.scene === 'bibles'
              ? 'Carry the 4 Bibles to the Devil gates!'
              : 'Step on arrows to steer — open the chests!';
      } else if (s.phase === 'clear') {
        u = clamp((160 - s.phaseT) / 20, 0, 1);
        title = s.scene === 'bonus' ? 'BONUS OVER' : 'SCENE CLEAR!';
        sub = s.scene === 'dots' ? 'Next: seal the gates' : s.scene === 'bibles' ? 'Next: bonus round' : 'On to round ' + (s.round + 1);
      } else if (s.phase === 'gameover') {
        u = clamp((330 - s.phaseT) / 30, 0, 1);
        title = 'GAME OVER';
        sub = 'The Devil keeps his maze… for now.';
      } else if (o.demo) {
        return;
      } else return;
      if (u <= 0) return;
      const ctx = this.ctx;
      const cx = VX + VWP / 2;
      const cy = VY + VHP / 2;
      ctx.save();
      ctx.globalAlpha = u;
      ctx.fillStyle = 'rgba(8,4,16,0.55)';
      ctx.fillRect(VX, cy - 24, VWP, 46);
      ctx.translate(cx, cy - 6);
      const sc = 0.8 + 0.2 * u;
      ctx.scale(sc, sc);
      ctx.font = `20px ${DM.FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(title, 0, 0);
      ctx.fillStyle = A.linear(ctx, 0, -10, 0, 10, [
        [0, '#fff4c2'],
        [0.5, '#ffb347'],
        [1, '#ff4d6d'],
      ]);
      ctx.fillText(title, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = u;
      this.text(sub, cx, cy + 13, 6.5, '#ffffff', 'center', DM.FONT_UI);
      ctx.restore();
    }
  }

  DM.Renderer = Renderer;
  DM.render = { traceWalls };
})(typeof window !== 'undefined' ? window : globalThis);
