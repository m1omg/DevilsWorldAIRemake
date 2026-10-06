/*
 * Devil's Maze — procedural art.
 *
 * Every character and item is drawn from canvas paths and gradients at run
 * time. No bitmaps are used and nothing is taken from the original game: the
 * hero, enemies, Devil and imps are original designs made for this remake.
 *
 * Each draw function paints around the origin in logical pixels (one maze
 * cell = 16 px); the caller translates to the sprite position first.
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});
  const TAU = Math.PI * 2;

  // ---- palettes -------------------------------------------------------------

  const HEROES = [
    {
      name: 'Kindle',
      body: '#3fe0b0',
      bodyDark: '#138a76',
      belly: '#fff3c9',
      wing: '#0e6f63',
      wingHi: '#2bb79a',
      horn: '#fff1d6',
      cheek: 'rgba(255,120,150,0.45)',
      ui: '#4cf0bf',
    },
    {
      name: 'Cinder',
      body: '#ff8a72',
      bodyDark: '#b7343e',
      belly: '#ffe8bd',
      wing: '#8a2232',
      wingHi: '#e2566b',
      horn: '#fff1d6',
      cheek: 'rgba(255,220,120,0.45)',
      ui: '#ff8f7a',
    },
  ];

  const MAZE_PALETTES = {
    amethyst: {
      floor: '#160f2e',
      floorTile: '#1d143c',
      floorLine: '#2a1d55',
      wallTop: '#a88bff',
      wallMid: '#6c4fd6',
      wallSide: '#2c1c6b',
      wallHi: '#e6dcff',
      wallLo: '#1b0f45',
      edge: '#c7a8ff',
      rune: '#8f6bff',
      dot: '#ff7ae0',
      frame: '#1d1236',
      frameHi: '#5a3fa8',
      bg1: '#120a24',
      bg2: '#2b1650',
    },
    ember: {
      floor: '#1f0b0a',
      floorTile: '#2a100d',
      floorLine: '#401a14',
      wallTop: '#ff9c5c',
      wallMid: '#d4482c',
      wallSide: '#5e1610',
      wallHi: '#ffe0c0',
      wallLo: '#3a0a07',
      edge: '#ffb27a',
      rune: '#ff5a2a',
      dot: '#ffd34d',
      frame: '#26100c',
      frameHi: '#8a3420',
      bg1: '#170807',
      bg2: '#40140d',
    },
    abyss: {
      floor: '#04161f',
      floorTile: '#072230',
      floorLine: '#0d3445',
      wallTop: '#62f0dc',
      wallMid: '#1fa3a0',
      wallSide: '#0a4552',
      wallHi: '#d8fff8',
      wallLo: '#04262e',
      edge: '#8ffff0',
      rune: '#36e7ff',
      dot: '#9dff8a',
      frame: '#06202a',
      frameHi: '#1d6f7c',
      bg1: '#031017',
      bg2: '#0a3141',
    },
    sulfur: {
      floor: '#1a1405',
      floorTile: '#241c08',
      floorLine: '#3a2d0c',
      wallTop: '#f6d65a',
      wallMid: '#b98f1f',
      wallSide: '#4f3a08',
      wallHi: '#fff6c4',
      wallLo: '#2c2004',
      edge: '#ffe98a',
      rune: '#e0b52a',
      dot: '#b3f7ff',
      frame: '#1d1606',
      frameHi: '#7a5c14',
      bg1: '#120d03',
      bg2: '#3a2c09',
    },
    vault: {
      floor: '#0c1230',
      floorTile: '#111a40',
      floorLine: '#1e2b63',
      wallTop: '#ffd773',
      wallMid: '#d49a2c',
      wallSide: '#5c3a0e',
      wallHi: '#fff4cc',
      wallLo: '#33200a',
      edge: '#ffe9a3',
      rune: '#5ad1ff',
      dot: '#ffffff',
      frame: '#0e1430',
      frameHi: '#4a5bb0',
      bg1: '#080c20',
      bg2: '#1a2458',
    },
  };

  // ---- small helpers --------------------------------------------------------

  function ellipse(ctx, x, y, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU);
  }
  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.01, r), 0, TAU);
  }
  function radial(ctx, x, y, r, stops) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }
  function linear(ctx, x0, y0, x1, y1, stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  function shadow(ctx, w, y) {
    ellipse(ctx, 0, y === undefined ? 7 : y, w, w * 0.3);
    ctx.fillStyle = 'rgba(0,0,0,0.33)';
    ctx.fill();
  }
  function glow(ctx, x, y, r, color, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= alpha === undefined ? 1 : alpha;
    circle(ctx, x, y, r);
    ctx.fillStyle = radial(ctx, x, y, r, [
      [0, color],
      [1, 'rgba(0,0,0,0)'],
    ]);
    ctx.fill();
    ctx.restore();
  }

  // ---- the hero dragons -------------------------------------------------------

  function dragonWing(ctx, c, flap, scale) {
    ctx.save();
    ctx.scale(scale, scale);
    ctx.rotate(-0.25 - flap * 0.35);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-2, -5.5, -6.5, -6.2);
    ctx.quadraticCurveTo(-5.3, -4.1, -6.2, -2.6);
    ctx.quadraticCurveTo(-4.6, -2.4, -4.9, -0.8);
    ctx.quadraticCurveTo(-3.2, -1.2, -2.6, 0.6);
    ctx.closePath();
    ctx.fillStyle = linear(ctx, 0, 0, -6, -6, [
      [0, c.wingHi],
      [1, c.wing],
    ]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.4;
    ctx.stroke();
    ctx.restore();
  }

  function dragonTail(ctx, c, t, sx, sy, ex, ey, cx, cy) {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.lineCap = 'round';
    ctx.strokeStyle = c.bodyDark;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.strokeStyle = c.body;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // flame tip
    const fl = 1 + Math.sin(t * 22) * 0.18 + Math.sin(t * 13.7) * 0.12;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.scale(fl, fl);
    ctx.beginPath();
    ctx.moveTo(0, -2.6);
    ctx.quadraticCurveTo(1.7, -0.4, 0, 1.2);
    ctx.quadraticCurveTo(-1.7, -0.4, 0, -2.6);
    ctx.fillStyle = '#ffb02e';
    ctx.fill();
    ellipse(ctx, 0, -0.1, 0.6, 1.0);
    ctx.fillStyle = '#fff3a0';
    ctx.fill();
    ctx.restore();
  }

  function dragonEye(ctx, x, y, rx, ry, lookX, lookY, blink) {
    if (blink) {
      ctx.beginPath();
      ctx.moveTo(x - rx, y);
      ctx.quadraticCurveTo(x, y + ry * 0.7, x + rx, y);
      ctx.strokeStyle = '#21152b';
      ctx.lineWidth = 0.6;
      ctx.stroke();
      return;
    }
    ellipse(ctx, x, y, rx, ry);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ellipse(ctx, x + lookX, y + lookY + 0.2, rx * 0.62, ry * 0.62);
    ctx.fillStyle = '#21152b';
    ctx.fill();
    circle(ctx, x + lookX - rx * 0.25, y + lookY - ry * 0.3, rx * 0.26);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  /*
   * o: { hero: 0|1, face: 0 up 1 right 2 down 3 left, t: seconds, moving,
   *      walk: distance walked (for the step cycle), mouth: 0..1 }
   */
  function drawDragon(ctx, o) {
    const c = HEROES[o.hero || 0];
    const t = o.t || 0;
    const face = o.face === undefined ? 2 : o.face;
    const step = o.moving ? (o.walk || 0) * 0.025 : 0;
    const bob = o.moving ? -Math.abs(Math.sin(step)) * 0.9 : Math.sin(t * 2.6) * 0.25;
    const foot = o.moving ? Math.sin(step) * 1.1 : 0;
    const flap = Math.sin(t * (o.moving ? 14 : 4)) * 0.5 + 0.5;
    const blink = !o.moving && t % 3.7 < 0.12;
    const mouth = o.mouth || 0;

    ctx.save();
    shadow(ctx, 5.4, 7.6);
    if (face === 3) ctx.scale(-1, 1);

    if (face === 1 || face === 3) {
      // profile, looking right
      dragonTail(ctx, c, t, -3, 4.5, -8.4, 1.4 + Math.sin(t * 5) * 0.6, -7.5, 5.8);
      ctx.save();
      ctx.translate(-1.6, -0.6 + bob);
      dragonWing(ctx, c, flap, 1.05);
      ctx.restore();
      ellipse(ctx, 1.9 - foot, 6.6, 1.8, 1.15);
      ctx.fillStyle = c.bodyDark;
      ctx.fill();
      ellipse(ctx, 0, 3.4 + bob * 0.5, 4.5, 3.9);
      ctx.fillStyle = radial(ctx, -1.5, 1.5, 6.5, [
        [0, c.body],
        [1, c.bodyDark],
      ]);
      ctx.fill();
      ellipse(ctx, 1.6, 4 + bob * 0.5, 2.3, 2.6);
      ctx.fillStyle = c.belly;
      ctx.fill();
      ellipse(ctx, -1.4 + foot, 6.8, 1.9, 1.2);
      ctx.fillStyle = c.body;
      ctx.fill();
      // head
      ctx.save();
      ctx.translate(0.6, bob);
      ctx.beginPath();
      ctx.moveTo(-1.4, -6.5);
      ctx.quadraticCurveTo(-4.4, -8.4, -5.4, -10.4);
      ctx.quadraticCurveTo(-2.6, -9.6, -0.2, -7.4);
      ctx.fillStyle = c.horn;
      ctx.fill();
      circle(ctx, 0, -2.5, 5.3);
      ctx.fillStyle = radial(ctx, -1.5, -4.5, 7, [
        [0, c.body],
        [1, c.bodyDark],
      ]);
      ctx.fill();
      // snout
      ellipse(ctx, 4.5, -0.9, 2.8, 2.1);
      ctx.fillStyle = radial(ctx, 4, -1.6, 3.4, [
        [0, c.belly],
        [1, c.body],
      ]);
      ctx.fill();
      circle(ctx, 6.4, -1.7, 0.42);
      ctx.fillStyle = 'rgba(30,20,40,0.7)';
      ctx.fill();
      // mouth
      if (mouth > 0) {
        ellipse(ctx, 5.4, 0.6, 1.7, 0.9 + mouth * 0.9);
        ctx.fillStyle = '#5a1020';
        ctx.fill();
        glow(ctx, 6.4, 0.6, 3.5, 'rgba(255,170,60,0.9)', mouth);
      } else {
        ctx.beginPath();
        ctx.moveTo(3, 0.6);
        ctx.quadraticCurveTo(5, 1.4, 6.9, 0.2);
        ctx.strokeStyle = 'rgba(40,20,40,0.55)';
        ctx.lineWidth = 0.45;
        ctx.stroke();
      }
      ellipse(ctx, 1.4, -0.4, 1.4, 0.8);
      ctx.fillStyle = c.cheek;
      ctx.fill();
      dragonEye(ctx, 1.8, -3.2, 1.55, 1.9, 0.5, 0.1, blink);
      // crest spikes
      ctx.beginPath();
      ctx.moveTo(-3.6, -5.6);
      ctx.lineTo(-5.4, -6.6);
      ctx.lineTo(-4.6, -4.6);
      ctx.lineTo(-5.9, -4.7);
      ctx.lineTo(-4.9, -3.1);
      ctx.fillStyle = c.wingHi;
      ctx.fill();
      ctx.restore();
    } else if (face === 2) {
      // facing the viewer
      dragonTail(ctx, c, t, 2.5, 5, 8, 2.6 + Math.sin(t * 5) * 0.5, 7.2, 6.4);
      ctx.save();
      ctx.translate(-2.6, 0.4 + bob);
      dragonWing(ctx, c, flap, 0.9);
      ctx.restore();
      ctx.save();
      ctx.translate(2.6, 0.4 + bob);
      ctx.scale(-1, 1);
      dragonWing(ctx, c, flap, 0.9);
      ctx.restore();
      ellipse(ctx, -2.3, 6.6 + foot * 0.4, 1.8, 1.2);
      ctx.fillStyle = c.bodyDark;
      ctx.fill();
      ellipse(ctx, 2.3, 6.6 - foot * 0.4, 1.8, 1.2);
      ctx.fill();
      ellipse(ctx, 0, 3.4 + bob * 0.5, 4.6, 3.9);
      ctx.fillStyle = radial(ctx, -1.5, 1.6, 6.5, [
        [0, c.body],
        [1, c.bodyDark],
      ]);
      ctx.fill();
      ellipse(ctx, 0, 4.1 + bob * 0.5, 2.9, 2.6);
      ctx.fillStyle = c.belly;
      ctx.fill();
      ctx.save();
      ctx.translate(0, bob);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 2.4, -6.8);
        ctx.quadraticCurveTo(s * 4.6, -8.6, s * 4.9, -10.6);
        ctx.quadraticCurveTo(s * 3.3, -9.2, s * 1.0, -7.6);
        ctx.fillStyle = c.horn;
        ctx.fill();
      }
      circle(ctx, 0, -2.5, 5.4);
      ctx.fillStyle = radial(ctx, -1.6, -4.6, 7.2, [
        [0, c.body],
        [1, c.bodyDark],
      ]);
      ctx.fill();
      ellipse(ctx, 0, 0.3, 2.9, 1.8);
      ctx.fillStyle = radial(ctx, 0, -0.4, 3.2, [
        [0, c.belly],
        [1, c.body],
      ]);
      ctx.fill();
      circle(ctx, -0.8, -0.1, 0.38);
      ctx.fillStyle = 'rgba(30,20,40,0.7)';
      ctx.fill();
      circle(ctx, 0.8, -0.1, 0.38);
      ctx.fill();
      if (mouth > 0) {
        ellipse(ctx, 0, 1.6, 1.5, 0.6 + mouth * 0.8);
        ctx.fillStyle = '#5a1020';
        ctx.fill();
        glow(ctx, 0, 2, 3.5, 'rgba(255,170,60,0.9)', mouth);
      } else {
        ctx.beginPath();
        ctx.moveTo(-1.3, 1.25);
        ctx.quadraticCurveTo(0, 2.1, 1.3, 1.25);
        ctx.strokeStyle = 'rgba(40,20,40,0.55)';
        ctx.lineWidth = 0.45;
        ctx.stroke();
      }
      ellipse(ctx, -3.6, -0.5, 1.2, 0.75);
      ctx.fillStyle = c.cheek;
      ctx.fill();
      ellipse(ctx, 3.6, -0.5, 1.2, 0.75);
      ctx.fill();
      dragonEye(ctx, -2.1, -3, 1.5, 1.85, 0, 0.25, blink);
      dragonEye(ctx, 2.1, -3, 1.5, 1.85, 0, 0.25, blink);
      ctx.restore();
    } else {
      // seen from behind
      ellipse(ctx, -2.3, 6.4 - foot * 0.4, 1.8, 1.2);
      ctx.fillStyle = c.bodyDark;
      ctx.fill();
      ellipse(ctx, 2.3, 6.4 + foot * 0.4, 1.8, 1.2);
      ctx.fill();
      ellipse(ctx, 0, 3.3 + bob * 0.5, 4.6, 3.9);
      ctx.fillStyle = radial(ctx, -1.5, 1.6, 6.5, [
        [0, c.body],
        [1, c.bodyDark],
      ]);
      ctx.fill();
      dragonTail(ctx, c, t, 0, 6.2, 4.4 + Math.sin(t * 5) * 0.8, 9.6, 1.2, 9.8);
      ctx.save();
      ctx.translate(0, bob);
      circle(ctx, 0, -2.6, 5.3);
      ctx.fillStyle = radial(ctx, -1.2, -4.4, 7.2, [
        [0, c.body],
        [1, c.bodyDark],
      ]);
      ctx.fill();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 2.2, -6.6);
        ctx.quadraticCurveTo(s * 4.4, -8.4, s * 4.7, -10.4);
        ctx.quadraticCurveTo(s * 3.2, -9.1, s * 0.8, -7.4);
        ctx.fillStyle = c.horn;
        ctx.fill();
      }
      ctx.fillStyle = c.wingHi;
      for (let k = 0; k < 4; k++) {
        const y = -6 + k * 2.6;
        ctx.beginPath();
        ctx.moveTo(-0.9, y);
        ctx.lineTo(0, y - 1.6);
        ctx.lineTo(0.9, y);
        ctx.fill();
      }
      ctx.restore();
      ctx.save();
      ctx.translate(-2.4, 1.4 + bob);
      dragonWing(ctx, c, flap, 1.15);
      ctx.restore();
      ctx.save();
      ctx.translate(2.4, 1.4 + bob);
      ctx.scale(-1, 1);
      dragonWing(ctx, c, flap, 1.15);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawBubble(ctx, t, hero) {
    const r = 9.6 + Math.sin(t * 3) * 0.35;
    ctx.save();
    ctx.translate(0, Math.sin(t * 2) * 0.8);
    circle(ctx, 0, 0, r);
    ctx.fillStyle = radial(ctx, -3, -3, r * 1.2, [
      [0, 'rgba(255,255,255,0.10)'],
      [0.7, 'rgba(160,220,255,0.10)'],
      [1, 'rgba(160,120,255,0.30)'],
    ]);
    ctx.fill();
    ctx.save();
    ctx.scale(0.82, 0.82);
    drawDragon(ctx, { hero, face: 2, t, moving: false });
    ctx.restore();
    circle(ctx, 0, 0, r);
    const hue = (t * 60) % 360;
    ctx.strokeStyle = `hsla(${hue},90%,75%,0.75)`;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r - 2, Math.PI * 1.1, Math.PI * 1.45);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // ---- enemies --------------------------------------------------------------

  const SLIMES = {
    gloom: { light: '#b48cff', dark: '#4b2aa8', eye: '#ffffff', pupil: '#1c0b3a' },
    fury: { light: '#ff9a5c', dark: '#a8182e', eye: '#fff07a', pupil: '#3a0710' },
  };

  /* o: { kind: 'gloom'|'fury', t, walk, dir, alpha } */
  function drawSlime(ctx, o) {
    const pal = SLIMES[o.kind] || SLIMES.gloom;
    const t = o.t || 0;
    const ph = (o.walk || 0) * 0.04 + t * 2;
    const sq = 1 + Math.sin(ph * 2) * 0.07;
    const dx = o.dir === 1 ? 1 : o.dir === 3 ? -1 : 0;
    const dy = o.dir === 0 ? -1 : o.dir === 2 ? 1 : 0;
    ctx.save();
    shadow(ctx, 5.8, 7.4);
    ctx.translate(0, 6);
    ctx.scale(1 / sq, sq);
    ctx.translate(0, -6);
    if (o.kind === 'fury') {
      for (let k = -1; k <= 1; k++) {
        const h = 3.2 + Math.sin(t * 18 + k * 2) * 0.9;
        ctx.beginPath();
        ctx.moveTo(k * 3 - 1.8, -4.4);
        ctx.quadraticCurveTo(k * 3.4, -6 - h, k * 3 + 1.8, -4.4);
        ctx.fillStyle = k === 0 ? '#ffd24a' : '#ff7a2a';
        ctx.fill();
      }
    }
    ctx.beginPath();
    ctx.moveTo(-6.6, 5.2);
    ctx.bezierCurveTo(-7.6, -2, -4.8, -6.8, 0, -6.8);
    ctx.bezierCurveTo(4.8, -6.8, 7.6, -2, 6.6, 5.2);
    const wob = Math.sin(ph * 3) * 0.6;
    for (let k = 0; k < 4; k++) {
      const x0 = 6.6 - k * 3.3;
      ctx.quadraticCurveTo(x0 - 1.65, 7.4 + (k % 2 ? wob : -wob), x0 - 3.3, 5.2);
    }
    ctx.closePath();
    ctx.fillStyle = radial(ctx, -2.2, -3.2, 10, [
      [0, pal.light],
      [1, pal.dark],
    ]);
    ctx.fill();
    ellipse(ctx, -2.6, -3.6, 2, 1.2, -0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
    for (const s of [-1, 1]) {
      ellipse(ctx, s * 2.4, -0.8, 1.7, 2.05);
      ctx.fillStyle = pal.eye;
      ctx.fill();
      circle(ctx, s * 2.4 + dx * 0.6, -0.6 + dy * 0.6, 0.95);
      ctx.fillStyle = pal.pupil;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 4.2, -3.6);
      ctx.lineTo(s * 1.1, -2.4);
      ctx.strokeStyle = pal.pupil;
      ctx.lineWidth = 0.8;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-1.8, 2.6);
    ctx.lineTo(-0.9, 3.3);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(0.9, 3.3);
    ctx.lineTo(1.8, 2.6);
    ctx.strokeStyle = pal.pupil;
    ctx.lineWidth = 0.55;
    ctx.stroke();
    ctx.restore();
  }

  /* o: { t, walk, dir, frozen: 0..1, thaw: 0..1 } */
  function drawGargling(ctx, o) {
    const t = o.t || 0;
    const frozen = o.frozen || 0;
    const flap = frozen ? 0.3 : Math.sin(t * 16) * 0.5 + 0.5;
    const hover = frozen ? 0 : Math.sin(t * 5) * 0.7;
    const dx = o.dir === 1 ? 1 : o.dir === 3 ? -1 : 0;
    const dy = o.dir === 0 ? -1 : o.dir === 2 ? 1 : 0;
    const body = frozen ? '#b9d6ee' : '#8796c4';
    const dark = frozen ? '#6d8fb2' : '#38406b';
    ctx.save();
    if (frozen && o.thaw > 0) ctx.translate(Math.sin(t * 60) * 0.5 * o.thaw, 0);
    shadow(ctx, 4.6, 7.4);
    ctx.translate(0, hover - 0.5);
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * 3.4, -0.6);
      ctx.scale(s, 1);
      ctx.rotate(-0.15 - flap * 0.5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(4.6, -4.4);
      ctx.lineTo(7.2, -1.6);
      ctx.quadraticCurveTo(5.6, -1.2, 5.6, 0.6);
      ctx.quadraticCurveTo(3.9, -0.1, 3.2, 1.6);
      ctx.quadraticCurveTo(1.8, 0.6, 0, 1.8);
      ctx.closePath();
      ctx.fillStyle = frozen ? '#9fbfdc' : '#4a4f80';
      ctx.fill();
      ctx.restore();
    }
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 2.2, -4.2);
      ctx.quadraticCurveTo(s * 3.8, -7.8, s * 1.6, -9.4);
      ctx.quadraticCurveTo(s * 2.4, -7.2, s * 0.6, -5);
      ctx.fillStyle = frozen ? '#e6f4ff' : '#d9cba6';
      ctx.fill();
    }
    ellipse(ctx, 0, 0.8, 5.1, 5.3);
    ctx.fillStyle = radial(ctx, -1.8, -1.6, 8, [
      [0, body],
      [1, dark],
    ]);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 4.4, -1.6);
      ctx.lineTo(s * 6.6, -3.6);
      ctx.lineTo(s * 4.9, 0.2);
      ctx.fillStyle = dark;
      ctx.fill();
    }
    const eyeCol = frozen ? '#ffffff' : '#5ff3ff';
    for (const s of [-1, 1]) {
      ellipse(ctx, s * 1.9 + dx * 0.5, -0.4 + dy * 0.4, 1.25, 0.85, s * 0.35);
      ctx.fillStyle = eyeCol;
      ctx.fill();
      if (!frozen) glow(ctx, s * 1.9 + dx * 0.5, -0.4 + dy * 0.4, 2.4, 'rgba(95,243,255,0.8)', 0.6);
    }
    ctx.beginPath();
    ctx.moveTo(-2, 2.4);
    ctx.quadraticCurveTo(0, 3.6, 2, 2.4);
    ctx.strokeStyle = 'rgba(20,20,40,0.6)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 1.4, 2.7);
      ctx.lineTo(s * 1.0, 1.5);
      ctx.lineTo(s * 0.6, 2.85);
      ctx.fill();
    }
    ellipse(ctx, -1.9, 5.5, 1.4, 0.9);
    ctx.fillStyle = dark;
    ctx.fill();
    ellipse(ctx, 1.9, 5.5, 1.4, 0.9);
    ctx.fill();
    if (frozen) {
      ctx.globalAlpha *= frozen;
      roundRect(ctx, -7.6, -9.6, 15.2, 16.8, 3.2);
      ctx.fillStyle = linear(ctx, -7, -9, 7, 7, [
        [0, 'rgba(225,250,255,0.55)'],
        [1, 'rgba(120,200,255,0.35)'],
      ]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-5.6, -6.5);
      ctx.lineTo(-2.8, -9);
      ctx.moveTo(-6.2, -2.4);
      ctx.lineTo(-1.2, -7.4);
      ctx.moveTo(3.4, 5.2);
      ctx.lineTo(6, 2.6);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSpirit(ctx, t, kind) {
    const col = kind === 'garg' ? '95,243,255' : kind === 'fury' ? '255,160,90' : '200,160,255';
    ctx.save();
    glow(ctx, 0, 0, 7, `rgba(${col},0.55)`);
    ctx.beginPath();
    ctx.moveTo(-3, 2);
    ctx.quadraticCurveTo(-4, -4, 0, -4.5);
    ctx.quadraticCurveTo(4, -4, 3, 2);
    ctx.quadraticCurveTo(1.5, 1, 0, 3.4 + Math.sin(t * 20));
    ctx.quadraticCurveTo(-1.5, 1, -3, 2);
    ctx.fillStyle = `rgba(${col},0.45)`;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    circle(ctx, -1.2, -1.4, 0.7);
    ctx.fill();
    circle(ctx, 1.2, -1.4, 0.7);
    ctx.fill();
    ctx.restore();
  }

  // ---- items ------------------------------------------------------------------

  function crossShape(ctx, s) {
    ctx.beginPath();
    roundRectPath(ctx, -1.35 * s, -6.2 * s, 2.7 * s, 12.4 * s, 0.7 * s);
    roundRectPath(ctx, -4.4 * s, -3.3 * s, 8.8 * s, 2.7 * s, 0.7 * s);
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCross(ctx, t) {
    ctx.save();
    ctx.translate(0, Math.sin(t * 3) * 0.8 - 1);
    ctx.save();
    ctx.rotate(t * 0.8);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 8; k++) {
      ctx.rotate(TAU / 8);
      ctx.beginPath();
      ctx.moveTo(-0.7, 0);
      ctx.lineTo(0, -11);
      ctx.lineTo(0.7, 0);
      ctx.fillStyle = 'rgba(255,230,140,0.22)';
      ctx.fill();
    }
    ctx.restore();
    glow(ctx, 0, 0, 10, 'rgba(255,214,90,0.75)', 0.9);
    crossShape(ctx, 1);
    ctx.fillStyle = linear(ctx, -4, -6, 4, 6, [
      [0, '#fff6c2'],
      [0.45, '#ffd34a'],
      [1, '#c78612'],
    ]);
    ctx.fill('nonzero');
    ctx.strokeStyle = 'rgba(110,60,0,0.6)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawCrossMarker(ctx, active) {
    circle(ctx, 0, 0, 6.2);
    ctx.strokeStyle = active ? 'rgba(255,220,120,0.5)' : 'rgba(255,220,120,0.18)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.save();
    ctx.globalAlpha *= active ? 0.35 : 0.2;
    crossShape(ctx, 0.62);
    ctx.fillStyle = '#ffe08a';
    ctx.fill('nonzero');
    ctx.restore();
  }

  function drawBible(ctx, t, glowAmt) {
    ctx.save();
    ctx.translate(0, Math.sin(t * 2.6) * 0.7 - 0.5);
    if (glowAmt) glow(ctx, 0, 0, 11, 'rgba(255,240,170,0.7)', glowAmt);
    roundRect(ctx, -5.6, -4.6, 11.6, 9.8, 1.2);
    ctx.fillStyle = '#3a1f12';
    ctx.fill();
    roundRect(ctx, -4.6, -3.8, 10.2, 8.4, 0.6);
    ctx.fillStyle = '#fff7e2';
    ctx.fill();
    roundRect(ctx, -5.6, -5.2, 10.8, 9.3, 1.2);
    ctx.fillStyle = linear(ctx, -5, -5, 5, 4, [
      [0, '#7b3fd1'],
      [1, '#3d1a7a'],
    ]);
    ctx.fill();
    ctx.strokeStyle = '#ffd35a';
    ctx.lineWidth = 0.6;
    roundRect(ctx, -4.6, -4.3, 8.8, 7.5, 0.8);
    ctx.stroke();
    ctx.fillStyle = '#ffd35a';
    ctx.fillRect(-4.9, -5.2, 0.9, 9.3);
    ctx.save();
    ctx.translate(-0.1, -0.6);
    crossShape(ctx, 0.42);
    ctx.fill('nonzero');
    ctx.restore();
    ctx.restore();
  }

  /* A Devil Gate, open (red, pulsing) or sealed (gold with a Bible on it). */
  function drawSeal(ctx, t, sealed) {
    ctx.save();
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    if (sealed) {
      glow(ctx, 0, 0, 13, 'rgba(255,236,160,0.65)', 0.9);
      circle(ctx, 0, 0, 7.2);
      ctx.fillStyle = radial(ctx, 0, 0, 7.2, [
        [0, '#fff7d6'],
        [1, '#d8a536'],
      ]);
      ctx.fill();
      ctx.strokeStyle = '#fff2b8';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.save();
      ctx.scale(0.62, 0.62);
      drawBible(ctx, t, 0);
      ctx.restore();
    } else {
      glow(ctx, 0, 0, 12, 'rgba(255,40,60,0.75)', 0.45 + pulse * 0.4);
      circle(ctx, 0, 0, 7.2);
      ctx.fillStyle = radial(ctx, 0, 0, 7.2, [
        [0, '#2a0005'],
        [0.75, '#5a0010'],
        [1, '#a0102a'],
      ]);
      ctx.fill();
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = `rgba(255,${80 + pulse * 80},${90 + pulse * 60},0.95)`;
      circle(ctx, 0, 0, 6.6);
      ctx.stroke();
      circle(ctx, 0, 0, 4.4);
      ctx.stroke();
      ctx.save();
      ctx.rotate(t * 0.9);
      for (let k = 0; k < 10; k++) {
        ctx.rotate(TAU / 10);
        ctx.beginPath();
        ctx.moveTo(0, -4.8);
        ctx.lineTo(k % 2 ? 0.7 : -0.6, -6.1);
        ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      ctx.rotate(-t * 1.3);
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU - Math.PI / 2;
        ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * 3.8, Math.sin(a) * 3.8);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      glow(ctx, 0, 0, 2.5, 'rgba(255,90,90,0.9)', 0.6 + pulse * 0.4);
    }
    ctx.restore();
  }

  function drawChest(ctx, t, open) {
    ctx.save();
    shadow(ctx, 6, 6.6);
    if (!open) glow(ctx, 0, 0, 10, 'rgba(255,214,100,0.5)', 0.5 + 0.3 * Math.sin(t * 4));
    roundRect(ctx, -6, -1.8, 12, 7.6, 1.2);
    ctx.fillStyle = linear(ctx, 0, -2, 0, 6, [
      [0, '#a8692c'],
      [1, '#5c3412'],
    ]);
    ctx.fill();
    if (open) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,220,120,0.5)';
      ctx.fillRect(-5, -2.2, 10, 1.6);
      ctx.restore();
      roundRect(ctx, -6.4, -7.6, 12.8, 3.2, 1.2);
    } else roundRect(ctx, -6.4, -5.6, 12.8, 4.6, 2);
    ctx.fillStyle = linear(ctx, 0, -6, 0, -1, [
      [0, '#c98a42'],
      [1, '#7a4719'],
    ]);
    ctx.fill();
    ctx.fillStyle = '#ffd35a';
    ctx.fillRect(-4.2, open ? -7.6 : -5.6, 1.2, open ? 3.2 : 11.4);
    ctx.fillRect(3, open ? -7.6 : -5.6, 1.2, open ? 3.2 : 11.4);
    if (!open) {
      roundRect(ctx, -1.3, -2.6, 2.6, 2.8, 0.5);
      ctx.fill();
      ctx.fillStyle = '#3a2208';
      ctx.fillRect(-0.3, -1.8, 0.6, 1.2);
    }
    ctx.restore();
  }

  function drawEgg(ctx, t) {
    ctx.save();
    ctx.rotate(Math.sin(t * 6) * 0.15);
    glow(ctx, 0, 0, 9, 'rgba(120,255,200,0.6)');
    ctx.beginPath();
    ctx.moveTo(0, -5.2);
    ctx.bezierCurveTo(3.6, -5.2, 4.4, 1, 3.6, 2.8);
    ctx.bezierCurveTo(2.6, 5.2, -2.6, 5.2, -3.6, 2.8);
    ctx.bezierCurveTo(-4.4, 1, -3.6, -5.2, 0, -5.2);
    ctx.fillStyle = radial(ctx, -1.2, -2, 6, [
      [0, '#ffffff'],
      [1, '#e9dcc0'],
    ]);
    ctx.fill();
    ctx.fillStyle = '#2fc9a0';
    for (const [x, y, r] of [
      [-1.4, -2, 0.8],
      [1.6, -0.6, 0.6],
      [-0.6, 1.6, 0.7],
      [1.8, 2.4, 0.5],
    ]) {
      circle(ctx, x, y, r);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTreat(ctx, t) {
    ctx.save();
    ctx.translate(0, Math.sin(t * 3.2) * 0.6);
    shadow(ctx, 4, 6.2);
    glow(ctx, 0, 0, 9, 'rgba(255,90,120,0.5)', 0.6);
    ctx.strokeStyle = '#c99b62';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(0.6, -7.6);
    ctx.stroke();
    circle(ctx, 0, 1, 4.4);
    ctx.fillStyle = radial(ctx, -1.6, -0.6, 6, [
      [0, '#ff8a9a'],
      [0.6, '#e0203f'],
      [1, '#7a0820'],
    ]);
    ctx.fill();
    ellipse(ctx, -1.6, -0.6, 1.2, 0.8, -0.6);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0.4, -3.4);
    ctx.quadraticCurveTo(3.6, -5.4, 4, -2.6);
    ctx.quadraticCurveTo(2, -2, 0.4, -3.4);
    ctx.fillStyle = '#5bd36a';
    ctx.fill();
    ctx.restore();
  }

  /* The roasted puff a burnt slime leaves behind. */
  function drawToast(ctx, t, kind) {
    ctx.save();
    shadow(ctx, 4.4, 5.6);
    for (let k = -1; k <= 1; k += 2) {
      ctx.beginPath();
      const y0 = -4 - ((t * 6 + k) % 3);
      ctx.moveTo(k * 1.6, y0);
      ctx.quadraticCurveTo(k * 1.6 + 1.2, y0 - 1.5, k * 1.6, y0 - 3);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    roundRect(ctx, -4.6, -2.4, 9.2, 6.6, 2.4);
    ctx.fillStyle = linear(ctx, 0, -2, 0, 4, [
      [0, '#fff4dc'],
      [1, '#e9c99a'],
    ]);
    ctx.fill();
    ellipse(ctx, 0, -2.2, 4.6, 2);
    ctx.fillStyle = kind === 'fury' ? '#b4471e' : '#c98a3e';
    ctx.fill();
    ctx.fillStyle = 'rgba(70,30,10,0.55)';
    circle(ctx, -1.6, -2.4, 0.7);
    ctx.fill();
    circle(ctx, 1.4, -1.8, 0.55);
    ctx.fill();
    ctx.restore();
  }

  function drawFireball(ctx, t, d) {
    ctx.save();
    ctx.rotate([-Math.PI / 2, 0, Math.PI / 2, Math.PI][d] || 0);
    glow(ctx, 0, 0, 11, 'rgba(255,140,40,0.9)');
    ctx.beginPath();
    ctx.moveTo(4.2, 0);
    ctx.quadraticCurveTo(1, -3.6, -6, 0);
    ctx.quadraticCurveTo(1, 3.6, 4.2, 0);
    ctx.fillStyle = 'rgba(255,120,30,0.95)';
    ctx.fill();
    ellipse(ctx, 1.4, 0, 2.6 + Math.sin(t * 40) * 0.3, 1.8);
    ctx.fillStyle = '#ffe680';
    ctx.fill();
    ellipse(ctx, 1.9, 0, 1.3, 0.9);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }

  function drawArrowTile(ctx, t, d, active) {
    ctx.save();
    ctx.rotate([-Math.PI / 2, 0, Math.PI / 2, Math.PI][d]);
    roundRect(ctx, -7, -7, 14, 14, 3);
    ctx.fillStyle = active ? 'rgba(90,209,255,0.22)' : 'rgba(90,209,255,0.10)';
    ctx.fill();
    ctx.strokeStyle = active ? 'rgba(160,235,255,0.9)' : 'rgba(90,209,255,0.45)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    for (let k = 0; k < 2; k++) {
      const x = ((t * 6 + k * 5) % 10) - 4.5;
      ctx.beginPath();
      ctx.moveTo(x - 2, -3.6);
      ctx.lineTo(x + 1.6, 0);
      ctx.lineTo(x - 2, 3.6);
      ctx.strokeStyle = `rgba(160,235,255,${active ? 0.95 : 0.6})`;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- the Devil ----------------------------------------------------------------

  function limb(ctx, x0, y0, a1, l1, a2, l2, w, color) {
    const x1 = x0 + Math.cos(a1) * l1;
    const y1 = y0 + Math.sin(a1) * l1;
    const x2 = x1 + Math.cos(a2) * l2;
    const y2 = y1 + Math.sin(a2) * l2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
    return [x2, y2, a2];
  }

  function hand(ctx, x, y, a, point, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    circle(ctx, 0, 0, 2.3);
    ctx.fillStyle = color;
    ctx.fill();
    if (point) {
      ctx.beginPath();
      ctx.moveTo(1.2, -0.6);
      ctx.lineTo(5, -0.3);
      ctx.lineTo(5.3, 0.2);
      ctx.lineTo(1.2, 0.8);
      ctx.fill();
      ctx.fillStyle = '#2a0a12';
      ctx.beginPath();
      ctx.moveTo(5, -0.3);
      ctx.lineTo(6.2, 0);
      ctx.lineTo(5.3, 0.2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#2a0a12';
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(2, k * 0.9 - 0.3);
        ctx.lineTo(3.2, k * 0.9);
        ctx.lineTo(2, k * 0.9 + 0.3);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /*
   * The Devil who stands above the maze. Origin = chest.
   * o: { t, mode: 'rest'|'warn'|'scroll'|'sleep', dir, laugh: 0..1, warn: 0..1 }
   */
  function drawDevil(ctx, o) {
    const t = o.t || 0;
    const mode = o.mode;
    const sleep = mode === 'sleep';
    const laugh = o.laugh || 0;
    const pointing = (mode === 'warn' || mode === 'scroll') && o.dir >= 0;
    const ext = mode === 'warn' ? Math.min(1, o.warn * 3) : 1;
    const skin = '#d4283c';
    const skinDark = '#7a0f22';
    const bounce = sleep ? Math.sin(t * 1.4) * 0.6 : laugh ? Math.abs(Math.sin(t * 22)) * -1.6 : Math.sin(t * 4.2) * 0.9;

    ctx.save();
    ctx.translate(0, bounce);

    // wings
    const flap = sleep ? 0.15 : 0.5 + 0.5 * Math.sin(t * (pointing ? 6 : 3));
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * 6, -4);
      ctx.scale(s, 1);
      ctx.rotate(-0.1 - flap * 0.3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(10, -14);
      ctx.lineTo(27, -11);
      ctx.quadraticCurveTo(23, -6, 24, -1);
      ctx.quadraticCurveTo(19, -3, 17, 2);
      ctx.quadraticCurveTo(12, -1, 10, 4);
      ctx.quadraticCurveTo(6, 1, 2, 6);
      ctx.closePath();
      ctx.fillStyle = linear(ctx, 0, -12, 20, 4, [
        [0, '#5a2a7a'],
        [1, '#24103a'],
      ]);
      ctx.fill();
      ctx.strokeStyle = '#1a0a28';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(10, -14);
      ctx.lineTo(24, -1);
      ctx.moveTo(10, -14);
      ctx.lineTo(17, 2);
      ctx.moveTo(10, -14);
      ctx.lineTo(10, 4);
      ctx.stroke();
      ctx.restore();
    }

    // tail
    ctx.beginPath();
    ctx.moveTo(4, 9);
    ctx.quadraticCurveTo(16, 14, 15 + Math.sin(t * 3) * 2, 2);
    ctx.strokeStyle = skinDark;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.save();
    ctx.translate(15 + Math.sin(t * 3) * 2, 2);
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(2.2, 0.6);
    ctx.lineTo(0, 0);
    ctx.lineTo(-2.2, 0.6);
    ctx.closePath();
    ctx.fillStyle = skinDark;
    ctx.fill();
    ctx.restore();

    // torso
    ctx.beginPath();
    ctx.moveTo(-10, -6);
    ctx.quadraticCurveTo(0, -9, 10, -6);
    ctx.quadraticCurveTo(9, 4, 6, 10);
    ctx.lineTo(-6, 10);
    ctx.quadraticCurveTo(-9, 4, -10, -6);
    ctx.fillStyle = radial(ctx, -3, -4, 16, [
      [0, '#ff5a63'],
      [1, skinDark],
    ]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,0,20,0.5)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(0, 7);
    ctx.moveTo(-4, 1);
    ctx.quadraticCurveTo(-2, 2, 0, 1);
    ctx.quadraticCurveTo(2, 2, 4, 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6.4, 8);
    ctx.lineTo(6.4, 8);
    ctx.lineTo(5, 13);
    ctx.lineTo(0, 11.5);
    ctx.lineTo(-5, 13);
    ctx.closePath();
    ctx.fillStyle = '#2a1036';
    ctx.fill();

    // arms
    const L = [-9.5, -4.5];
    const R = [9.5, -4.5];
    const W = 3.6;
    let la;
    let ra;
    if (sleep) {
      la = [0.3, 7, -0.2, 7];
      ra = [Math.PI - 0.3, 7, Math.PI + 0.2, 7];
    } else if (laugh) {
      const sh = Math.sin(t * 22) * 0.12;
      la = [Math.PI * 0.62 + sh, 7, Math.PI * 0.02, 7];
      ra = [Math.PI * 0.38 - sh, 7, Math.PI * 0.98, 7];
    } else if (pointing) {
      const hip = (s) => (s < 0 ? [Math.PI * 0.72, 6.5, Math.PI * 0.05, 6] : [Math.PI * 0.28, 6.5, Math.PI * 0.95, 6]);
      const lerpA = (a, b) => a + (b - a) * ext;
      const tremble = mode === 'scroll' ? Math.sin(t * 30) * 0.04 : 0;
      let target;
      let side;
      if (o.dir === 3) {
        side = -1;
        target = [Math.PI + tremble, 7.5, Math.PI + tremble, 7];
      } else if (o.dir === 1) {
        side = 1;
        target = [tremble, 7.5, tremble, 7];
      } else if (o.dir === 0) {
        side = 1;
        target = [-Math.PI / 2 + 0.25 + tremble, 7.5, -Math.PI / 2 + tremble, 7];
      } else {
        side = 1;
        target = [Math.PI / 2 - 0.5 + tremble, 7.5, Math.PI / 2 - 0.1 + tremble, 7];
      }
      const rest = side < 0 ? [Math.PI * 0.75, 7, Math.PI * 0.6, 7] : [Math.PI * 0.25, 7, Math.PI * 0.4, 7];
      const arm = [lerpA(rest[0], target[0]), 7.5, lerpA(rest[2], target[2]), 7];
      if (side < 0) {
        la = arm;
        ra = hip(1);
      } else {
        ra = arm;
        la = hip(-1);
      }
    } else {
      const sw = Math.sin(t * 4.2);
      la = [Math.PI * 0.8 - sw * 0.5, 7, Math.PI * 1.15 - sw * 0.6, 6.5];
      ra = [Math.PI * 0.2 - sw * 0.5, 7, -Math.PI * 0.15 - sw * 0.6, 6.5];
    }
    const lh = limb(ctx, L[0], L[1], la[0], la[1], la[2], la[3], W, skin);
    const rh = limb(ctx, R[0], R[1], ra[0], ra[1], ra[2], ra[3], W, skin);
    const lPoint = pointing && o.dir === 3;
    const rPoint = pointing && o.dir !== 3;
    hand(ctx, lh[0], lh[1], lh[2], lPoint, skin);
    hand(ctx, rh[0], rh[1], rh[2], rPoint, skin);

    // head
    ctx.save();
    ctx.translate(0, -15);
    if (laugh) ctx.rotate(Math.sin(t * 22) * 0.06);
    if (sleep) ctx.rotate(0.18);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 4.2, -6.5);
      ctx.bezierCurveTo(s * 9, -9, s * 13, -12, s * 11.5, -20);
      ctx.bezierCurveTo(s * 10.6, -14, s * 7, -11, s * 2.2, -8.4);
      ctx.closePath();
      ctx.fillStyle = linear(ctx, s * 3, -7, s * 12, -20, [
        [0, '#e8d6b0'],
        [1, '#fffaf0'],
      ]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,90,50,0.5)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(s * 6.6, -9.6);
      ctx.lineTo(s * 5.4, -7.8);
      ctx.moveTo(s * 9, -12.4);
      ctx.lineTo(s * 7.6, -10.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 7.2, -1.8);
      ctx.lineTo(s * 12.4, -5.6);
      ctx.lineTo(s * 7.6, 1.2);
      ctx.fillStyle = skinDark;
      ctx.fill();
    }
    ellipse(ctx, 0, -0.5, 8, 8.6);
    ctx.fillStyle = radial(ctx, -2.5, -3.5, 12, [
      [0, '#ff6670'],
      [1, skinDark],
    ]);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-2.2, 6.6);
    ctx.lineTo(0, 11);
    ctx.lineTo(2.2, 6.6);
    ctx.fillStyle = '#2a0a12';
    ctx.fill();
    // eyes
    if (sleep) {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 1.4, -1.6);
        ctx.quadraticCurveTo(s * 3.4, -0.4, s * 5.2, -1.6);
        ctx.strokeStyle = '#2a0a12';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    } else {
      const flash = mode === 'warn' ? 0.5 + 0.5 * Math.sin(t * 30) : 0;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 1.2, -1.2);
        ctx.quadraticCurveTo(s * 3.4, -3.6, s * 5.6, -1.8);
        ctx.quadraticCurveTo(s * 3.4, 0.2, s * 1.2, -1.2);
        ctx.fillStyle = flash ? '#ffffff' : '#ffd23a';
        ctx.fill();
        glow(ctx, s * 3.4, -1.6, 4.5, 'rgba(255,200,60,0.9)', 0.6 + flash * 0.4);
        let px = 0;
        let py = 0;
        if (pointing) {
          px = o.dir === 1 ? 0.8 : o.dir === 3 ? -0.8 : 0;
          py = o.dir === 2 ? 0.4 : o.dir === 0 ? -0.4 : 0;
        }
        ellipse(ctx, s * 3.4 + px, -1.6 + py, 0.45, 1.2);
        ctx.fillStyle = '#2a0a12';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(s * 0.8, -3.6);
        ctx.lineTo(s * 6, -4.6);
        ctx.lineTo(s * 5.6, -3.4);
        ctx.closePath();
        ctx.fillStyle = '#3a0812';
        ctx.fill();
      }
    }
    // mouth
    if (laugh) {
      ellipse(ctx, 0, 3.6, 4.2, 2.6 + Math.abs(Math.sin(t * 22)) * 0.8);
      ctx.fillStyle = '#2a0008';
      ctx.fill();
      ellipse(ctx, 0, 5, 2, 1);
      ctx.fillStyle = '#ff7a8a';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 3.2, 1.6);
        ctx.lineTo(s * 2.4, 3.4);
        ctx.lineTo(s * 1.6, 1.6);
        ctx.fill();
      }
    } else if (sleep) {
      ellipse(ctx, 0.4, 3.6, 1.2, 0.9);
      ctx.fillStyle = '#2a0008';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(-5, 2);
      ctx.quadraticCurveTo(0, 6.4, 5, 2);
      ctx.quadraticCurveTo(0, 4.2, -5, 2);
      ctx.fillStyle = '#2a0008';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 3.6, 2.6);
        ctx.lineTo(s * 3, 4.4);
        ctx.lineTo(s * 2.4, 3);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.restore();
  }

  // ---- frame furniture ------------------------------------------------------------

  function drawGear(ctx, r, teeth, angle, color, hole) {
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    const inner = r * 0.78;
    for (let k = 0; k < teeth; k++) {
      const a0 = (k / teeth) * TAU;
      const a1 = a0 + (TAU / teeth) * 0.25;
      const a2 = a0 + (TAU / teeth) * 0.5;
      const a3 = a0 + (TAU / teeth) * 0.75;
      ctx.lineTo(Math.cos(a0) * inner, Math.sin(a0) * inner);
      ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      ctx.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
      ctx.lineTo(Math.cos(a3) * inner, Math.sin(a3) * inner);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    circle(ctx, 0, 0, r * 0.45);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();
    circle(ctx, 0, 0, hole || r * 0.18);
    ctx.fillStyle = '#0b0712';
    ctx.fill();
    ctx.restore();
  }

  /* One of the Devil's imps turning a crank. angle = crank rotation. */
  function drawImp(ctx, t, angle, busy, flip) {
    ctx.save();
    if (flip) ctx.scale(-1, 1);
    const hx = 6 + Math.cos(angle) * 3.2;
    const hy = -1 + Math.sin(angle) * 3.2;
    ctx.save();
    ctx.translate(6, -1);
    drawGear(ctx, 4.6, 9, angle, '#8f7a52', 0.9);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(6, -1);
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = '#d9c38a';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    const bob = busy ? Math.sin(angle * 2) * 0.6 : Math.sin(t * 2) * 0.3;
    ctx.translate(-1, bob);
    ellipse(ctx, 0, 5.4, 4, 1.1);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 2.6, -2.6);
      ctx.lineTo(s * 5.6, -5.4);
      ctx.lineTo(s * 3.6, -0.8);
      ctx.fillStyle = '#4a2a6a';
      ctx.fill();
    }
    ellipse(ctx, 0, 0.6, 3.8, 4.4);
    ctx.fillStyle = radial(ctx, -1, -1.4, 5.5, [
      [0, '#7a54a8'],
      [1, '#2c1446'],
    ]);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 1.4, -3.2);
      ctx.lineTo(s * 2.2, -6);
      ctx.lineTo(s * 0.4, -3.6);
      ctx.fillStyle = '#e8d6b0';
      ctx.fill();
    }
    const look = busy ? 0.4 : Math.sin(t * 0.7) * 0.6;
    for (const s of [-1, 1]) {
      circle(ctx, s * 1.4 + look, -0.6, 0.8);
      ctx.fillStyle = '#ffe14a';
      ctx.fill();
      circle(ctx, s * 1.4 + look + 0.2, -0.6, 0.35);
      ctx.fillStyle = '#1a0a20';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(2.6, 0.8);
    ctx.lineTo(hx + 1, hy - bob);
    ctx.strokeStyle = '#5a3a80';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function drawChain(ctx, x0, y0, x1, y1, offset, color) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const step = 5;
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.rect(0, -3, len, 6);
    ctx.clip();
    const o = ((offset % (step * 2)) + step * 2) % (step * 2);
    for (let x = -step * 2 + o, k = 0; x < len + step; x += step, k++) {
      const vertical = (Math.floor((x - o) / step) & 1) === 0;
      if (vertical) ellipse(ctx, x, 0, 3, 1.6);
      else ellipse(ctx, x, 0, 3, 0.7);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawArrowBadge(ctx, d, lit, t) {
    roundRect(ctx, -7, -7, 14, 14, 3);
    ctx.fillStyle = lit ? 'rgba(255,80,60,0.25)' : 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = lit ? `rgba(255,170,120,${0.6 + 0.4 * Math.sin(t * 12)})` : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    if (d < 0) {
      circle(ctx, 0, 0, 1.6);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
      return;
    }
    ctx.save();
    ctx.rotate([-Math.PI / 2, 0, Math.PI / 2, Math.PI][d]);
    ctx.beginPath();
    ctx.moveTo(4.6, 0);
    ctx.lineTo(-0.6, -4.2);
    ctx.lineTo(-0.6, -1.6);
    ctx.lineTo(-4.4, -1.6);
    ctx.lineTo(-4.4, 1.6);
    ctx.lineTo(-0.6, 1.6);
    ctx.lineTo(-0.6, 4.2);
    ctx.closePath();
    ctx.fillStyle = lit ? '#ffb48a' : 'rgba(255,255,255,0.5)';
    ctx.fill();
    ctx.restore();
  }

  DM.art = {
    HEROES,
    MAZE_PALETTES,
    SLIMES,
    circle,
    ellipse,
    roundRect,
    radial,
    linear,
    glow,
    drawDragon,
    drawBubble,
    drawSlime,
    drawGargling,
    drawSpirit,
    drawCross,
    drawCrossMarker,
    drawBible,
    drawSeal,
    drawChest,
    drawEgg,
    drawTreat,
    drawToast,
    drawFireball,
    drawArrowTile,
    drawDevil,
    drawGear,
    drawImp,
    drawChain,
    drawArrowBadge,
  };
})(typeof window !== 'undefined' ? window : globalThis);
