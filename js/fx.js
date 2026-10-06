/*
 * Devil's Maze — particles, score pop-ups, screen shake and flashes.
 *
 * Purely visual and never saved. Particles are spawned from simulation ticks
 * and events (so their number does not depend on the display refresh rate)
 * and move along closed-form curves evaluated at the render time, so they stay
 * smooth at 30, 60, 144 or 240 Hz.
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});
  const A = DM.art;
  const TAU = Math.PI * 2;
  const MAX_PARTS = 700;

  function rnd(a, b) {
    return a + Math.random() * (b - a);
  }

  class FX {
    constructor() {
      this.parts = [];
      this.low = false;
      this.shakeOn = true;
      this.shakeT0 = -10;
      this.shakeAmp = 0;
      this.shakeDur = 0;
      this.flashT0 = -10;
      this.flashDur = 0;
      this.flashColor = '255,255,255';
    }

    clear() {
      this.parts.length = 0;
      this.shakeAmp = 0;
      this.flashDur = 0;
    }

    add(p) {
      if (this.parts.length >= MAX_PARTS) this.parts.shift();
      this.parts.push(p);
    }

    // space: 'maze' (x, y in maze pixels, scrolls with the maze) or 'screen'
    burst(space, T, x, y, n, o) {
      if (this.low) n = Math.ceil(n / 2);
      for (let k = 0; k < n; k++) {
        const a = o.angle !== undefined ? o.angle + rnd(-o.spread || 0, o.spread || 0) : rnd(0, TAU);
        const sp = rnd(o.speed[0], o.speed[1]);
        this.add({
          space,
          kind: o.kind || 'spark',
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp + (o.vy || 0),
          ax: 0,
          ay: o.gravity || 0,
          t0: T - rnd(0, o.jitter || 0),
          life: rnd(o.life[0], o.life[1]),
          size: rnd(o.size[0], o.size[1]),
          color: Array.isArray(o.color) ? o.color[(Math.random() * o.color.length) | 0] : o.color,
          rot: rnd(0, TAU),
          vr: rnd(-8, 8),
          blend: o.blend || 'lighter',
          text: o.text,
        });
      }
    }

    ring(space, T, x, y, r0, r1, life, color, width) {
      this.add({ space, kind: 'ring', x, y, vx: 0, vy: 0, ax: 0, ay: 0, t0: T, life, size: r0, size1: r1, color, w: width || 1.2, blend: 'lighter' });
    }

    text(space, T, x, y, str, color, size, life) {
      this.add({ space, kind: 'text', x, y, vx: 0, vy: -16, ax: 0, ay: 8, t0: T, life: life || 1, size: size || 7, color, text: str, blend: 'source-over' });
    }

    shake(T, amp, dur) {
      if (!this.shakeOn) return;
      if (T - this.shakeT0 < this.shakeDur && amp < this.shakeAmp) return;
      this.shakeT0 = T;
      this.shakeAmp = amp;
      this.shakeDur = dur;
    }

    flash(T, color, dur) {
      this.flashT0 = T;
      this.flashDur = dur;
      this.flashColor = color;
    }

    shakeOffset(T) {
      const dt = T - this.shakeT0;
      if (dt < 0 || dt > this.shakeDur || !this.shakeOn) return [0, 0];
      const k = 1 - dt / this.shakeDur;
      const a = this.shakeAmp * k * k;
      return [Math.sin(T * 83.1) * a, Math.cos(T * 71.7) * a];
    }

    flashAlpha(T) {
      const dt = T - this.flashT0;
      if (dt < 0 || dt > this.flashDur) return 0;
      return 1 - dt / this.flashDur;
    }

    // Map game events to effects. T = simulation time in seconds.
    emit(e, s, T) {
      const px = (u) => u / 16;
      const pal = A.MAZE_PALETTES[DM.game.maze(s).palette];
      switch (e.t) {
        case 'dot':
          this.burst('maze', T, px(e.x), px(e.y), 5, { speed: [18, 42], life: [0.2, 0.4], size: [0.6, 1.2], color: hexRgb(pal.dot) });
          break;
        case 'fire':
          this.burst('maze', T, px(e.x), px(e.y), 6, { speed: [10, 30], life: [0.15, 0.3], size: [1.5, 2.5], color: ['255,190,80', '255,120,40'], kind: 'glow' });
          break;
        case 'fizzle':
          this.burst('maze', T, px(e.x), px(e.y) - 2, 4, { speed: [5, 14], life: [0.4, 0.7], size: [1.5, 2.5], color: '150,150,170', kind: 'smoke', blend: 'source-over', vy: -10 });
          break;
        case 'fireEnd':
          this.burst('maze', T, px(e.x), px(e.y), 7, { speed: [15, 45], life: [0.2, 0.4], size: [0.7, 1.4], color: ['255,210,90', '255,130,50'] });
          this.burst('maze', T, px(e.x), px(e.y), 2, { speed: [3, 8], life: [0.4, 0.6], size: [2, 3], color: '120,110,120', kind: 'smoke', blend: 'source-over', vy: -8 });
          break;
        case 'burn':
          this.burst('maze', T, px(e.x), px(e.y), 18, { speed: [25, 75], life: [0.3, 0.6], size: [0.8, 1.8], color: ['255,220,90', '255,140,40', '255,80,40'] });
          this.burst('maze', T, px(e.x), px(e.y), 5, { speed: [4, 14], life: [0.6, 1], size: [2.5, 4], color: '90,80,100', kind: 'smoke', blend: 'source-over', vy: -10 });
          this.ring('maze', T, px(e.x), px(e.y), 3, 16, 0.35, '255,170,70');
          this.shake(T, 1.2, 0.2);
          break;
        case 'freeze':
          this.burst('maze', T, px(e.x), px(e.y), 12, { speed: [20, 55], life: [0.35, 0.7], size: [1, 2], color: ['200,245,255', '120,220,255'], kind: 'shard', blend: 'source-over', gravity: 60 });
          this.ring('maze', T, px(e.x), px(e.y), 3, 14, 0.35, '150,230,255');
          break;
        case 'thaw':
          this.burst('maze', T, px(e.x), px(e.y), 6, { speed: [10, 25], life: [0.3, 0.5], size: [0.6, 1], color: '160,220,255', kind: 'drop', blend: 'source-over', gravity: 120, vy: -15 });
          break;
        case 'cross':
          this.ring('maze', T, px(e.x), px(e.y), 4, 22, 0.5, '255,220,120', 1.6);
          this.burst('maze', T, px(e.x), px(e.y), 14, { speed: [20, 60], life: [0.4, 0.8], size: [0.8, 1.6], color: ['255,240,170', '255,210,90'], kind: 'star' });
          break;
        case 'crossBack':
          this.burst('maze', T, px(e.x), px(e.y), 6, { speed: [8, 20], life: [0.4, 0.7], size: [0.8, 1.4], color: '255,230,150', kind: 'star' });
          break;
        case 'points':
          this.text('maze', T, px(e.x), px(e.y) - 6, String(e.pts), e.p === 1 ? '#ffb2a3' : '#9cffe0', e.pts >= 1000 ? 7.5 : 6.5, 1);
          break;
        case 'treat':
        case 'toast':
          this.burst('maze', T, px(e.x), px(e.y), 10, { speed: [15, 40], life: [0.3, 0.6], size: [0.8, 1.4], color: ['255,200,220', '255,240,180'], kind: 'star' });
          break;
        case 'bible':
          this.ring('maze', T, px(e.x), px(e.y), 4, 20, 0.5, '255,245,200', 1.6);
          this.burst('maze', T, px(e.x), px(e.y), 14, { speed: [15, 45], life: [0.5, 0.9], size: [0.8, 1.6], color: ['255,255,255', '255,230,150'], kind: 'star' });
          break;
        case 'seal':
          this.ring('maze', T, px(e.x), px(e.y), 4, 34, 0.7, '255,230,150', 2.2);
          this.add({ space: 'maze', kind: 'beam', x: px(e.x), y: px(e.y), vx: 0, vy: 0, ax: 0, ay: 0, t0: T, life: 1.1, size: 8, color: '255,240,190', blend: 'lighter' });
          this.burst('maze', T, px(e.x), px(e.y), 26, { speed: [20, 70], life: [0.5, 1], size: [0.8, 1.8], color: ['255,255,255', '255,220,120'], kind: 'star' });
          this.flash(T, '255,236,170', 0.35);
          this.shake(T, 1.6, 0.3);
          break;
        case 'chest':
          this.burst('maze', T, px(e.x), px(e.y) - 2, 12, { speed: [30, 60], life: [0.5, 0.9], size: [1, 1.6], color: ['255,215,80', '255,240,160'], kind: 'coin', blend: 'source-over', gravity: 140, angle: -Math.PI / 2, spread: 0.9 });
          break;
        case 'egg':
          this.burst('maze', T, px(e.x), px(e.y), 22, { speed: [20, 60], life: [0.6, 1.1], size: [0.8, 1.6], color: ['255,120,120', '255,220,120', '140,255,160', '120,200,255', '220,140,255'], kind: 'star' });
          this.text('maze', T, px(e.x), px(e.y) - 8, '1UP', '#9cffb0', 8, 1.3);
          this.flash(T, '160,255,200', 0.25);
          break;
        case 'die':
          if (e.kind === 'crush') {
            this.burst('maze', T, px(e.x), px(e.y), 16, { speed: [20, 50], life: [0.4, 0.8], size: [1.5, 3], color: '170,160,180', kind: 'smoke', blend: 'source-over' });
            this.flash(T, '255,60,60', 0.25);
            this.shake(T, 3.5, 0.45);
          } else {
            this.burst('maze', T, px(e.x), px(e.y), 14, { speed: [20, 50], life: [0.5, 0.9], size: [1, 1.8], color: ['255,255,255', '255,230,120'], kind: 'star' });
            this.flash(T, '255,255,255', 0.15);
            this.shake(T, 2.5, 0.35);
          }
          break;
        case 'hatch':
          this.ring('maze', T, px(e.x), px(e.y), 10, 2, 0.5, e.kind === 'garg' ? '120,230,255' : '200,120,255', 1.4);
          this.burst('maze', T, px(e.x), px(e.y), 10, { speed: [10, 30], life: [0.3, 0.6], size: [0.8, 1.4], color: ['200,140,255', '255,120,220'] });
          break;
        case 'enemyCrush':
          this.burst('maze', T, px(e.x), px(e.y), 12, { speed: [20, 55], life: [0.3, 0.6], size: [1, 2], color: e.kind === 'garg' ? '140,150,200' : e.kind === 'fury' ? '255,110,60' : '170,110,255', kind: 'drop', blend: 'source-over', gravity: 90 });
          this.ring('maze', T, px(e.x), px(e.y), 3, 14, 0.3, '220,180,255');
          break;
        case 'pop':
          this.ring('maze', T, px(e.x), px(e.y), 6, 16, 0.35, '200,240,255', 1.2);
          this.burst('maze', T, px(e.x), px(e.y), 12, { speed: [25, 50], life: [0.25, 0.45], size: [0.6, 1.1], color: ['220,250,255', '255,200,255'] });
          break;
        case 'arrow':
          this.ring('maze', T, px(e.x), px(e.y), 4, 16, 0.4, '120,220,255', 1.4);
          break;
        case 'treats':
          for (const [x, y] of e.at) {
            this.ring('maze', T, px(x), px(y), 2, 14, 0.6, '255,120,150', 1.4);
            this.burst('maze', T, px(x), px(y), 8, { speed: [10, 30], life: [0.4, 0.8], size: [0.7, 1.3], color: ['255,200,220', '255,120,150'], kind: 'star' });
          }
          break;
        case 'clear':
          for (let k = 0; k < (this.low ? 30 : 70); k++) {
            this.add({
              space: 'screen',
              kind: 'confetti',
              x: rnd(40, 280),
              y: rnd(40, 70),
              vx: rnd(-40, 40),
              vy: rnd(-90, -20),
              ax: 0,
              ay: 120,
              t0: T + rnd(0, 0.3),
              life: rnd(1.4, 2.2),
              size: rnd(1.2, 2.2),
              color: ['255,90,120', '255,220,90', '90,230,180', '120,180,255', '220,140,255'][k % 5],
              rot: rnd(0, TAU),
              vr: rnd(-10, 10),
              blend: 'source-over',
            });
          }
          break;
        default:
          break;
      }
    }

    // Per-tick ambient effects (fire trails, squeeze dust, Devil's laugh...).
    tick(s, T) {
      const px = (u) => u / 16;
      for (const f of s.fires) {
        this.burst('maze', T, px(f.x), px(f.y), 2, { speed: [4, 16], life: [0.18, 0.35], size: [1, 2.2], color: ['255,200,80', '255,120,40', '255,90,30'], kind: 'glow' });
      }
      if (s.tick % 3 === 0) {
        for (const p of s.pl) {
          if (p.st === 'walk' && p.squeeze > 8) {
            this.burst('maze', T, px(p.x), px(p.y) + 5, 2, { speed: [8, 24], life: [0.3, 0.5], size: [1, 2], color: '200,190,210', kind: 'smoke', blend: 'source-over' });
            if (s.tick % 12 === 0) this.burst('maze', T, px(p.x) + rnd(-4, 4), px(p.y) - 6, 1, { speed: [6, 12], life: [0.4, 0.6], size: [0.8, 1], color: '170,220,255', kind: 'drop', blend: 'source-over', gravity: 60, vy: -20 });
          }
        }
      }
      if (s.tick % 6 === 0) {
        for (const p of s.pl) {
          if (p.st === 'walk' && DM.game.hasFire(p)) {
            this.burst('maze', T, px(p.x) + rnd(-6, 6), px(p.y) + rnd(-6, 6), 1, { speed: [2, 8], life: [0.4, 0.7], size: [0.6, 1.1], color: p.bible >= 0 ? '255,250,220' : '255,225,120', kind: 'star', vy: -10 });
          }
        }
      }
      if (s.tick % 5 === 0) {
        for (const e of s.enemies) {
          if (e.kind === 'fury' && e.st === 'walk') {
            this.burst('maze', T, px(e.x), px(e.y) - 4, 1, { speed: [2, 6], life: [0.3, 0.5], size: [0.8, 1.4], color: '255,140,60', kind: 'glow', vy: -14 });
          }
        }
      }
      const d = s.devil;
      if (s.scene === 'bonus' && s.tick % 55 === 0) {
        this.add({ space: 'screen', kind: 'z', x: 172, y: 18, vx: 8, vy: -10, ax: 0, ay: 0, t0: T, life: 1.6, size: 5, color: '220,220,255', blend: 'source-over', text: 'z' });
      }
      if (d.laughT > 0 && s.tick % 18 === 0) {
        this.add({ space: 'screen', kind: 'text', x: 160 + rnd(-24, 24), y: 20, vx: rnd(-10, 10), vy: -18, ax: 0, ay: 0, t0: T, life: 0.8, size: 6, color: '#ffcf4a', text: 'HA!', blend: 'source-over' });
      }
    }

    // Draw the particles of one space. toScreen maps maze px -> screen px.
    draw(ctx, space, T, toScreen) {
      const parts = this.parts;
      let w = 0;
      for (let k = 0; k < parts.length; k++) {
        const p = parts[k];
        const dt = T - p.t0;
        if (dt > p.life) continue;
        parts[w++] = p;
        if (p.space !== space || dt < 0) continue;
        const u = dt / p.life;
        let x = p.x + p.vx * dt + 0.5 * p.ax * dt * dt;
        let y = p.y + p.vy * dt + 0.5 * p.ay * dt * dt;
        if (toScreen) {
          const sp = toScreen(x, y);
          x = sp[0];
          y = sp[1];
        }
        drawParticle(ctx, p, x, y, u, dt);
      }
      parts.length = w;
    }
  }

  function drawParticle(ctx, p, x, y, u, dt) {
    const a = 1 - u;
    ctx.globalCompositeOperation = p.blend;
    switch (p.kind) {
      case 'spark':
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgb(${p.color})`;
        A.circle(ctx, x, y, p.size * (1 - u * 0.6));
        ctx.fill();
        break;
      case 'glow': {
        const r = p.size * (1 + u * 0.8);
        ctx.globalAlpha = a * 0.9;
        A.circle(ctx, x, y, r);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${p.color},1)`);
        g.addColorStop(1, `rgba(${p.color},0)`);
        ctx.fillStyle = g;
        ctx.fill();
        break;
      }
      case 'smoke':
        ctx.globalAlpha = a * 0.45;
        ctx.fillStyle = `rgb(${p.color})`;
        A.circle(ctx, x, y, p.size * (0.6 + u));
        ctx.fill();
        break;
      case 'shard':
        ctx.globalAlpha = a;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot + p.vr * dt);
        ctx.beginPath();
        ctx.moveTo(0, -p.size * 1.6);
        ctx.lineTo(p.size * 0.7, 0);
        ctx.lineTo(0, p.size * 1.6);
        ctx.lineTo(-p.size * 0.7, 0);
        ctx.closePath();
        ctx.fillStyle = `rgb(${p.color})`;
        ctx.fill();
        ctx.restore();
        break;
      case 'star':
        ctx.globalAlpha = a;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot + dt * 4);
        ctx.fillStyle = `rgb(${p.color})`;
        ctx.beginPath();
        const s = p.size * (1.2 - u * 0.6);
        ctx.moveTo(0, -s * 2);
        ctx.lineTo(s * 0.45, -s * 0.45);
        ctx.lineTo(s * 2, 0);
        ctx.lineTo(s * 0.45, s * 0.45);
        ctx.lineTo(0, s * 2);
        ctx.lineTo(-s * 0.45, s * 0.45);
        ctx.lineTo(-s * 2, 0);
        ctx.lineTo(-s * 0.45, -s * 0.45);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      case 'drop':
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgb(${p.color})`;
        A.ellipse(ctx, x, y, p.size * 0.8, p.size * 1.2);
        ctx.fill();
        break;
      case 'coin':
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgb(${p.color})`;
        A.ellipse(ctx, x, y, p.size * Math.abs(Math.cos(dt * 14)) + 0.2, p.size);
        ctx.fill();
        break;
      case 'confetti':
        ctx.globalAlpha = Math.min(1, a * 2);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot + p.vr * dt);
        ctx.fillStyle = `rgb(${p.color})`;
        ctx.fillRect(-p.size, -p.size * 0.5 * Math.abs(Math.cos(dt * 9)), p.size * 2, p.size * Math.abs(Math.cos(dt * 9)) + 0.2);
        ctx.restore();
        break;
      case 'ring':
        ctx.globalAlpha = a;
        ctx.strokeStyle = `rgb(${p.color})`;
        ctx.lineWidth = p.w * a + 0.2;
        A.circle(ctx, x, y, p.size + (p.size1 - p.size) * Math.sqrt(u));
        ctx.stroke();
        break;
      case 'beam': {
        ctx.globalAlpha = a * 0.8;
        const g = ctx.createLinearGradient(x, y - 80, x, y);
        g.addColorStop(0, `rgba(${p.color},0)`);
        g.addColorStop(1, `rgba(${p.color},0.9)`);
        ctx.fillStyle = g;
        const w = p.size * (1 - u * 0.5);
        ctx.fillRect(x - w / 2, y - 80, w, 80);
        break;
      }
      case 'text':
      case 'z':
        ctx.globalAlpha = Math.min(1, a * 1.8);
        ctx.font = `${p.size}px ${DM.FONT_DISPLAY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(p.text, x, y);
        ctx.fillStyle = p.color.charAt(0) === '#' ? p.color : `rgb(${p.color})`;
        ctx.fillText(p.text, x, y);
        break;
      default:
        break;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }

  DM.FONT_DISPLAY = '"Bungee", "Arial Black", Impact, system-ui, sans-serif';
  DM.FONT_UI = '"Rubik", "Segoe UI", system-ui, sans-serif';
  DM.FX = FX;
  DM.hexRgb = hexRgb;
})(typeof window !== 'undefined' ? window : globalThis);
