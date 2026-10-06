/*
 * Devil's Maze — shared utilities.
 * Plain browser script (no modules) so the game also runs from file://.
 * Everything hangs off the global DM namespace.
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});

  // Directions: 0 up, 1 right, 2 down, 3 left. Opposite direction is d ^ 2.
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  const NONE = -1;

  // Remainder that is never negative. JavaScript's % keeps the sign of the
  // dividend (-3 % 20 === -3), which is wrong for wrap-around maze maths.
  function mod(a, n) {
    const r = a % n;
    return r < 0 ? r + n : r;
  }

  // Shortest signed distance from a to b on a ring of length n, in [-n/2, n/2).
  function wrapDelta(a, b, n) {
    return mod(b - a + n / 2, n) - n / 2;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Deterministic PRNG (mulberry32). The state lives inside the game state
  // object (s.rng) so saves and replays reproduce exactly.
  function rand(s) {
    let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function randInt(s, n) {
    return Math.floor(rand(s) * n);
  }

  // 32-bit FNV-1a over a string, returned as 8 hex digits. Used as a save
  // file integrity check (not as security).
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  // Easing helpers for purely visual animation.
  function easeOutCubic(t) {
    const u = 1 - t;
    return 1 - u * u * u;
  }
  function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  }

  function pad(num, width) {
    let s = String(Math.max(0, Math.floor(num)));
    while (s.length < width) s = '0' + s;
    return s;
  }

  DM.util = {
    DX,
    DY,
    NONE,
    mod,
    wrapDelta,
    clamp,
    lerp,
    rand,
    randInt,
    fnv1a,
    deepClone,
    easeOutCubic,
    easeInOutSine,
    pad,
  };
})(typeof window !== 'undefined' ? window : globalThis);
