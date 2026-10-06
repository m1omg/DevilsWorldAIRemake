/*
 * Devil's Maze — game rules and simulation.
 *
 * The whole game lives in one plain-data state object, so it can be saved to a
 * browser slot or exported as JSON at any moment. tick() advances it by exactly
 * one 1/60 s step; the main loop calls it a fixed number of times per real
 * second, whatever the display refresh rate.
 *
 * Gameplay follows Devil World (Nintendo, 1984): clear the dots while holding a
 * cross, seal four gates with Bibles, then grab treasure in a bonus maze. The
 * Devil points, his imps crank the maze, and the frame crushes anyone caught
 * between it and a wall.
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});
  const U = DM.util;
  const { mod, wrapDelta, rand, randInt, clamp, DX, DY } = U;
  const C = DM.C;
  const M = DM.mazes;

  const CELL = C.CELL;
  const HALF = CELL / 2;
  const MW = C.MW;
  const MH = C.MH;
  const VWU = C.VWU;
  const VHU = C.VHU;
  const SPLIT_X = (VWU + MW) / 2;
  const SPLIT_Y = (VHU + MH) / 2;
  const SCENES = ['dots', 'bibles', 'bonus'];
  const PHASES = ['intro', 'play', 'clear', 'gameover'];
  const PLAYER_STATES = ['bubble', 'walk', 'dead', 'bench', 'out'];
  const ENEMY_STATES = ['nest', 'hatch', 'walk', 'frozen', 'spirit'];
  const DEVIL_MODES = ['rest', 'warn', 'scroll', 'sleep'];
  const NO_INPUT = { dir: -1, fire: false };

  const diffCache = {};
  function diffOf(s) {
    return diffCache[s.round] || (diffCache[s.round] = DM.difficulty(s.round));
  }
  function maze(s) {
    return M.get(s.mazeId);
  }

  // ---- geometry -----------------------------------------------------------

  // Position of a maze coordinate relative to the window's top-left corner.
  // Things just outside the left/top edge come back as small negative numbers.
  function relX(s, x) {
    let d = mod(x - s.view.x, MW);
    if (d >= SPLIT_X) d -= MW;
    return d;
  }
  function relY(s, y) {
    let d = mod(y - s.view.y, MH);
    if (d >= SPLIT_Y) d -= MH;
    return d;
  }
  const cellOf = (u) => Math.floor(u / CELL);
  const centerOf = (c) => c * CELL + HALF;

  function cellInView(s, cx, cy) {
    const rx = relX(s, centerOf(mod(cx, C.MAZE_W)));
    const ry = relY(s, centerOf(mod(cy, C.MAZE_H)));
    return rx >= HALF && rx <= VWU - HALF && ry >= HALF && ry <= VHU - HALF;
  }

  // Free distance between a sprite and the window edge in direction d.
  function roomInDir(s, e, d) {
    let r;
    if (d === 0) r = relY(s, e.y) - HALF;
    else if (d === 2) r = VHU - HALF - relY(s, e.y);
    else if (d === 3) r = relX(s, e.x) - HALF;
    else r = VWU - HALF - relX(s, e.x);
    return r > 0 ? r : 0;
  }

  function near(a, b, range) {
    return Math.abs(wrapDelta(a.x, b.x, MW)) < range && Math.abs(wrapDelta(a.y, b.y, MH)) < range;
  }

  // ---- grid movement ------------------------------------------------------

  // Move entity e up to n units along e.dir. Whenever it sits exactly on a
  // cell centre, atCenter(s, e) may turn it and must return whether it can go
  // on. Sprites never walk past the window frame.
  function stepEntity(s, e, n, atCenter) {
    let moved = 0;
    for (let guard = 0; n > 0 && guard < 6; guard++) {
      let d = e.dir;
      let toCenter;
      if (d < 0) {
        // Standing still: only a sprite resting on a cell centre may pick a direction.
        if (mod(e.x - HALF, CELL) !== 0 || mod(e.y - HALF, CELL) !== 0) break;
        toCenter = 0;
      } else {
        const off = mod(((d & 1) === 1 ? e.x : e.y) - HALF, CELL);
        toCenter = d === 1 || d === 2 ? (off === 0 ? 0 : CELL - off) : off;
      }
      if (toCenter === 0) {
        if (!atCenter(s, e)) break;
        d = e.dir;
        if (d < 0) break;
        toCenter = CELL;
      }
      const horiz = (d & 1) === 1;
      const sgn = d === 1 || d === 2 ? 1 : -1;
      const step = Math.min(n, toCenter, roomInDir(s, e, d));
      if (step <= 0) break;
      if (horiz) e.x = mod(e.x + sgn * step, MW);
      else e.y = mod(e.y + sgn * step, MH);
      n -= step;
      moved += step;
    }
    return moved;
  }

  // The moving window frame pushes a sprite along `horiz` by `amount` units
  // (signed). Returns how far it could actually be pushed before a wall.
  function pushAxis(s, e, horiz, amount) {
    const mz = maze(s);
    const sgn = amount > 0 ? 1 : -1;
    let n = Math.abs(amount);
    const perp = horiz ? e.y : e.x;
    const poff = mod(perp - HALF, CELL);
    const dev = poff <= HALF ? poff : poff - CELL;
    if (Math.abs(dev) > C.PUSH_SNAP) return 0;
    const snapped = mod(perp - dev, horiz ? MH : MW);
    const pc = cellOf(snapped);
    const size = horiz ? MW : MH;
    let pos = horiz ? e.x : e.y;
    let moved = 0;
    for (let guard = 0; n > 0 && guard < 6; guard++) {
      const off = mod(pos - HALF, CELL);
      let toC = sgn > 0 ? (off === 0 ? 0 : CELL - off) : off;
      if (toC === 0) {
        const c = cellOf(pos);
        const nx = horiz ? c + sgn : pc;
        const ny = horiz ? pc : c + sgn;
        if (M.cell(mz, nx, ny) !== 0) break;
        toC = CELL;
      }
      const step = Math.min(n, toC);
      pos = mod(pos + sgn * step, size);
      n -= step;
      moved += step;
    }
    if (moved > 0) {
      if (horiz) {
        e.x = pos;
        e.y = snapped;
      } else {
        e.y = pos;
        e.x = snapped;
      }
    }
    return moved;
  }

  // Keep a sprite inside the window. Returns how far the frame still overlaps
  // it after pushing; above CRUSH_TOL the sprite is crushed against a wall.
  function enforceView(s, e, isPlayer) {
    let residual = 0;
    const rx = relX(s, e.x);
    let need = 0;
    if (rx < HALF) need = HALF - rx;
    else if (rx > VWU - HALF) need = VWU - HALF - rx;
    if (need !== 0) {
      const got = pushAxis(s, e, true, need);
      if (got > 0 && e.dir >= 0 && (e.dir & 1) === 0) e.dir = isPlayer ? -1 : need > 0 ? 1 : 3;
      residual = Math.max(residual, Math.abs(need) - got);
    }
    const ry = relY(s, e.y);
    need = 0;
    if (ry < HALF) need = HALF - ry;
    else if (ry > VHU - HALF) need = VHU - HALF - ry;
    if (need !== 0) {
      const got = pushAxis(s, e, false, need);
      if (got > 0 && e.dir >= 0 && (e.dir & 1) === 1) e.dir = isPlayer ? -1 : need > 0 ? 2 : 0;
      residual = Math.max(residual, Math.abs(need) - got);
    }
    return residual;
  }

  // ---- players --------------------------------------------------------------

  function newPlayer(i) {
    return {
      i,
      st: 'bubble',
      lives: C.START_LIVES,
      score: 0,
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      dir: -1,
      face: 2,
      want: -1,
      wantT: 0,
      power: 0,
      bible: -1,
      fireCd: 0,
      fireAnim: 0,
      inv: 0,
      deadT: 0,
      deadKind: '',
      bx: 0,
      by: 0,
      bt: 0,
      squeeze: 0,
      walkT: 0,
      moving: false,
    };
  }

  function playerAtCenter(s, p) {
    const mz = maze(s);
    const cx = cellOf(p.x);
    const cy = cellOf(p.y);
    const w = p.want;
    if (w >= 0 && w !== p.dir && M.cell(mz, cx + DX[w], cy + DY[w]) === 0 && roomInDir(s, p, w) > 0) {
      p.dir = w;
      p.face = w;
    }
    if (p.dir < 0) return false;
    return M.cell(mz, cx + DX[p.dir], cy + DY[p.dir]) === 0;
  }

  // Classic maze-game steering: reverse at once, turn at the next junction.
  function steerPlayer(s, p) {
    const w = p.want;
    if (w < 0) return;
    if (p.dir >= 0) {
      if (w === (p.dir ^ 2)) {
        p.dir = w;
        p.face = w;
      }
      return;
    }
    const offX = mod(p.x - HALF, CELL);
    const offY = mod(p.y - HALF, CELL);
    const horizW = (w & 1) === 1;
    if (offX === 0 && offY === 0) {
      p.dir = w;
      p.face = w;
    } else if (offX !== 0) {
      if (horizW) {
        p.dir = w;
        p.face = w;
      } else p.dir = offX < HALF ? 3 : 1; // slide to the junction, then turn
    } else if (!horizW) {
      p.dir = w;
      p.face = w;
    } else p.dir = offY < HALF ? 0 : 2;
  }

  function bubblePos(s, i) {
    if (s.players === 1) return [8 * CELL, 7.5 * CELL];
    return [i === 0 ? 5 * CELL : 11 * CELL, 7.5 * CELL];
  }

  function toBubble(s, i, bx, by) {
    const p = s.pl[i];
    p.st = 'bubble';
    p.bx = bx;
    p.by = by;
    p.bt = 0;
    p.dir = -1;
    p.want = -1;
    p.wantT = 0;
    p.power = 0;
    p.bible = -1;
    p.squeeze = 0;
    p.inv = 0;
  }

  function popBubble(s, i, ev) {
    const p = s.pl[i];
    const mz = maze(s);
    const mx = mod(s.view.x + p.bx, MW);
    const my = mod(s.view.y + p.by, MH);
    let best = null;
    let bd = Infinity;
    for (let cy = 0; cy < mz.H; cy++) {
      for (let cx = 0; cx < mz.W; cx++) {
        if (mz.grid[cy * mz.W + cx] !== 0 || !cellInView(s, cx, cy)) continue;
        const dx = wrapDelta(mx, centerOf(cx), MW);
        const dy = wrapDelta(my, centerOf(cy), MH);
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = [cx, cy];
        }
      }
    }
    if (!best) return;
    p.x = p.px = centerOf(best[0]);
    p.y = p.py = centerOf(best[1]);
    p.st = 'walk';
    p.dir = -1;
    p.inv = 60;
    p.walkT = 0;
    ev.push({ t: 'pop', p: i, x: p.x, y: p.y });
  }

  function killPlayer(s, i, kind, ev) {
    const p = s.pl[i];
    if (p.bible >= 0) {
      const b = s.bibles[p.bible];
      b.st = 0;
      b.by = -1;
      b.x = cellOf(p.x);
      b.y = cellOf(p.y);
      p.bible = -1;
    }
    p.st = 'dead';
    p.deadT = C.DEATH_TICKS;
    p.deadKind = kind;
    p.power = 0;
    p.squeeze = 0;
    s.fires = s.fires.filter((f) => f.o !== i);
    if (s.scene !== 'bonus') s.devil.laughT = 110;
    ev.push({ t: 'die', p: i, kind, x: p.x, y: p.y });
  }

  function finishDeath(s, i, ev) {
    const p = s.pl[i];
    if (s.scene === 'bonus') {
      p.st = 'bench';
      return;
    }
    p.lives--;
    if (p.lives <= 0) {
      p.lives = 0;
      p.st = 'out';
      ev.push({ t: 'out', p: i });
      return;
    }
    const [bx, by] = bubblePos(s, i);
    toBubble(s, i, bx, by);
    ev.push({ t: 'respawn', p: i });
  }

  function addScore(s, i, pts, ev, x, y) {
    const p = s.pl[i];
    p.score += pts;
    if (p.score > s.top) s.top = p.score;
    if (x !== undefined) ev.push({ t: 'points', p: i, pts, x, y });
  }

  function hasFire(p) {
    return p.power > 0 || p.bible >= 0;
  }

  function tryFire(s, i, ev) {
    const p = s.pl[i];
    if (p.fireCd > 0) return;
    if (!hasFire(p)) {
      p.fireCd = 20;
      ev.push({ t: 'fizzle', p: i, x: p.x, y: p.y, d: p.face });
      return;
    }
    for (const f of s.fires) if (f.o === i) return;
    const d = p.face >= 0 ? p.face : 2;
    s.fires.push({ o: i, x: p.x, y: p.y, px: p.x, py: p.y, d, dist: 0 });
    p.fireCd = C.FIRE_COOLDOWN;
    p.fireAnim = 14;
    ev.push({ t: 'fire', p: i, x: p.x, y: p.y, d });
  }

  function pickups(s, i, df, ev) {
    const p = s.pl[i];
    const mz = maze(s);
    const cx = cellOf(p.x);
    const cy = cellOf(p.y);
    const X = centerOf(cx);
    const Y = centerOf(cy);
    if (s.scene === 'dots') {
      const k = cy * mz.W + cx;
      if (p.power > 0 && s.dots[k]) {
        s.dots[k] = 0;
        s.dotsLeft--;
        addScore(s, i, C.SCORE.dot, ev);
        ev.push({ t: 'dot', p: i, x: X, y: Y });
      }
      for (const c of s.crosses) {
        if (c.cd === 0 && c.x === cx && c.y === cy) {
          c.cd = C.CROSS_RESPAWN;
          p.power = df.crossTicks;
          ev.push({ t: 'cross', p: i, x: X, y: Y });
        }
      }
      for (const t of s.treats) {
        if (t.t > 0 && t.x === cx && t.y === cy) {
          t.t = 0;
          addScore(s, i, C.SCORE.treat, ev, X, Y);
          ev.push({ t: 'treat', p: i, x: X, y: Y });
        }
      }
    } else if (s.scene === 'bibles') {
      if (p.bible < 0) {
        for (let b = 0; b < s.bibles.length; b++) {
          const B = s.bibles[b];
          if (B.st === 0 && B.x === cx && B.y === cy) {
            B.st = 1;
            B.by = i;
            p.bible = b;
            addScore(s, i, C.SCORE.bibleTake, ev, X, Y);
            ev.push({ t: 'bible', p: i, x: X, y: Y });
            break;
          }
        }
      }
      if (p.bible >= 0) {
        for (const sl of s.seals) {
          if (!sl.sealed && sl.x === cx && sl.y === cy) {
            const B = s.bibles[p.bible];
            sl.sealed = true;
            B.st = 2;
            B.by = -1;
            B.x = sl.x;
            B.y = sl.y;
            p.bible = -1;
            addScore(s, i, C.SCORE.bibleSeal, ev, X, Y);
            ev.push({ t: 'seal', p: i, x: X, y: Y, left: s.seals.filter((q) => !q.sealed).length });
            break;
          }
        }
      }
    } else if (s.scene === 'bonus') {
      for (const c of s.chests) {
        if (!c.open && c.x === cx && c.y === cy) {
          c.open = true;
          if (c.egg) {
            p.lives = Math.min(9, p.lives + 1);
            ev.push({ t: 'egg', p: i, x: X, y: Y });
          } else {
            addScore(s, i, c.value, ev, X, Y);
            ev.push({ t: 'chest', p: i, x: X, y: Y, value: c.value });
          }
        }
      }
      for (const a of s.arrows) {
        if (a.x === cx && a.y === cy && s.scroll.wantDir !== a.d) {
          s.scroll.wantDir = a.d;
          s.scroll.target = C.BONUS_SCROLL;
          ev.push({ t: 'arrow', p: i, d: a.d, x: X, y: Y });
        }
      }
    }
    for (let k = s.toasts.length - 1; k >= 0; k--) {
      const t = s.toasts[k];
      if (cellOf(t.x) === cx && cellOf(t.y) === cy) {
        s.toasts.splice(k, 1);
        addScore(s, i, C.SCORE.toast, ev, t.x, t.y);
        ev.push({ t: 'toast', p: i, x: t.x, y: t.y });
      }
    }
  }

  function updatePlayer(s, i, inp, df, ev) {
    const p = s.pl[i];
    if (p.st === 'out' || p.st === 'bench') return;
    if (inp.dir >= 0) {
      p.want = inp.dir;
      p.wantT = C.INPUT_GRACE;
    } else if (p.wantT > 0) p.wantT--;
    else p.want = -1;
    if (p.fireCd > 0) p.fireCd--;
    if (p.fireAnim > 0) p.fireAnim--;
    if (p.inv > 0) p.inv--;

    if (p.st === 'dead') {
      if (--p.deadT <= 0) finishDeath(s, i, ev);
      return;
    }
    if (p.st === 'bubble') {
      p.bt++;
      if (p.bt > 30 && (inp.dir >= 0 || inp.fire)) popBubble(s, i, ev);
      return;
    }
    if (p.power > 0) {
      p.power--;
      if (p.power === 0) ev.push({ t: 'powerOff', p: i });
    }
    steerPlayer(s, p);
    const moved = stepEntity(s, p, C.PLAYER_SPEED, playerAtCenter);
    p.moving = moved > 0;
    p.walkT += moved;
    p.squeeze = enforceView(s, p, true);
    if (p.squeeze > C.CRUSH_TOL) {
      killPlayer(s, i, 'crush', ev);
      return;
    }
    if (inp.fire) tryFire(s, i, ev);
    pickups(s, i, df, ev);
  }

  // ---- enemies --------------------------------------------------------------

  function newEnemy(id, kind) {
    return { id, kind, st: 'nest', x: centerOf(10), y: centerOf(8), px: 0, py: 0, dir: -1, acc: 0, t: 0, sx: 0, sy: 0, walkT: 0, squeeze: 0 };
  }

  function chaseTarget(s, e) {
    let best = null;
    let bd = Infinity;
    for (const p of s.pl) {
      if (p.st !== 'walk') continue;
      const d = Math.abs(wrapDelta(e.x, p.x, MW)) + Math.abs(wrapDelta(e.y, p.y, MH));
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  function enemyAtCenter(s, e) {
    const mz = maze(s);
    const cx = cellOf(e.x);
    const cy = cellOf(e.y);
    const back = e.dir >= 0 ? e.dir ^ 2 : -9;
    const opts = [];
    for (let d = 0; d < 4; d++) {
      if (d === back) continue;
      if (M.cell(mz, cx + DX[d], cy + DY[d]) === 0 && cellInView(s, cx + DX[d], cy + DY[d])) opts.push(d);
    }
    if (!opts.length) {
      if (back >= 0 && M.cell(mz, cx + DX[back], cy + DY[back]) === 0 && cellInView(s, cx + DX[back], cy + DY[back])) {
        e.dir = back;
        return true;
      }
      return false;
    }
    let pick = opts[0];
    if (opts.length > 1) {
      const target = chaseTarget(s, e);
      if (target && rand(s) < diffOf(s).chase[e.kind]) {
        let best = Infinity;
        for (const d of opts) {
          const dist =
            Math.abs(wrapDelta(centerOf(cx + DX[d]), target.x, MW)) + Math.abs(wrapDelta(centerOf(cy + DY[d]), target.y, MH));
          if (dist < best) {
            best = dist;
            pick = d;
          }
        }
      } else pick = opts[randInt(s, opts.length)];
    }
    e.dir = pick;
    return true;
  }

  function sendToNest(s, e) {
    e.st = 'spirit';
    e.t = 50;
    e.sx = e.x;
    e.sy = e.y;
    e.dir = -1;
    e.squeeze = 0;
  }

  function burn(s, e, ev) {
    const x = centerOf(cellOf(e.x));
    const y = centerOf(cellOf(e.y));
    if (s.toasts.length < 12) s.toasts.push({ x, y, t: C.TOAST_TICKS, kind: e.kind });
    ev.push({ t: 'burn', x: e.x, y: e.y, kind: e.kind });
    sendToNest(s, e);
  }

  function updateHatching(s, df, ev) {
    if (s.hatchT > 0) {
      s.hatchT--;
      return;
    }
    let e = null;
    for (const q of s.enemies) {
      if (q.st === 'nest') {
        e = q;
        break;
      }
    }
    if (!e) return;
    const mz = maze(s);
    const [ex, ey] = mz.nest.exit;
    if (!cellInView(s, ex, ey)) return;
    const X = centerOf(ex);
    const Y = centerOf(ey);
    for (const p of s.pl) {
      if (p.st === 'walk' && Math.abs(wrapDelta(p.x, X, MW)) + Math.abs(wrapDelta(p.y, Y, MH)) < C.SPAWN_SAFE_DIST) return;
    }
    e.st = 'hatch';
    e.t = 45;
    e.x = e.px = X;
    e.y = e.py = Y;
    e.dir = -1;
    e.acc = 0;
    s.hatchT = df.hatchInterval;
    ev.push({ t: 'hatch', x: X, y: Y, kind: e.kind });
  }

  function updateEnemy(s, e, df, ev) {
    if (e.st === 'nest') return;
    if (e.st === 'spirit') {
      if (--e.t <= 0) e.st = 'nest';
      return;
    }
    if (e.st === 'hatch') {
      if (--e.t <= 0) e.st = 'walk';
    } else if (e.st === 'frozen') {
      if (--e.t <= 0) {
        e.st = 'walk';
        e.dir = e.dir >= 0 ? e.dir ^ 2 : -1;
        ev.push({ t: 'thaw', x: e.x, y: e.y });
      }
    } else if (e.st === 'walk') {
      e.acc += df.enemySpeed[e.kind];
      const n = Math.floor(e.acc);
      e.acc -= n;
      const moved = stepEntity(s, e, n, enemyAtCenter);
      e.walkT += moved;
      if (moved === 0 && e.dir >= 0) {
        const offX = mod(e.x - HALF, CELL);
        const offY = mod(e.y - HALF, CELL);
        if (offX !== 0 || offY !== 0) e.dir ^= 2; // pinned against the frame mid-corridor: turn back
      }
    }
    e.squeeze = enforceView(s, e, false);
    if (e.squeeze > C.CRUSH_TOL) {
      ev.push({ t: 'enemyCrush', x: e.x, y: e.y, kind: e.kind });
      sendToNest(s, e);
    }
  }

  // ---- fire -----------------------------------------------------------------

  function hitEnemies(s, f, ev) {
    const df = diffOf(s);
    for (const e of s.enemies) {
      if (e.st !== 'walk' && e.st !== 'frozen' && e.st !== 'hatch') continue;
      if (!near(f, e, C.FIRE_HIT_RANGE)) continue;
      if (e.kind === 'garg') {
        e.st = 'frozen';
        e.t = df.freezeTicks;
        ev.push({ t: 'freeze', x: e.x, y: e.y });
      } else burn(s, e, ev);
      return true;
    }
    return false;
  }

  function updateFires(s, ev) {
    const mz = maze(s);
    for (let k = s.fires.length - 1; k >= 0; k--) {
      const f = s.fires[k];
      let n = C.FIRE_SPEED;
      let end = '';
      while (n > 0 && !end) {
        const step = Math.min(n, 64);
        f.x = mod(f.x + DX[f.d] * step, MW);
        f.y = mod(f.y + DY[f.d] * step, MH);
        f.dist += step;
        n -= step;
        if (hitEnemies(s, f, ev)) end = 'hit';
        else if (M.cell(mz, cellOf(mod(f.x + DX[f.d] * 72, MW)), cellOf(mod(f.y + DY[f.d] * 72, MH))) !== 0) end = 'wall';
        else {
          const rx = relX(s, f.x);
          const ry = relY(s, f.y);
          if (rx < 0 || rx > VWU || ry < 0 || ry > VHU) end = 'out';
          else if (f.dist >= C.FIRE_RANGE) end = 'range';
        }
      }
      if (end) {
        s.fires.splice(k, 1);
        if (end !== 'hit') ev.push({ t: 'fireEnd', x: f.x, y: f.y, d: f.d, why: end });
      }
    }
  }

  // ---- the Devil and the scrolling maze ------------------------------------

  function rangeRand(s, r) {
    return r[0] + randInt(s, r[1] - r[0] + 1);
  }

  function updateDevil(s, df, ev) {
    const d = s.devil;
    if (d.laughT > 0) d.laughT--;
    if (s.scene === 'bonus') return;
    if (--d.timer <= 0) {
      if (d.mode === 'rest') {
        let nd = randInt(s, 4);
        if (nd === d.lastDir) nd = (nd + 1 + randInt(s, 3)) % 4;
        d.nextDir = nd;
        d.mode = 'warn';
        d.timer = df.warnTicks;
        ev.push({ t: 'devilPoint', d: nd });
      } else if (d.mode === 'warn') {
        d.mode = 'scroll';
        d.dir = d.nextDir;
        d.lastDir = d.dir;
        d.timer = rangeRand(s, df.scrollTicks);
        s.scroll.wantDir = d.dir;
        ev.push({ t: 'crank', d: d.dir });
      } else {
        d.mode = 'rest';
        d.dir = -1;
        d.timer = rangeRand(s, df.restTicks);
      }
    }
    s.scroll.target = d.mode === 'scroll' ? df.scrollSpeed : 0;
  }

  function applyScroll(s) {
    const sc = s.scroll;
    const ramp = s.scene === 'bonus' ? 0.3 : 0.08;
    const target = sc.dir === sc.wantDir ? sc.target : 0; // stop before changing direction
    if (sc.speed < target) sc.speed = Math.min(target, sc.speed + ramp);
    else if (sc.speed > target) sc.speed = Math.max(target, sc.speed - ramp);
    if (sc.speed === 0) sc.dir = sc.wantDir;
    if (sc.dir < 0 || sc.speed === 0) return;
    sc.acc += sc.speed;
    const n = Math.floor(sc.acc);
    sc.acc -= n;
    if (n) {
      // The maze slides towards sc.dir, so the window moves the other way over it.
      s.view.x = mod(s.view.x - DX[sc.dir] * n, MW);
      s.view.y = mod(s.view.y - DY[sc.dir] * n, MH);
    }
  }

  // ---- items and scene flow --------------------------------------------------

  function updateItems(s, ev) {
    for (const c of s.crosses) {
      if (c.cd > 0 && --c.cd === 0) ev.push({ t: 'crossBack', x: centerOf(c.x), y: centerOf(c.y) });
    }
    for (const t of s.treats) if (t.t > 0) t.t--;
    for (let k = s.toasts.length - 1; k >= 0; k--) if (--s.toasts[k].t <= 0) s.toasts.splice(k, 1);
    if (s.scene === 'dots' && !s.treatsSpawned && s.dotsLeft <= s.dotsTotal / 2) {
      s.treatsSpawned = true;
      s.treats = maze(s).treats.map(([x, y]) => ({ x, y, t: C.TREAT_TICKS }));
      ev.push({ t: 'treats', at: s.treats.map((q) => [centerOf(q.x), centerOf(q.y)]) });
    }
    if (s.scene === 'bonus' && s.bonusT > 0) s.bonusT--;
  }

  function checkSceneEnd(s, ev) {
    if (s.pl.every((p) => p.st === 'out')) {
      s.phase = 'gameover';
      s.phaseT = 330;
      ev.push({ t: 'gameover' });
      return;
    }
    let clear = false;
    if (s.scene === 'dots') clear = s.dotsLeft <= 0;
    else if (s.scene === 'bibles') clear = s.seals.every((q) => q.sealed);
    else
      clear =
        s.bonusT <= 0 || s.chests.every((c) => c.open) || s.pl.every((p) => p.st === 'out' || p.st === 'bench');
    if (clear) {
      s.phase = 'clear';
      s.phaseT = s.scene === 'bonus' ? 170 : 150;
      s.fires = [];
      ev.push({ t: 'clear', scene: s.scene });
    }
  }

  function setupScene(s, scene, ev) {
    s.scene = scene;
    s.mazeId = scene === 'bonus' ? M.BONUS_ID : M.forRound(s.round);
    const mz = maze(s);
    const df = diffOf(s);
    s.sceneT = 0;
    s.phase = 'intro';
    s.phaseT = 130;
    const vx = mod(centerOf(mz.nest.cx) - VWU / 2, MW);
    const vy = mod(centerOf(mz.nest.cy) - VHU / 2, MH);
    s.view = { x: vx, y: vy, px: vx, py: vy };
    s.scroll = { dir: -1, wantDir: -1, speed: 0, target: 0, acc: 0 };
    s.devil = { mode: scene === 'bonus' ? 'sleep' : 'rest', dir: -1, nextDir: -1, lastDir: -1, timer: 100, laughT: 0 };

    const starts = s.players === 1 ? mz.starts.one : mz.starts.two;
    s.dots = [];
    s.dotsLeft = 0;
    if (scene === 'dots') {
      const skip = new Set(mz.crosses.concat(starts).map(([x, y]) => y * mz.W + x));
      for (let k = 0; k < mz.W * mz.H; k++) {
        const on = mz.grid[k] === 0 && !skip.has(k) ? 1 : 0;
        s.dots.push(on);
        s.dotsLeft += on;
      }
    }
    s.dotsTotal = s.dotsLeft;
    s.crosses = scene === 'dots' ? mz.crosses.map(([x, y]) => ({ x, y, cd: 0 })) : [];
    s.treats = [];
    s.treatsSpawned = false;
    s.bibles = scene === 'bibles' ? mz.bibles.map(([x, y]) => ({ x, y, hx: x, hy: y, st: 0, by: -1 })) : [];
    s.seals = scene === 'bibles' ? mz.seals.map(([x, y]) => ({ x, y, sealed: false })) : [];
    s.arrows = scene === 'bonus' ? mz.arrows.map(([x, y, d]) => ({ x, y, d })) : [];
    s.chests = [];
    if (scene === 'bonus') {
      const prizes = C.BONUS_VALUES.map((v) => ({ value: v, egg: false })).concat([{ value: 0, egg: true }]);
      for (let k = prizes.length - 1; k > 0; k--) {
        const j = randInt(s, k + 1);
        const tmp = prizes[k];
        prizes[k] = prizes[j];
        prizes[j] = tmp;
      }
      s.chests = mz.chests.map(([x, y], k) => ({ x, y, value: prizes[k].value, egg: prizes[k].egg, open: false }));
    }
    s.bonusT = scene === 'bonus' ? C.BONUS_TICKS : 0;
    s.toasts = [];
    s.fires = [];
    s.enemies = scene === 'bonus' ? [] : df.roster.map((kind, k) => newEnemy(k, kind));
    s.hatchT = df.firstHatch;

    for (let i = 0; i < s.pl.length; i++) {
      const p = s.pl[i];
      if (p.st === 'out') continue;
      const [sx, sy] = starts[Math.min(i, starts.length - 1)];
      toBubble(s, i, relX(s, centerOf(sx)), relY(s, centerOf(sy)));
      p.x = p.px = centerOf(sx);
      p.y = p.py = centerOf(sy);
      p.face = 2;
    }
    if (ev) ev.push({ t: 'scene', scene, round: s.round });
  }

  function nextScene(s, ev) {
    const prev = s.scene;
    for (const p of s.pl) {
      if (p.st === 'dead' && prev !== 'bonus') {
        p.lives = Math.max(0, p.lives - 1);
        if (p.lives === 0) p.st = 'out';
      }
    }
    if (prev === 'dots') setupScene(s, 'bibles', ev);
    else if (prev === 'bibles') setupScene(s, 'bonus', ev);
    else {
      s.round++;
      setupScene(s, 'dots', ev);
    }
    if (s.pl.every((p) => p.st === 'out')) {
      s.phase = 'gameover';
      s.phaseT = 330;
      ev.push({ t: 'gameover' });
    }
  }

  function playTick(s, inputs, ev) {
    const df = diffOf(s);
    s.sceneT++;
    updateDevil(s, df, ev);
    applyScroll(s);
    for (let i = 0; i < s.pl.length; i++) updatePlayer(s, i, inputs[i] || NO_INPUT, df, ev);
    if (s.scene !== 'bonus') {
      updateHatching(s, df, ev);
      for (const e of s.enemies) updateEnemy(s, e, df, ev);
    }
    updateFires(s, ev);
    for (let i = 0; i < s.pl.length; i++) {
      const p = s.pl[i];
      if (p.st !== 'walk' || p.inv > 0) continue;
      for (const e of s.enemies) {
        if (e.st === 'walk' && near(p, e, C.HIT_RANGE)) {
          killPlayer(s, i, 'enemy', ev);
          break;
        }
      }
    }
    updateItems(s, ev);
    checkSceneEnd(s, ev);
  }

  function savePrev(s) {
    s.view.px = s.view.x;
    s.view.py = s.view.y;
    for (const p of s.pl) {
      p.px = p.x;
      p.py = p.y;
    }
    for (const e of s.enemies) {
      e.px = e.x;
      e.py = e.y;
    }
    for (const f of s.fires) {
      f.px = f.x;
      f.py = f.y;
    }
  }

  // Advance the game by one fixed 1/60 s step. inputs: [{dir, fire}, ...].
  // Things that happened (for sound and particles) are appended to ev.
  function tick(s, inputs, ev) {
    s.tick++;
    savePrev(s);
    if (s.phase === 'intro') {
      if (--s.phaseT <= 0) {
        s.phase = 'play';
        ev.push({ t: 'go' });
      }
      for (const p of s.pl) if (p.st === 'bubble') p.bt++;
    } else if (s.phase === 'play') {
      playTick(s, inputs || [], ev);
    } else if (s.phase === 'clear') {
      if (--s.phaseT <= 0) nextScene(s, ev);
    } else if (s.phase === 'gameover') {
      if (s.phaseT > 0) s.phaseT--;
    }
  }

  function newGame(opts) {
    const o = opts || {};
    const players = o.players === 2 ? 2 : 1;
    const s = {
      v: C.VERSION,
      players,
      round: Math.max(1, o.round | 0 || 1),
      scene: 'dots',
      mazeId: '',
      tick: 0,
      sceneT: 0,
      phase: 'intro',
      phaseT: 0,
      rng: o.seed >>> 0 || 0x9e3779b9,
      top: o.top || 0,
      pl: [],
      view: null,
      scroll: null,
      devil: null,
      dots: [],
      dotsLeft: 0,
      dotsTotal: 0,
      crosses: [],
      treats: [],
      treatsSpawned: false,
      bibles: [],
      seals: [],
      arrows: [],
      chests: [],
      bonusT: 0,
      toasts: [],
      fires: [],
      enemies: [],
      hatchT: 0,
    };
    for (let i = 0; i < players; i++) s.pl.push(newPlayer(i));
    setupScene(s, o.scene && SCENES.includes(o.scene) ? o.scene : 'dots');
    return s;
  }

  // ---- saving -----------------------------------------------------------------

  function serialize(s) {
    return JSON.parse(JSON.stringify(s));
  }

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const num = (v, lo, hi, def) => (isNum(v) ? clamp(v, lo, hi) : def);
  const int = (v, lo, hi, def) => (isNum(v) && Math.floor(v) === v ? clamp(v, lo, hi) : def);
  const oneOf = (v, list, def) => (list.indexOf(v) >= 0 ? v : def);
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

  // Rebuild a state from untrusted data (a browser slot or an imported file).
  // Structure always comes from this code; only checked values are copied, so
  // a damaged or hand-edited file cannot break the game.
  function restore(raw) {
    const o = obj(raw);
    if (o.v !== C.VERSION) throw new Error('This save was made by an unsupported version of the game.');
    const players = oneOf(o.players, [1, 2], 0);
    const scene = oneOf(o.scene, SCENES, '');
    if (!players || !scene) throw new Error('The save data is not valid.');
    const round = int(o.round, 1, 9999, 1);
    const s = newGame({ players, round, scene, seed: 1, top: num(o.top, 0, 1e12, 0) });
    const mz = maze(s);
    if (o.mazeId !== s.mazeId) throw new Error('The save data does not match its maze.');

    s.tick = int(o.tick, 0, 1e12, 0);
    s.sceneT = int(o.sceneT, 0, 1e12, 0);
    s.phase = oneOf(o.phase, PHASES, 'intro');
    s.phaseT = int(o.phaseT, 0, 1000, 60);
    s.rng = int(o.rng, 0, 0xffffffff, 1);

    const v = obj(o.view);
    s.view.x = int(v.x, 0, MW - 1, s.view.x);
    s.view.y = int(v.y, 0, MH - 1, s.view.y);
    s.view.px = s.view.x;
    s.view.py = s.view.y;

    const sc = obj(o.scroll);
    s.scroll.dir = int(sc.dir, -1, 3, -1);
    s.scroll.wantDir = int(sc.wantDir, -1, 3, -1);
    s.scroll.speed = num(sc.speed, 0, 32, 0);
    s.scroll.target = num(sc.target, 0, 32, 0);
    s.scroll.acc = num(sc.acc, 0, 1, 0);

    const dv = obj(o.devil);
    if (scene !== 'bonus') s.devil.mode = oneOf(dv.mode, DEVIL_MODES.slice(0, 3), 'rest');
    s.devil.dir = int(dv.dir, -1, 3, -1);
    s.devil.nextDir = int(dv.nextDir, -1, 3, -1);
    s.devil.lastDir = int(dv.lastDir, -1, 3, -1);
    s.devil.timer = int(dv.timer, 0, 100000, 60);
    s.devil.laughT = int(dv.laughT, 0, 1000, 0);

    if (scene === 'dots') {
      const dots = arr(o.dots, mz.W * mz.H);
      let left = 0;
      for (let k = 0; k < s.dots.length; k++) {
        s.dots[k] = s.dots[k] && dots[k] === 1 ? 1 : 0;
        left += s.dots[k];
      }
      s.dotsLeft = left;
      s.crosses.forEach((c, k) => (c.cd = int(obj(arr(o.crosses, 16)[k]).cd, 0, C.CROSS_RESPAWN, 0)));
      s.treatsSpawned = bool(o.treatsSpawned, false);
      if (s.treatsSpawned) {
        const tr = arr(o.treats, 8);
        s.treats = mz.treats.map(([x, y], k) => ({ x, y, t: int(obj(tr[k]).t, 0, C.TREAT_TICKS, 0) }));
      }
    } else if (scene === 'bibles') {
      const bs = arr(o.bibles, 8);
      s.bibles.forEach((b, k) => {
        const r = obj(bs[k]);
        b.st = int(r.st, 0, 2, 0);
        b.x = int(r.x, 0, mz.W - 1, b.hx);
        b.y = int(r.y, 0, mz.H - 1, b.hy);
        if (mz.grid[b.y * mz.W + b.x] !== 0) {
          b.x = b.hx;
          b.y = b.hy;
        }
        b.by = b.st === 1 ? int(r.by, 0, players - 1, -1) : -1;
        if (b.st === 1 && b.by < 0) b.st = 0;
      });
      const ss = arr(o.seals, 8);
      s.seals.forEach((q, k) => (q.sealed = bool(obj(ss[k]).sealed, false)));
    } else {
      const cs = arr(o.chests, 8);
      let eggs = 0;
      s.chests.forEach((c, k) => {
        const r = obj(cs[k]);
        c.egg = bool(r.egg, false) && eggs++ === 0;
        c.value = c.egg ? 0 : oneOf(r.value, C.BONUS_VALUES, C.BONUS_VALUES[0]);
        c.open = bool(r.open, false);
      });
      s.scroll.target = num(sc.target, 0, C.BONUS_SCROLL, 0);
      s.bonusT = int(o.bonusT, 0, C.BONUS_TICKS, C.BONUS_TICKS);
    }

    s.toasts = arr(o.toasts, 12)
      .map(obj)
      .map((t) => ({
        x: centerOf(int(cellOf(num(t.x, 0, MW - 1, 0)), 0, mz.W - 1, 0)),
        y: centerOf(int(cellOf(num(t.y, 0, MH - 1, 0)), 0, mz.H - 1, 0)),
        t: int(t.t, 1, C.TOAST_TICKS, 1),
        kind: oneOf(t.kind, ['gloom', 'fury'], 'gloom'),
      }))
      .filter((t) => mz.grid[cellOf(t.y) * mz.W + cellOf(t.x)] === 0);

    const onFloor = (x, y) => mz.grid[cellOf(y) * mz.W + cellOf(x)] === 0;
    const es = arr(o.enemies, 16);
    s.enemies.forEach((e, k) => {
      const r = obj(es[k]);
      e.st = oneOf(r.st, ENEMY_STATES, 'nest');
      e.x = int(r.x, 0, MW - 1, e.x);
      e.y = int(r.y, 0, MH - 1, e.y);
      e.px = e.x;
      e.py = e.y;
      e.dir = int(r.dir, -1, 3, -1);
      e.acc = num(r.acc, 0, 1, 0);
      e.t = int(r.t, 0, 10000, 0);
      e.sx = int(r.sx, 0, MW - 1, e.x);
      e.sy = int(r.sy, 0, MH - 1, e.y);
      e.walkT = int(r.walkT, 0, 1e12, 0);
      e.squeeze = int(r.squeeze, 0, CELL, 0);
      if (e.st === 'frozen' && e.kind !== 'garg') e.st = 'walk';
      const aligned = mod(e.x - HALF, CELL) === 0 || mod(e.y - HALF, CELL) === 0;
      if ((e.st === 'walk' || e.st === 'frozen' || e.st === 'hatch') && (!onFloor(e.x, e.y) || !aligned)) e.st = 'nest';
    });
    s.hatchT = int(o.hatchT, 0, 10000, 60);

    s.fires = arr(o.fires, 4)
      .map(obj)
      .map((f) => ({
        o: int(f.o, 0, players - 1, 0),
        x: int(f.x, 0, MW - 1, 0),
        y: int(f.y, 0, MH - 1, 0),
        px: 0,
        py: 0,
        d: int(f.d, 0, 3, 0),
        dist: int(f.dist, 0, C.FIRE_RANGE, 0),
      }))
      .filter((f) => onFloor(f.x, f.y));
    for (const f of s.fires) {
      f.px = f.x;
      f.py = f.y;
    }

    const ps = arr(o.pl, players);
    s.pl.forEach((p, i) => {
      const r = obj(ps[i]);
      p.st = oneOf(r.st, PLAYER_STATES, 'bubble');
      p.lives = int(r.lives, 0, 9, C.START_LIVES);
      p.score = int(r.score, 0, 1e12, 0);
      p.x = int(r.x, 0, MW - 1, p.x);
      p.y = int(r.y, 0, MH - 1, p.y);
      p.px = p.x;
      p.py = p.y;
      p.dir = int(r.dir, -1, 3, -1);
      p.face = int(r.face, 0, 3, 2);
      p.want = int(r.want, -1, 3, -1);
      p.wantT = int(r.wantT, 0, C.INPUT_GRACE, 0);
      p.power = int(r.power, 0, 100000, 0);
      p.bible = int(r.bible, -1, s.bibles.length - 1, -1);
      p.fireCd = int(r.fireCd, 0, 60, 0);
      p.fireAnim = int(r.fireAnim, 0, 60, 0);
      p.inv = int(r.inv, 0, 600, 0);
      p.deadT = int(r.deadT, 0, C.DEATH_TICKS, 0);
      p.deadKind = oneOf(r.deadKind, ['', 'enemy', 'crush'], '');
      p.bx = int(r.bx, 0, VWU, p.bx);
      p.by = int(r.by, 0, VHU, p.by);
      p.bt = int(r.bt, 0, 1e9, 0);
      p.squeeze = int(r.squeeze, 0, CELL, 0);
      p.walkT = int(r.walkT, 0, 1e12, 0);
      p.moving = bool(r.moving, false);
      if (p.score > s.top) s.top = p.score;
      if (p.lives === 0 && p.st !== 'dead') p.st = 'out';
      if (p.st === 'out') p.lives = 0;
      const aligned = mod(p.x - HALF, CELL) === 0 || mod(p.y - HALF, CELL) === 0;
      if (p.st === 'walk' && (!onFloor(p.x, p.y) || !aligned)) toBubble(s, i, ...bubblePos(s, i));
      if (p.bible >= 0 && (p.st !== 'walk' || s.bibles[p.bible].st !== 1 || s.bibles[p.bible].by !== i)) p.bible = -1;
    });
    // A Bible marked as carried must have a carrier.
    s.bibles.forEach((b, k) => {
      if (b.st === 1 && !s.pl.some((p) => p.bible === k)) {
        b.st = 0;
        b.by = -1;
      }
    });
    return s;
  }

  function summary(s) {
    return {
      players: s.players,
      round: s.round,
      scene: s.scene,
      maze: maze(s).name,
      scores: s.pl.map((p) => p.score),
      lives: s.pl.map((p) => p.lives),
    };
  }

  DM.game = {
    SCENES,
    newGame,
    tick,
    serialize,
    restore,
    summary,
    maze,
    diffOf,
    relX,
    relY,
    cellOf,
    centerOf,
    cellInView,
    hasFire,
    // exposed for the unit tests
    _internal: { stepEntity, enforceView, pushAxis, roomInDir, playerAtCenter, setupScene, killPlayer, bubblePos },
  };
})(typeof window !== 'undefined' ? window : globalThis);
