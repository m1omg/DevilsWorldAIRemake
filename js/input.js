/*
 * Devil's Maze — input (keyboard, gamepads, touch).
 *
 * Input is sampled once per simulation tick. Fire presses are latched until
 * the next tick reads them, so a quick tap is never lost however the display
 * and simulation rates line up.
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});

  const DIR_KEYS = [
    { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 },
    { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 },
  ];
  const FIRE_KEYS = [
    ['Space', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyQ', 'KeyE'],
    ['Enter', 'NumpadEnter', 'Slash', 'Period', 'Comma', 'Numpad0', 'ShiftRight', 'ControlRight', 'KeyK', 'KeyL', 'KeyJ'],
  ];
  const GAME_KEYS = new Set([].concat(...DIR_KEYS.map(Object.keys), ...FIRE_KEYS));

  class Input {
    constructor() {
      this.twoPlayer = false;
      this.held = [[], []]; // per key-set: directions in press order
      this.fireLatch = [false, false];
      this.touchDir = -1;
      this.touchFire = false;
      this.padPrev = {};
      this.padFire = [false, false];
      this.padDir = [-1, -1];
      this.onPause = null;
      this.enabled = false;
      this.lastSet = 1;
    }

    attach(win) {
      win.addEventListener('keydown', (e) => this.keydown(e));
      win.addEventListener('keyup', (e) => this.keyup(e));
      win.addEventListener('blur', () => this.reset());
    }

    reset() {
      this.held = [[], []];
      this.fireLatch = [false, false];
      this.touchDir = -1;
      this.touchFire = false;
    }

    keydown(e) {
      if (!this.enabled) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (!e.repeat && this.onPause) this.onPause();
        e.preventDefault();
        e.stopImmediatePropagation(); // the menu that just opened must not see this key too
        return;
      }
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      for (let set = 0; set < 2; set++) {
        const d = DIR_KEYS[set][e.code];
        if (d !== undefined) {
          const h = this.held[set];
          const i = h.indexOf(d);
          if (i >= 0) h.splice(i, 1);
          h.push(d);
          this.lastSet = set; // in 1P mode the most recently used key set wins
        }
        if (!e.repeat && FIRE_KEYS[set].includes(e.code)) this.fireLatch[set] = true;
      }
    }

    keyup(e) {
      for (let set = 0; set < 2; set++) {
        const d = DIR_KEYS[set][e.code];
        if (d !== undefined) {
          const h = this.held[set];
          const i = h.indexOf(d);
          if (i >= 0) h.splice(i, 1);
        }
      }
    }

    pollPads(onPause) {
      let pads = [];
      try {
        pads = (root.navigator && navigator.getGamepads && navigator.getGamepads()) || [];
      } catch (e) {
        pads = []; // gamepads can be blocked when the page is embedded
      }
      const list = [];
      for (const p of pads) if (p && p.connected) list.push(p);
      this.padDir = [-1, -1];
      // In two-player mode a single pad goes to player 2, so keyboard + pad works.
      const owner = (k) => (!this.twoPlayer ? 0 : list.length === 1 ? 1 : Math.min(k, 1));
      list.forEach((p, k) => {
        const pl = owner(k);
        const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
        let d = -1;
        if (b(12)) d = 0;
        else if (b(15)) d = 1;
        else if (b(13)) d = 2;
        else if (b(14)) d = 3;
        else {
          const ax = p.axes[0] || 0;
          const ay = p.axes[1] || 0;
          if (Math.max(Math.abs(ax), Math.abs(ay)) > 0.5) d = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 1 : 3) : ay > 0 ? 2 : 0;
        }
        if (d >= 0) this.padDir[pl] = d;
        const prev = this.padPrev[p.index];
        const fire = b(0) || b(1) || b(2) || b(3);
        const start = b(9);
        this.padPrev[p.index] = { fire, start };
        if (!prev) return; // first look at this pad: buttons already held are not presses
        if (fire && !prev.fire) this.padFire[pl] = true;
        if (start && !prev.start && onPause) onPause();
      });
      return list.length;
    }

    // Returns [{dir, fire}] for each player and clears latched presses.
    sample(players) {
      const out = [];
      for (let i = 0; i < players; i++) {
        let dir = -1;
        let fire = false;
        if (players === 1) {
          const a = this.held[0];
          const b = this.held[1];
          // whichever key set was used most recently wins
          dir = b.length ? b[b.length - 1] : a.length ? a[a.length - 1] : -1;
          if (a.length && b.length) dir = this.lastSet === 0 ? a[a.length - 1] : b[b.length - 1];
          fire = this.fireLatch[0] || this.fireLatch[1];
        } else {
          const h = this.held[i];
          dir = h.length ? h[h.length - 1] : -1;
          fire = this.fireLatch[i];
        }
        if (i === 0 && this.touchDir >= 0) dir = this.touchDir;
        if (i === 0 && this.touchFire) fire = true;
        if (this.padDir[i] >= 0) dir = this.padDir[i];
        if (this.padFire[i]) fire = true;
        out.push({ dir, fire });
      }
      this.fireLatch = [false, false];
      this.touchFire = false;
      this.padFire = [false, false];
      return out;
    }

    // ---- touch controls ----

    bindTouch(pad, fireBtn, pauseBtn) {
      const dirFrom = (e) => {
        const r = pad.getBoundingClientRect();
        const x = e.clientX - (r.left + r.width / 2);
        const y = e.clientY - (r.top + r.height / 2);
        if (Math.hypot(x, y) < r.width * 0.12) return -1;
        return Math.abs(x) > Math.abs(y) ? (x > 0 ? 1 : 3) : y > 0 ? 2 : 0;
      };
      let active = null;
      const update = (e) => {
        this.touchDir = dirFrom(e);
        pad.dataset.dir = String(this.touchDir);
      };
      pad.addEventListener('pointerdown', (e) => {
        active = e.pointerId;
        try {
          pad.setPointerCapture(e.pointerId);
        } catch (err) {
          /* ignore */
        }
        update(e);
        e.preventDefault();
      });
      pad.addEventListener('pointermove', (e) => {
        if (e.pointerId === active) update(e);
      });
      const end = (e) => {
        if (e.pointerId !== active) return;
        active = null;
        this.touchDir = -1;
        pad.dataset.dir = '-1';
      };
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      fireBtn.addEventListener('pointerdown', (e) => {
        this.touchFire = true;
        fireBtn.classList.add('down');
        e.preventDefault();
      });
      const up = () => fireBtn.classList.remove('down');
      fireBtn.addEventListener('pointerup', up);
      fireBtn.addEventListener('pointercancel', up);
      fireBtn.addEventListener('pointerleave', up);
      pauseBtn.addEventListener('click', () => this.onPause && this.onPause());
    }
  }

  DM.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
