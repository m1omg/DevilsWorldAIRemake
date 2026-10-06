#!/usr/bin/env node
/*
 * Devil's Maze — automated playthrough.
 *   node tests/bot-playthrough.js [rounds] [seed]
 * A simple path-finding bot plays the real rules (scrolling, crushing, power
 * timers) for several rounds. Enemies are made harmless and lives refilled so
 * the run measures whether every scene can be finished and how often the
 * moving frame crushes a player who walks into danger.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, Math, JSON };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['util.js', 'config.js', 'mazes.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const DM = ctx.DM;
const G = DM.game;
const C = DM.C;
const { mod, DX, DY } = DM.util;

const ROUNDS = +(process.argv[2] || 3);
const SEED = +(process.argv[3] || 2024);

function dangerDir(s) {
  if (s.scene === 'bonus') return s.scroll.speed > 0 ? s.scroll.dir : -1;
  if (s.devil.mode === 'scroll') return s.devil.dir;
  if (s.devil.mode === 'warn') return s.devil.nextDir;
  return -1;
}

function safeCell(s, cx, cy) {
  const d = dangerDir(s);
  if (d < 0) return true;
  const rx = G.relX(s, G.centerOf(mod(cx, C.MAZE_W)));
  const ry = G.relY(s, G.centerOf(mod(cy, C.MAZE_H)));
  const m = 1.6 * C.CELL;
  if (d === 3) return rx > m;
  if (d === 1) return rx < C.VWU - m;
  if (d === 0) return ry > m;
  return ry < C.VHU - m;
}

function bfs(s, from, isTarget, avoidDanger) {
  const mz = G.maze(s);
  const key = (x, y) => y * mz.W + x;
  const start = key(from[0], from[1]);
  const prev = new Map([[start, -1]]);
  const firstDir = new Map([[start, -1]]);
  const q = [from];
  while (q.length) {
    const [x, y] = q.shift();
    const k = key(x, y);
    if (k !== start && isTarget(x, y)) return firstDir.get(k);
    for (let d = 0; d < 4; d++) {
      const nx = mod(x + DX[d], mz.W);
      const ny = mod(y + DY[d], mz.H);
      const nk = key(nx, ny);
      if (prev.has(nk) || !DM.mazes.isFloor(mz, nx, ny) || !G.cellInView(s, nx, ny)) continue;
      if (avoidDanger && !safeCell(s, nx, ny)) continue;
      prev.set(nk, k);
      firstDir.set(nk, k === start ? d : firstDir.get(k));
      q.push([nx, ny]);
    }
  }
  return -1;
}

const lastDir = [-1, -1];
function botInput(s, i) {
  const p = s.pl[i];
  if (p.st === 'bubble') return { dir: [2, 0, 1, 3][(s.tick >> 5) & 3], fire: false };
  if (p.st !== 'walk') return { dir: -1, fire: false };
  // Between two cells: keep going (re-planning here would make the bot dither).
  const centred = mod(p.x - 128, C.CELL) === 0 && mod(p.y - 128, C.CELL) === 0;
  if (!centred && p.dir >= 0 && lastDir[i] >= 0) return { dir: lastDir[i], fire: aimFire(s, p) };
  const cx = G.cellOf(p.x);
  const cy = G.cellOf(p.y);
  const mz = G.maze(s);
  let isTarget;
  if (s.scene === 'dots') {
    if (p.power < 100) isTarget = (x, y) => s.crosses.some((c) => c.cd === 0 && c.x === x && c.y === y);
    else isTarget = (x, y) => s.dots[y * mz.W + x] === 1 || s.toasts.some((t) => G.cellOf(t.x) === x && G.cellOf(t.y) === y);
  } else if (s.scene === 'bibles') {
    if (p.bible >= 0) isTarget = (x, y) => s.seals.some((q) => !q.sealed && q.x === x && q.y === y);
    else isTarget = (x, y) => s.bibles.some((b) => b.st === 0 && b.x === x && b.y === y);
  } else {
    isTarget = (x, y) => s.chests.some((c) => !c.open && c.x === x && c.y === y);
  }
  let dir = bfs(s, [cx, cy], isTarget, true);
  if (dir < 0) dir = bfs(s, [cx, cy], isTarget, false);
  if (dir < 0 && s.scene === 'bonus') {
    // no chest in view: ride an arrow that points towards a hidden chest region
    const want = (s.tick >> 9) & 3;
    dir = bfs(s, [cx, cy], (x, y) => s.arrows.some((a) => a.x === x && a.y === y && a.d === want), true);
  }
  if (dir < 0) {
    // wander towards the middle of the window, away from the closing edge
    dir = bfs(
      s,
      [cx, cy],
      (x, y) => {
        const rx = G.relX(s, G.centerOf(x));
        const ry = G.relY(s, G.centerOf(y));
        return Math.abs(rx - C.VWU / 2) < 2 * C.CELL && Math.abs(ry - C.VHU / 2) < 2 * C.CELL;
      },
      true
    );
  }
  lastDir[i] = dir;
  return { dir, fire: aimFire(s, p) };
}

// Breathe fire at an enemy straight ahead.
function aimFire(s, p) {
  if (!G.hasFire(p)) return false;
  for (const e of s.enemies) {
    if (e.st !== 'walk') continue;
    const dx = DM.util.wrapDelta(p.x, e.x, C.MW);
    const dy = DM.util.wrapDelta(p.y, e.y, C.MH);
    const f = p.face;
    if ((f === 1 && dx > 0 && dx < 1100 && Math.abs(dy) < 100) || (f === 3 && dx < 0 && dx > -1100 && Math.abs(dy) < 100) || (f === 2 && dy > 0 && dy < 1100 && Math.abs(dx) < 100) || (f === 0 && dy < 0 && dy > -1100 && Math.abs(dx) < 100)) return true;
  }
  return false;
}

const s = G.newGame({ players: 1, seed: SEED });
const ev = [];
const stats = [];
let cur = { round: s.round, scene: s.scene, ticks: 0, crushes: 0, burns: 0, freezes: 0, crosses: 0, enemyCrushes: 0 };
let guard = 0;
while (s.round <= ROUNDS && guard++ < 60 * 60 * 60 * 2) {
  ev.length = 0;
  const p = s.pl[0];
  p.inv = Math.max(p.inv, 2); // enemies can't hurt the bot; the frame still can
  if (p.lives < 2) p.lives = 3;
  G.tick(s, [botInput(s, 0)], ev);
  cur.ticks++;
  for (const e of ev) {
    if (e.t === 'die' && e.kind === 'crush') cur.crushes++;
    if (e.t === 'burn') cur.burns++;
    if (e.t === 'freeze') cur.freezes++;
    if (e.t === 'cross') cur.crosses++;
    if (e.t === 'enemyCrush') cur.enemyCrushes++;
    if (e.t === 'scene') {
      stats.push(cur);
      cur = { round: s.round, scene: s.scene, ticks: 0, crushes: 0, burns: 0, freezes: 0, crosses: 0, enemyCrushes: 0 };
    }
  }
  if (cur.ticks > 60 * 60 * 15) {
    console.log('STUCK', JSON.stringify(cur), 'dotsLeft', s.dotsLeft);
    process.exit(1);
  }
}
for (const st of stats) {
  console.log(
    `round ${st.round} ${st.scene.padEnd(6)} ${(st.ticks / 60).toFixed(1).padStart(6)} s  crushed ${st.crushes}  crosses ${st.crosses}  burnt ${st.burns}  frozen ${st.freezes}  enemies crushed ${st.enemyCrushes}`
  );
}
console.log('final score', s.pl[0].score, 'round', s.round, 'scene', s.scene);
