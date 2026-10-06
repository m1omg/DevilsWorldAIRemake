/*
 * Devil's Maze — constants and per-round difficulty.
 *
 * Units: one maze cell is 256 "units" and 16 logical pixels, so 1 px = 16 units.
 * All simulation maths uses whole units on a fixed 60 Hz tick, which keeps the
 * game identical on 30 Hz, 60 Hz, 144 Hz or 240 Hz displays.
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});
  const { lerp } = DM.util;

  const C = {
    VERSION: 1,
    TICK_HZ: 60,
    CELL: 256, // units per cell
    PX: 16, // units per logical pixel
    MAZE_W: 20, // maze size in cells (the maze wraps around in both directions)
    MAZE_H: 14,
    VIEW_W: 16, // visible window in cells
    VIEW_H: 10,

    // Logical canvas layout in pixels (scaled to fit the browser window).
    LW: 320,
    LH: 256,
    VIEW_X: 32,
    VIEW_Y: 64,

    PLAYER_SPEED: 16, // units per tick = 60 px/s = 3.75 cells/s
    FIRE_SPEED: 40,
    FIRE_RANGE: 6 * 256,
    FIRE_COOLDOWN: 14,
    HIT_RANGE: 176, // entity-vs-entity overlap (units, per axis)
    FIRE_HIT_RANGE: 176,
    CRUSH_TOL: 96, // how far the moving frame may overlap a stuck sprite before it is crushed
    PUSH_SNAP: 56, // a pushed sprite this close to a corridor centre is snapped onto it
    INPUT_GRACE: 12, // ticks a tapped direction stays buffered
    DEATH_TICKS: 100,
    START_LIVES: 4,
    CROSS_RESPAWN: 600,
    TOAST_TICKS: 360,
    TREAT_TICKS: 720,
    SPAWN_SAFE_DIST: 3 * 256,

    BONUS_TICKS: 40 * 60,
    BONUS_SCROLL: 6,
    BONUS_VALUES: [500, 1000, 2000, 3000, 5000],

    SCORE: {
      dot: 100,
      toast: 500,
      treat: 800,
      bibleTake: 1000,
      bibleSeal: 1000,
    },
  };

  C.MW = C.MAZE_W * C.CELL;
  C.MH = C.MAZE_H * C.CELL;
  C.VWU = C.VIEW_W * C.CELL;
  C.VHU = C.VIEW_H * C.CELL;

  // Which enemies a round uses, in hatching order. New kinds join the cast in
  // round 2 (gargling) and round 7 (furylet), as in the original game.
  function roster(round) {
    if (round <= 1) return ['gloom', 'gloom', 'gloom'];
    if (round <= 3) return ['gloom', 'garg', 'gloom', 'gloom'];
    if (round <= 6) return ['gloom', 'garg', 'gloom', 'garg', 'gloom'];
    if (round <= 9) return ['fury', 'gloom', 'garg', 'gloom', 'garg'];
    if (round <= 12) return ['fury', 'garg', 'gloom', 'fury', 'garg', 'gloom'];
    return ['fury', 'garg', 'fury', 'gloom', 'garg', 'fury'];
  }

  // Difficulty rises over rounds 1-16, then stays at the round-16 level.
  function difficulty(round) {
    const r = Math.max(1, round | 0);
    const t = Math.min(r - 1, 15) / 15;
    const ri = (a, b) => Math.round(lerp(a, b, t));
    return {
      t,
      enemySpeed: {
        gloom: lerp(12.5, 15.5, t),
        garg: lerp(11.5, 14.5, t),
        fury: lerp(16.5, 18.5, t),
      },
      chase: {
        gloom: lerp(0.35, 0.6, t),
        garg: lerp(0.2, 0.45, t),
        fury: lerp(0.6, 0.85, t),
      },
      scrollSpeed: lerp(2.4, 4.6, t), // units per tick (0.56 -> 1.08 cells per second)
      crossTicks: ri(600, 360),
      freezeTicks: ri(210, 120),
      hatchInterval: ri(150, 70),
      firstHatch: ri(120, 60),
      scrollTicks: [ri(300, 420), ri(480, 600)],
      restTicks: [ri(90, 40), ri(150, 80)],
      warnTicks: ri(60, 40),
      roster: roster(r),
    };
  }

  DM.C = C;
  DM.difficulty = difficulty;
})(typeof window !== 'undefined' ? window : globalThis);
