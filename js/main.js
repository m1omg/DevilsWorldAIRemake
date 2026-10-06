/*
 * Devil's Maze — application controller.
 *
 * Owns the current game, switches between the title attract mode, play,
 * pause and game over, and connects the menus to the save system.
 */
(function (root) {
  'use strict';
  const DM = root.DM;
  const $ = (s) => document.querySelector(s);

  const canvas = $('#game');
  const stage = $('#stage');
  const touchBox = $('#touch');
  const readyEl = $('#ready');
  const renderer = new DM.Renderer(canvas);
  const fx = new DM.FX();
  const sound = new DM.Sound();
  const input = new DM.Input();
  const settings = DM.Save.loadSettings();
  if (settings.fresh && root.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) settings.shake = false;

  let top = DM.Save.loadTop();
  let mode = 'title'; // title | play | ready | pause | gameover
  let state = null;
  let demo = null;
  let readyT = 0;
  let lastPlayers = 1;
  let slotMode = 'load';
  let slotModeBefore = 'load';
  let pending = null; // an imported save waiting for a slot
  let usedTouch = false;
  const events = [];

  const ui = new DM.UI({
    action: (a, data) => action(a, data),
    rootBack: (cur) => {
      if (cur === 'pause') resume();
      else if (cur === 'gameover') toTitle();
    },
    onNavigate: () => sound.play('menu'),
  });

  // ---- main loop ----------------------------------------------------------

  const loop = DM.createLoop({ hz: DM.C.TICK_HZ, tick: onTick, render: onRender });

  function onTick() {
    if (mode === 'title') return demoTick();
    if (mode === 'ready') {
      if (--readyT <= 0) setMode('play');
      return;
    }
    if (mode !== 'play') return;
    const inputs = input.sample(state.players);
    events.length = 0;
    DM.game.tick(state, inputs, events);
    const T = state.tick / 60;
    for (const e of events) fx.emit(e, state, T);
    fx.tick(state, T);
    sound.handle(events, state);
    if (state.top > top) top = state.top;
    for (const e of events) if (e.t === 'clear' || e.t === 'gameover' || e.t === 'out') DM.Save.saveTop(top);
    if (state.phase === 'gameover' && state.phaseT === 0) gameOver();
  }

  function demoTick() {
    events.length = 0;
    DM.game.tick(demo, [], events);
    const T = demo.tick / 60;
    for (const e of events) fx.emit(e, demo, T);
    fx.tick(demo, T);
  }

  function onRender(alpha) {
    const s = mode === 'title' ? demo : state;
    if (s) renderer.draw(s, alpha, fx, { demo: mode === 'title', top });
  }

  function frame(now) {
    if (mode === 'play' || mode === 'ready') input.pollPads(togglePause);
    else if (ui.isOpen()) menuPads();
    loop.frame(now, mode === 'play' || mode === 'ready' || mode === 'title');
    requestAnimationFrame(frame);
  }

  // Gamepad navigation in menus (edges only; a button held while a menu
  // opens is ignored until released).
  let padMenuPrev = {};
  function menuPads() {
    const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const ay = p.axes[1] || 0;
      const now = { up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, a: b(0), back: b(1), start: b(9) };
      const prev = padMenuPrev[p.index];
      padMenuPrev[p.index] = now;
      if (!prev) continue;
      if (now.up && !prev.up) ui.moveFocus(-1);
      if (now.down && !prev.down) ui.moveFocus(1);
      if (now.a && !prev.a) ui.activate();
      if (now.back && !prev.back) ui.back();
      if (now.start && !prev.start && mode === 'pause' && ui.current === 'pause') resume();
    }
  }

  // ---- modes ----------------------------------------------------------------

  function setMode(m) {
    mode = m;
    input.enabled = m === 'play' || m === 'ready';
    input.reset();
    padMenuPrev = {};
    input.padPrev = {};
    readyEl.classList.toggle('hidden', m !== 'ready');
    document.body.dataset.mode = m;
    layout();
  }

  function newGame(players) {
    lastPlayers = players;
    state = DM.game.newGame({ players, seed: (Math.random() * 4294967296) >>> 0, top });
    input.twoPlayer = players === 2;
    fx.clear();
    ui.hideAll();
    sound.unlock();
    sound.resume();
    sound.stopMusic();
    setMode('play');
  }

  function startLoaded(s) {
    state = s;
    if (state.top < top) state.top = top;
    lastPlayers = s.players;
    input.twoPlayer = s.players === 2;
    fx.clear();
    ui.hideAll();
    sound.resume();
    sound.stopMusic();
    if (s.phase === 'play') sound.music(s.scene === 'bonus' ? 'bonus' : 'maze');
    readyT = 80;
    setMode('ready');
  }

  function pause() {
    if (mode !== 'play' && mode !== 'ready') return;
    setMode('pause');
    sound.pause();
    ui.show('pause');
  }

  function resume() {
    if (mode !== 'pause') return;
    ui.hideAll();
    sound.resume();
    setMode('play');
  }

  function togglePause() {
    if (mode === 'play' || mode === 'ready') pause();
    else if (mode === 'pause' && ui.current === 'pause') resume();
  }

  function toTitle() {
    state = null;
    pending = null;
    demo = DM.game.newGame({ players: 1, seed: (Math.random() * 4294967296) >>> 0, top });
    fx.clear();
    sound.resume();
    sound.stopMusic();
    sound.music('title');
    setMode('title');
    ui.show('title');
  }

  function gameOver() {
    DM.Save.saveTop(top);
    setMode('gameover');
    ui.showGameOver(state, top);
  }

  // ---- menu actions -------------------------------------------------------------

  function action(a, data) {
    sound.unlock();
    if (a !== 'back') sound.play('select');
    switch (a) {
      case 'new1':
        return newGame(1);
      case 'new2':
        return newGame(2);
      case 'again':
        return newGame(lastPlayers);
      case 'title':
        return toTitle();
      case 'resume':
        return resume();
      case 'quit':
        return confirmQuit();
      case 'load':
        return openSlots('load');
      case 'save':
        return openSlots('save');
      case 'help':
        return ui.show('help', true);
      case 'credits':
        return ui.show('credits', true);
      case 'options':
        syncOptions();
        return ui.show('options', true);
      case 'import':
        return $('#importFile').click();
      case 'exportCurrent':
        return exportCurrent();
      case 'playImported':
        return playImported();
      case 'slotSave':
        return saveToSlot(+data.slot);
      case 'slotLoad':
        return loadFromSlot(+data.slot);
      case 'slotExport':
        return exportSlot(+data.slot);
      case 'slotDelete':
        return deleteSlot(+data.slot);
      case 'slotImport':
        return importToSlot(+data.slot);
      case 'back':
        if (ui.current !== 'slots' && ui.current !== 'confirm') {
          pending = null;
          slotMode = slotModeBefore;
        }
        return undefined;
      default:
        return undefined;
    }
  }

  async function confirmQuit() {
    if (await ui.confirm('Quit to the title screen? Progress since your last save will be lost.', 'Quit')) toTitle();
  }

  function openSlots(m) {
    slotMode = m;
    slotModeBefore = m;
    pending = null;
    refreshSlots();
    ui.show('slots', true);
  }

  function refreshSlots() {
    let label = '';
    if (pending) {
      const sm = pending.record.summary;
      label = `round ${sm.round}, ${sm.scene === 'dots' ? 'scene 1' : sm.scene === 'bibles' ? 'scene 2' : 'bonus'}, ${sm.players} player${sm.players > 1 ? 's' : ''}`;
    }
    ui.renderSlots(slotMode, DM.Save.list(), { storage: DM.Save.available(), importLabel: label });
  }

  function thumbnail() {
    try {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 160;
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.72);
    } catch (e) {
      return null;
    }
  }

  function occupied(slot) {
    const ent = DM.Save.list()[slot - 1];
    return !!(ent && (ent.record || ent.error));
  }

  async function saveToSlot(slot) {
    if (!state) return;
    if (occupied(slot) && !(await ui.confirm(`Overwrite the save in slot ${slot}?`, 'Overwrite'))) return;
    try {
      DM.Save.write(slot, state, thumbnail());
      ui.toast(`Game saved to slot ${slot}.`);
    } catch (e) {
      ui.toast(e.message, 'error');
    }
    refreshSlots();
  }

  async function loadFromSlot(slot) {
    if (state && mode === 'pause' && !(await ui.confirm(`Load slot ${slot}? Progress since your last save will be lost.`, 'Load'))) return;
    try {
      const s = DM.Save.load(slot);
      startLoaded(s);
      ui.toast(`Loaded slot ${slot}.`);
    } catch (e) {
      ui.toast(e.message, 'error');
      refreshSlots();
    }
  }

  function exportSlot(slot) {
    try {
      const name = DM.Save.exportSlot(slot);
      ui.toast(`Exported to ${name}`);
    } catch (e) {
      ui.toast(e.message, 'error');
    }
  }

  function exportCurrent() {
    if (!state) return;
    try {
      const name = DM.Save.exportRecord(DM.Save.makeRecord(state, thumbnail()), 0);
      ui.toast(`Exported to ${name}`);
    } catch (e) {
      ui.toast(e.message, 'error');
    }
  }

  async function deleteSlot(slot) {
    if (!(await ui.confirm(`Delete the save in slot ${slot}? This cannot be undone.`, 'Delete'))) return;
    DM.Save.remove(slot);
    refreshSlots();
    ui.toast(`Slot ${slot} cleared.`);
  }

  async function importToSlot(slot) {
    if (!pending) return;
    if (occupied(slot) && !(await ui.confirm(`Replace the save in slot ${slot} with the imported one?`, 'Replace'))) return;
    try {
      DM.Save.putRecord(slot, pending.record);
      pending = null;
      slotMode = slotModeBefore;
      ui.toast(`Imported into slot ${slot}.`);
    } catch (e) {
      ui.toast(e.message, 'error');
    }
    refreshSlots();
  }

  async function playImported() {
    if (!pending) return;
    if (state && mode === 'pause' && !(await ui.confirm('Play the imported save now? Progress since your last save will be lost.', 'Play'))) return;
    const s = pending.state;
    pending = null;
    slotMode = slotModeBefore;
    startLoaded(s);
  }

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      pending = await DM.Save.readFile(file);
      slotMode = 'import';
      refreshSlots();
      if (ui.current !== 'slots') ui.show('slots', true);
      ui.toast('Save file checked and ready.');
    } catch (err) {
      ui.toast(err.message, 'error');
    }
  });

  // ---- options and layout -------------------------------------------------------

  function applySettings() {
    sound.setVolumes(settings.music, settings.sfx);
    fx.shakeOn = settings.shake;
    renderer.setLowFx(settings.quality === 'low');
    layout();
  }

  const syncOptions = ui.bindOptions(settings, () => {
    applySettings();
    DM.Save.saveSettings(settings);
  });

  function touchWanted() {
    if (settings.touch === 'off') return false;
    if (settings.touch === 'on') return true;
    return usedTouch || !!(root.matchMedia && matchMedia('(pointer: coarse)').matches);
  }

  function layout() {
    const W = root.innerWidth;
    const H = root.innerHeight;
    const showTouch = touchWanted() && (mode === 'play' || mode === 'ready' || mode === 'pause');
    touchBox.classList.toggle('hidden', !showTouch);
    let inset = [8, 8, 8, 8];
    if (showTouch) {
      if (H >= W) inset = [8, 8, Math.min(300, Math.round(H * 0.36)), 8];
      else {
        const side = Math.min(200, Math.round(W * 0.2));
        inset = [6, side, 6, side];
      }
    }
    stage.style.inset = inset.map((v) => v + 'px').join(' ');
    renderer.resize(Math.max(50, W - inset[1] - inset[3]), Math.max(50, H - inset[0] - inset[2]));
  }

  // ---- wiring ------------------------------------------------------------------

  input.attach(root);
  input.onPause = togglePause;
  input.bindTouch($('#dpad'), $('#btnFire'), $('#btnPause'));

  root.addEventListener('keydown', (e) => {
    sound.unlock();
    if (!ui.isOpen() || ui.overlay.contains(document.activeElement)) {
      if (mode === 'pause' && e.code === 'KeyP' && ui.current === 'pause') resume();
      return;
    }
    if (e.code === 'Escape') {
      ui.back();
      e.preventDefault();
    } else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      ui.moveFocus(e.code === 'ArrowDown' ? 1 : -1);
      e.preventDefault();
    } else if (e.code === 'KeyP' && mode === 'pause' && ui.current === 'pause') resume();
  });
  root.addEventListener(
    'pointerdown',
    (e) => {
      sound.unlock();
      if (e.pointerType === 'touch' && !usedTouch) {
        usedTouch = true;
        layout();
      }
    },
    { passive: true }
  );
  root.addEventListener('resize', layout);
  root.addEventListener('orientationchange', layout);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (mode === 'play' || mode === 'ready')) pause();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  touchBox.addEventListener('contextmenu', (e) => e.preventDefault());

  applySettings();
  toTitle();
  requestAnimationFrame(frame);

  // Handy for debugging from the console (start() takes a state object and
  // runs it through the same validation as a loaded save).
  root.devilsMaze = {
    get state() {
      return state;
    },
    get mode() {
      return mode;
    },
    start(s) {
      startLoaded(DM.game.restore(JSON.parse(JSON.stringify(s))));
    },
    renderer,
    sound,
  };
})(typeof window !== 'undefined' ? window : globalThis);
