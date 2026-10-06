/*
 * Devil's Maze — save slots, export and import.
 *
 * A save is a complete snapshot of the game (maze, dots, enemies, timers,
 * random seed...), so loading resumes exactly where you left off. Slots live
 * in the browser's localStorage; Export writes a slot to a .json file and
 * Import reads one back (checked with a checksum and fully re-validated).
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});

  const FORMAT = 'devils-maze-save';
  const SLOTS = 3;
  const PREFIX = 'devils-maze.slot.';
  const SETTINGS_KEY = 'devils-maze.settings';
  const TOP_KEY = 'devils-maze.top';
  const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
  const THUMB_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

  const DEFAULT_SETTINGS = { music: 0.45, sfx: 0.7, shake: true, quality: 'high', touch: 'auto' };

  function store() {
    try {
      const ls = root.localStorage;
      const k = '__devils_maze_probe__';
      ls.setItem(k, '1');
      ls.removeItem(k);
      return ls;
    } catch (e) {
      return null;
    }
  }

  function available() {
    return !!store();
  }

  function makeRecord(state, thumb, savedAt) {
    const data = DM.game.serialize(state);
    return {
      format: FORMAT,
      version: DM.C.VERSION,
      savedAt: savedAt || new Date().toISOString(),
      summary: DM.game.summary(state),
      checksum: DM.util.fnv1a(JSON.stringify(data)),
      thumb: typeof thumb === 'string' && THUMB_RE.test(thumb) && thumb.length < 400000 ? thumb : null,
      state: data,
    };
  }

  // Parse and verify a save record from text. Returns { record, state }.
  function parseRecord(text) {
    let rec;
    try {
      rec = JSON.parse(text);
    } catch (e) {
      throw new Error('That file is not a Devil’s Maze save (it is not valid JSON).');
    }
    if (!rec || typeof rec !== 'object' || rec.format !== FORMAT) throw new Error('That file is not a Devil’s Maze save.');
    if (rec.version !== DM.C.VERSION) throw new Error('That save comes from a different version of the game (' + String(rec.version).slice(0, 12) + ').');
    if (!rec.state || typeof rec.state !== 'object') throw new Error('That save file has no game data.');
    if (DM.util.fnv1a(JSON.stringify(rec.state)) !== rec.checksum) throw new Error('That save file is damaged or was edited (checksum mismatch).');
    const state = DM.game.restore(rec.state);
    const when = typeof rec.savedAt === 'string' && !isNaN(Date.parse(rec.savedAt)) ? new Date(rec.savedAt).toISOString() : undefined;
    return { record: makeRecord(state, rec.thumb, when), state };
  }

  function slotKey(slot) {
    return PREFIX + slot;
  }

  // [{ slot, record } | { slot, record: null, error }]
  function list() {
    const ls = store();
    const out = [];
    for (let slot = 1; slot <= SLOTS; slot++) {
      if (!ls) {
        out.push({ slot, record: null });
        continue;
      }
      let text = null;
      try {
        text = ls.getItem(slotKey(slot));
      } catch (e) {
        text = null;
      }
      if (!text) {
        out.push({ slot, record: null });
        continue;
      }
      try {
        out.push({ slot, record: parseRecord(text).record });
      } catch (e) {
        out.push({ slot, record: null, error: e.message });
      }
    }
    return out;
  }

  function putRecord(slot, record) {
    const ls = store();
    if (!ls) throw new Error('Browser storage is not available here — use Export to keep your game in a file.');
    const text = JSON.stringify(record);
    try {
      ls.setItem(slotKey(slot), text);
    } catch (e) {
      // Quota trouble: retry without the screenshot before giving up.
      try {
        ls.setItem(slotKey(slot), JSON.stringify(Object.assign({}, record, { thumb: null })));
      } catch (e2) {
        throw new Error('The browser refused to store the save (storage full or blocked). Export it to a file instead.');
      }
    }
    return record;
  }

  function write(slot, state, thumb) {
    return putRecord(slot, makeRecord(state, thumb));
  }

  function load(slot) {
    const ls = store();
    if (!ls) throw new Error('Browser storage is not available here.');
    const text = ls.getItem(slotKey(slot));
    if (!text) throw new Error('Slot ' + slot + ' is empty.');
    return parseRecord(text).state;
  }

  function readRecord(slot) {
    const ls = store();
    const text = ls && ls.getItem(slotKey(slot));
    return text ? parseRecord(text).record : null;
  }

  function remove(slot) {
    const ls = store();
    if (ls) ls.removeItem(slotKey(slot));
  }

  function filenameFor(record, slot) {
    const sm = record.summary || {};
    const scene = sm.scene === 'dots' ? 'scene1' : sm.scene === 'bibles' ? 'scene2' : 'bonus';
    const day = (record.savedAt || new Date().toISOString()).slice(0, 10);
    const r = String(sm.round || 1).padStart(2, '0');
    return `devils-maze_${slot ? 'slot' + slot + '_' : ''}round${r}-${scene}_${day}.json`;
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
  }

  function exportRecord(record, slot) {
    const name = filenameFor(record, slot);
    download(name, JSON.stringify(record, null, 1));
    return name;
  }

  function exportSlot(slot) {
    const rec = readRecord(slot);
    if (!rec) throw new Error('Slot ' + slot + ' is empty.');
    return exportRecord(rec, slot);
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file chosen.'));
      if (file.size > MAX_IMPORT_BYTES) return reject(new Error('That file is too large to be a save.'));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('The file could not be read.'));
      fr.onload = () => {
        try {
          resolve(parseRecord(String(fr.result)));
        } catch (e) {
          reject(e);
        }
      };
      fr.readAsText(file);
    });
  }

  function loadSettings() {
    const ls = store();
    let raw = null;
    try {
      raw = ls && JSON.parse(ls.getItem(SETTINGS_KEY) || 'null');
    } catch (e) {
      raw = null;
    }
    const s = Object.assign({}, DEFAULT_SETTINGS);
    s.fresh = !raw; // nothing stored yet (lets the game respect reduced-motion preferences)
    if (raw && typeof raw === 'object') {
      if (typeof raw.music === 'number' && raw.music >= 0 && raw.music <= 1) s.music = raw.music;
      if (typeof raw.sfx === 'number' && raw.sfx >= 0 && raw.sfx <= 1) s.sfx = raw.sfx;
      if (typeof raw.shake === 'boolean') s.shake = raw.shake;
      if (raw.quality === 'high' || raw.quality === 'low') s.quality = raw.quality;
      if (['auto', 'on', 'off'].includes(raw.touch)) s.touch = raw.touch;
    }
    return s;
  }

  function saveSettings(s) {
    const ls = store();
    const keep = { music: s.music, sfx: s.sfx, shake: s.shake, quality: s.quality, touch: s.touch };
    try {
      if (ls) ls.setItem(SETTINGS_KEY, JSON.stringify(keep));
    } catch (e) {
      /* settings are a convenience; ignore */
    }
  }

  function loadTop() {
    const ls = store();
    try {
      const n = ls ? Number(ls.getItem(TOP_KEY) || 0) : 0;
      return isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    } catch (e) {
      return 0;
    }
  }

  function saveTop(n) {
    const ls = store();
    try {
      if (ls) ls.setItem(TOP_KEY, String(Math.floor(n)));
    } catch (e) {
      /* ignore */
    }
  }

  DM.Save = {
    FORMAT,
    SLOTS,
    available,
    makeRecord,
    parseRecord,
    list,
    write,
    putRecord,
    load,
    readRecord,
    remove,
    exportSlot,
    exportRecord,
    filenameFor,
    readFile,
    loadSettings,
    saveSettings,
    loadTop,
    saveTop,
  };
})(typeof window !== 'undefined' ? window : globalThis);
