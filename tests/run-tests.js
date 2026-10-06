#!/usr/bin/env node
/*
 * Devil's Maze — headless test suite (no dependencies).
 *   node tests/run-tests.js
 * Loads the browser scripts into a Node VM context and checks the rules,
 * determinism, saving and the fixed-timestep loop.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['util.js', 'config.js', 'mazes.js', 'game.js', 'art.js', 'render.js', 'save.js', 'loop.js'];

function makeContext() {
  const store = new Map();
  const ctx = {
    console,
    Math,
    JSON,
    Date,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  return ctx;
}

const ctx = makeContext();
const DM = ctx.DM;
const G = DM.game;
const C = DM.C;
const { mod, DX, DY } = DM.util;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'expected equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b));
}

// Deterministic pseudo-random input script.
function scriptInput(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let dir = -1;
  return (tick, players) => {
    const out = [];
    for (let i = 0; i < players; i++) {
      if (tick % 23 === 0) dir = next() < 0.15 ? -1 : Math.floor(next() * 4);
      out.push({ dir: (dir + i) % 4, fire: next() < 0.06 });
    }
    return out;
  };
}

function run(s, ticks, inputFn) {
  const ev = [];
  for (let t = 0; t < ticks; t++) {
    ev.length = 0;
    G.tick(s, inputFn ? inputFn(s.tick, s.players) : [], ev);
  }
  return s;
}

const snap = (s) => JSON.stringify(G.serialize(s));
// px/py are render interpolation only; compare without them.
const simSnap = (s) =>
  JSON.stringify(G.serialize(s), (k, v) => (k === 'px' || k === 'py' ? undefined : v));

console.log('Mazes');
for (const id of Object.keys(DM.mazes.LAYOUTS)) {
  test(`maze "${id}" is valid (size, wrap-around, no dead ends, connected, items on floor)`, () => {
    const mz = DM.mazes.get(id);
    eq(mz.W, C.MAZE_W, 'width');
    eq(mz.H, C.MAZE_H, 'height');
    let floor = 0;
    let start = -1;
    for (let y = 0; y < mz.H; y++) {
      for (let x = 0; x < mz.W; x++) {
        if (!DM.mazes.isFloor(mz, x, y)) continue;
        floor++;
        if (start < 0) start = y * mz.W + x;
        let n = 0;
        for (let d = 0; d < 4; d++) if (DM.mazes.isFloor(mz, x + DX[d], y + DY[d])) n++;
        assert(n >= 2, `dead end at ${x},${y}`);
        // no 2x2 open areas: corridors are one cell wide
        assert(
          !(DM.mazes.isFloor(mz, x + 1, y) && DM.mazes.isFloor(mz, x, y + 1) && DM.mazes.isFloor(mz, x + 1, y + 1)),
          `2x2 open block at ${x},${y}`
        );
      }
    }
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const k = stack.pop();
      const x = k % mz.W;
      const y = (k / mz.W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = mod(x + DX[d], mz.W);
        const ny = mod(y + DY[d], mz.H);
        const j = ny * mz.W + nx;
        if (DM.mazes.isFloor(mz, nx, ny) && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    eq(seen.size, floor, 'all floor connected');
    const items = [].concat(mz.crosses, mz.treats, mz.bibles, mz.seals, mz.chests, mz.arrows, mz.starts.one, mz.starts.two, [mz.nest.exit]);
    for (const [x, y] of items) assert(DM.mazes.isFloor(mz, x, y), `item on wall at ${x},${y}`);
    for (let y = mz.nest.y0; y <= mz.nest.y1; y++) for (let x = mz.nest.x0; x <= mz.nest.x1; x++) eq(DM.mazes.cell(mz, x, y), 2, 'nest cell');
    // mirror symmetry (left/right)
    for (let y = 0; y < mz.H; y++) for (let x = 0; x < mz.W; x++) eq(DM.mazes.cell(mz, x, y), DM.mazes.cell(mz, mod(mz.W - x, mz.W), y), `symmetry ${x},${y}`);
  });
  test(`maze "${id}" wall outlines trace into closed loops`, () => {
    const mz = DM.mazes.get(id);
    const loops = DM.render.traceWalls((x, y) => DM.mazes.cell(mz, x, y) !== 0, -2, -2, mz.W + 2, mz.H + 2);
    assert(loops.length > 5, 'some loops');
    for (const lp of loops) {
      assert(lp.length >= 4 && lp.length % 2 === 0, 'rectilinear loop');
      for (let i = 0; i < lp.length; i++) {
        const a = lp[i];
        const b = lp[(i + 1) % lp.length];
        assert(a[0] === b[0] || a[1] === b[1], 'axis-aligned edge');
      }
    }
  });
}

console.log('Simulation');
test('new game starts in the intro with the right cast', () => {
  const s = G.newGame({ players: 1, seed: 5 });
  eq(s.phase, 'intro');
  eq(s.scene, 'dots');
  eq(s.mazeId, 'amethyst');
  eq(s.enemies.length, 3);
  assert(s.dotsLeft > 100, 'dots placed');
  eq(s.pl[0].st, 'bubble');
  eq(s.pl[0].lives, C.START_LIVES);
});

test('same seed + same input = identical game (determinism)', () => {
  const a = run(G.newGame({ players: 2, seed: 77 }), 3000, scriptInput(9));
  const b = run(G.newGame({ players: 2, seed: 77 }), 3000, scriptInput(9));
  eq(snap(a), snap(b));
});

test('save mid-game, restore, continue = same as never stopping', () => {
  const inp = scriptInput(3);
  const a = run(G.newGame({ players: 1, seed: 1234 }), 1500, inp);
  const restored = G.restore(JSON.parse(JSON.stringify(G.serialize(a))));
  const inp2 = scriptInput(3);
  const b = run(G.newGame({ players: 1, seed: 1234 }), 1500, inp2);
  eq(simSnap(restored), simSnap(b), 'restored equals original');
  run(restored, 1500, inp);
  run(b, 1500, inp2);
  eq(simSnap(restored), simSnap(b), 'continued identically');
});

test('restore rejects junk and repairs damaged saves without crashing', () => {
  const good = G.serialize(run(G.newGame({ players: 2, seed: 99 }), 900, scriptInput(4)));
  for (const bad of [null, 5, 'x', [], {}, { v: 2 }, Object.assign({}, good, { v: 99 }), Object.assign({}, good, { scene: 'nope' })]) {
    let threw = false;
    try {
      G.restore(bad);
    } catch (e) {
      threw = !!(e && typeof e.message === 'string');
    }
    assert(threw, 'should reject ' + JSON.stringify(bad && bad.v));
  }
  // fuzz: mutate random fields, restore must either throw cleanly or produce a playable state
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  const junk = [null, -1, 1e9, 'str', true, [], {}, 3.7, -0.5, NaN];
  const paths = [];
  (function walk(o, p) {
    if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], p.concat(k));
    else paths.push(p);
  })(good, []);
  for (let n = 0; n < 400; n++) {
    const copy = JSON.parse(JSON.stringify(good));
    for (let m = 0; m < 4; m++) {
      const p = paths[Math.floor(rnd() * paths.length)];
      let o = copy;
      for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
      o[p[p.length - 1]] = junk[Math.floor(rnd() * junk.length)];
    }
    let s = null;
    try {
      s = G.restore(copy);
    } catch (e) {
      assert(typeof e.message === 'string', 'clean error');
      continue;
    }
    run(s, 240, scriptInput(n));
  }
});

test('dots can only be eaten while holding a cross', () => {
  const s = G.newGame({ players: 1, seed: 1 });
  s.phase = 'play';
  const p = s.pl[0];
  p.st = 'walk';
  p.x = G.centerOf(10);
  p.y = G.centerOf(12);
  const mz = G.maze(s);
  const k = 12 * mz.W + 11;
  eq(s.dots[k], 1, 'dot east of start');
  const before = s.dotsLeft;
  run(s, 20, () => [{ dir: 1, fire: false }]);
  eq(s.dots[k], 1, 'not eaten without power');
  eq(s.dotsLeft, before);
  p.x = G.centerOf(10);
  p.y = G.centerOf(12);
  p.dir = -1;
  p.power = 300;
  run(s, 20, () => [{ dir: 1, fire: false }]);
  eq(s.dots[k], 0, 'eaten with power');
  assert(p.score >= C.SCORE.dot, 'scored');
});

test('walking onto a cross marker gives fire power; it refills later', () => {
  const s = G.newGame({ players: 1, seed: 1 });
  s.phase = 'play';
  const p = s.pl[0];
  p.st = 'walk';
  p.x = G.centerOf(5);
  p.y = G.centerOf(12);
  run(s, 30, () => [{ dir: 3, fire: false }]);
  assert(p.power > 0, 'has power');
  const c = s.crosses.find((q) => q.x === 4 && q.y === 12);
  assert(c.cd > 0, 'marker used');
});

test('fire burns a slime into a toasted puff, freezes a gargling', () => {
  for (const kind of ['gloom', 'garg']) {
    const s = G.newGame({ players: 1, seed: 2, round: kind === 'garg' ? 2 : 1 });
    s.phase = 'play';
    const mz = G.maze(s);
    // find four floor cells in a row
    let row = null;
    for (let y = 0; y < mz.H && !row; y++) {
      for (let x = 0; x < mz.W - 4 && !row; x++) {
        if ([0, 1, 2, 3].every((k) => DM.mazes.isFloor(mz, x + k, y))) row = [x, y];
      }
    }
    s.view.x = mod(G.centerOf(row[0]) - 4 * 256, C.MW);
    s.view.y = mod(G.centerOf(row[1]) - 5 * 256, C.MH);
    const p = s.pl[0];
    p.st = 'walk';
    p.power = 500;
    p.x = G.centerOf(row[0]);
    p.y = G.centerOf(row[1]);
    p.face = 1;
    const e = s.enemies.find((q) => q.kind === kind);
    e.st = 'walk';
    e.x = e.px = G.centerOf(row[0] + 3);
    e.y = e.py = G.centerOf(row[1]);
    e.dir = -1;
    s.devil.timer = 9999;
    const ev = [];
    for (let t = 0; t < 40 && e.st === 'walk'; t++) G.tick(s, [{ dir: -1, fire: true }], ev);
    if (kind === 'gloom') {
      eq(e.st === 'spirit' || e.st === 'nest', true, 'burnt');
      eq(s.toasts.length, 1, 'puff left behind');
    } else eq(e.st, 'frozen', 'frozen');
  }
});

test('the moving frame pushes you along open corridors but crushes you against walls', () => {
  // Devil points left: the maze slides left, the left edge sweeps right over it.
  const mk = (cx, cy) => {
    const s = G.newGame({ players: 1, seed: 3 });
    s.phase = 'play';
    s.enemies = [];
    s.devil = { mode: 'scroll', dir: 3, nextDir: 3, lastDir: 3, timer: 100000, laughT: 0 };
    s.scroll = { dir: 3, wantDir: 3, speed: 4, target: 4, acc: 0 };
    const p = s.pl[0];
    p.st = 'walk';
    p.x = p.px = G.centerOf(cx);
    p.y = p.py = G.centerOf(cy);
    // put that cell just inside the left edge of the window
    s.view.x = mod(G.centerOf(cx) - 128 - 10, C.MW);
    s.view.y = mod(G.centerOf(cy) - 5 * 256, C.MH);
    return s;
  };
  const mz = G.maze(G.newGame({ players: 1, seed: 3 }));
  // a cell in a vertical corridor (walls left and right) gets crushed...
  let vert = null;
  let horiz = null;
  for (let y = 0; y < mz.H && (!vert || !horiz); y++) {
    for (let x = 0; x < mz.W; x++) {
      if (!DM.mazes.isFloor(mz, x, y)) continue;
      const l = DM.mazes.isFloor(mz, x - 1, y);
      const r = DM.mazes.isFloor(mz, x + 1, y);
      const u = DM.mazes.isFloor(mz, x, y - 1);
      const d = DM.mazes.isFloor(mz, x, y + 1);
      if (!vert && !l && !r && u && d) vert = [x, y];
      if (!horiz && l && r && r && !u && !d && DM.mazes.isFloor(mz, x + 2, y) && DM.mazes.isFloor(mz, x + 3, y)) horiz = [x, y];
    }
  }
  assert(vert && horiz, 'found test cells');
  const a = mk(vert[0], vert[1]);
  const ev = [];
  let crushed = false;
  for (let t = 0; t < 200 && !crushed; t++) {
    ev.length = 0;
    G.tick(a, [], ev);
    crushed = ev.some((e) => e.t === 'die' && e.kind === 'crush');
  }
  assert(crushed, 'crushed in a vertical corridor');
  const b = mk(horiz[0], horiz[1]);
  for (let t = 0; t < 120; t++) {
    ev.length = 0;
    G.tick(b, [], ev);
    assert(!ev.some((e) => e.t === 'die'), 'not crushed in a horizontal corridor');
  }
  assert(G.relX(b, b.pl[0].x) >= 128, 'kept inside the window');
});

test('scenes flow: dots -> Bibles -> bonus -> next round, scoring Bibles and seals', () => {
  const s = G.newGame({ players: 1, seed: 8 });
  const ev = [];
  const step = (n) => run(s, n);
  step(140);
  eq(s.phase, 'play');
  s.dots = s.dots.map(() => 0);
  s.dotsLeft = 0;
  step(1);
  eq(s.phase, 'clear');
  step(200);
  eq(s.scene, 'bibles');
  eq(s.bibles.length, 4);
  eq(s.seals.length, 4);
  step(140);
  const p = s.pl[0];
  p.st = 'walk';
  const score0 = p.score;
  for (let b = 0; b < 4; b++) {
    const B = s.bibles[b];
    p.x = G.centerOf(B.x);
    p.y = G.centerOf(B.y);
    s.view.x = mod(p.x - 8 * 256, C.MW);
    s.view.y = mod(p.y - 5 * 256, C.MH);
    G.tick(s, [], ev);
    eq(p.bible, b, 'carrying');
    const q = s.seals[b];
    p.x = G.centerOf(q.x);
    p.y = G.centerOf(q.y);
    s.view.x = mod(p.x - 8 * 256, C.MW);
    s.view.y = mod(p.y - 5 * 256, C.MH);
    s.enemies.forEach((e) => (e.st = 'nest'));
    G.tick(s, [], ev);
    assert(q.sealed, 'sealed');
  }
  eq(p.score - score0, 4 * (C.SCORE.bibleTake + C.SCORE.bibleSeal));
  eq(s.phase, 'clear');
  step(200);
  eq(s.scene, 'bonus');
  eq(s.mazeId, 'vault');
  eq(s.chests.filter((c) => c.egg).length, 1, 'one egg');
  step(140 + C.BONUS_TICKS + 5);
  step(200);
  eq(s.round, 2);
  eq(s.scene, 'dots');
  eq(s.mazeId, 'ember');
});

test('bonus: the egg chest gives a life, being crushed costs none', () => {
  const s = G.newGame({ players: 1, seed: 8, scene: 'bonus' });
  run(s, 140);
  const p = s.pl[0];
  p.st = 'walk';
  const egg = s.chests.find((c) => c.egg);
  p.x = G.centerOf(egg.x);
  p.y = G.centerOf(egg.y);
  s.view.x = mod(p.x - 8 * 256, C.MW);
  s.view.y = mod(p.y - 5 * 256, C.MH);
  const lives = p.lives;
  run(s, 1);
  eq(p.lives, lives + 1, 'extra life');
  G._internal.killPlayer(s, 0, 'crush', []);
  run(s, C.DEATH_TICKS + 2);
  eq(p.lives, lives + 1, 'no life lost');
  eq(p.st, 'bench');
});

test('losing every life ends the game', () => {
  const s = G.newGame({ players: 1, seed: 8 });
  run(s, 140);
  const p = s.pl[0];
  for (let k = 0; k < C.START_LIVES; k++) {
    p.st = 'walk';
    p.inv = 0;
    G._internal.killPlayer(s, 0, 'enemy', []);
    run(s, C.DEATH_TICKS + 1);
  }
  eq(p.lives, 0);
  eq(p.st, 'out');
  eq(s.phase, 'gameover');
});

console.log('Save files');
test('save records round-trip through export text and slots', () => {
  const s = run(G.newGame({ players: 2, seed: 31 }), 1200, scriptInput(1));
  const rec = DM.Save.makeRecord(s, null);
  const text = JSON.stringify(rec, null, 1);
  const back = DM.Save.parseRecord(text);
  eq(simSnap(back.state), simSnap(s));
  DM.Save.write(2, s, null);
  const list = DM.Save.list();
  eq(list[1].record.summary.round, s.round);
  eq(simSnap(DM.Save.load(2)), simSnap(s));
  DM.Save.remove(2);
  eq(DM.Save.list()[1].record, null);
});

test('import rejects other files, edited saves and other versions', () => {
  const rec = DM.Save.makeRecord(G.newGame({ players: 1, seed: 2 }), null);
  const bad = [
    'not json',
    '{"hello":1}',
    JSON.stringify(Object.assign({}, rec, { version: 99 })),
    JSON.stringify(Object.assign({}, rec, { checksum: '00000000' })),
  ];
  const edited = JSON.parse(JSON.stringify(rec));
  edited.state.pl[0].lives = 9;
  bad.push(JSON.stringify(edited));
  for (const t of bad) {
    let threw = false;
    try {
      DM.Save.parseRecord(t);
    } catch (e) {
      threw = true;
    }
    assert(threw, 'rejected: ' + t.slice(0, 30));
  }
});

console.log('Timing');
test('fixed timestep: same game speed at 30/60/75/144/165/240 Hz, with jitter', () => {
  const results = [];
  for (const hz of [30, 60, 75, 144, 165, 240]) {
    for (const jitter of [0, 0.35]) {
      let seed = 42;
      const rnd = () => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return seed / 4294967296;
      };
      const s = G.newGame({ players: 1, seed: 600 });
      const inp = scriptInput(7);
      const ev = [];
      let renders = 0;
      const loop = DM.createLoop({
        hz: 60,
        tick: () => {
          ev.length = 0;
          G.tick(s, inp(s.tick, 1), ev);
        },
        render: () => renders++,
      });
      let now = 1000;
      while (now < 1000 + 20000) {
        loop.frame(now, true);
        now += (1000 / hz) * (1 + (rnd() - 0.5) * jitter);
      }
      loop.frame(1000 + 20000, true);
      results.push({ hz, jitter, ticks: loop.ticks, snap: simSnap(s), renders });
    }
  }
  for (const r of results) {
    assert(Math.abs(r.ticks - 1200) <= 1, `${r.hz} Hz ran ${r.ticks} ticks in 20 s`);
  }
  const ref = results.find((r) => r.ticks === 1200);
  for (const r of results) if (r.ticks === ref.ticks) eq(r.snap, ref.snap, `${r.hz} Hz state differs`);
});

test('fixed timestep: pausing does not owe time, stalls do not fast-forward', () => {
  let ticks = 0;
  const loop = DM.createLoop({ hz: 60, tick: () => ticks++, render: () => {} });
  let now = 0;
  for (let i = 0; i < 60; i++) loop.frame((now += 1000 / 60), true);
  const a = ticks;
  for (let i = 0; i < 600; i++) loop.frame((now += 1000 / 60), false); // paused for 10 s
  eq(ticks, a, 'no ticks while paused');
  loop.frame((now += 1000 / 60), true);
  assert(ticks - a <= 1, 'no catch-up after pause');
  loop.frame((now += 5000), true); // 5 s stall
  assert(ticks - a <= 1 + 16, 'stall capped');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
