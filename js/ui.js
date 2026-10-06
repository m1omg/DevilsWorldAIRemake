/*
 * Devil's Maze — menus and overlays (plain DOM).
 *
 * Screens are <section class="screen"> elements in index.html. A small stack
 * gives every sub-menu a working Back button / Escape key; keyboard arrows and
 * gamepads move focus between buttons. Text from save files is only ever set
 * through textContent.
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});
  const $ = (sel, el) => (el || document).querySelector(sel);

  const SCENE_NAMES = { dots: 'Scene 1', bibles: 'Scene 2', bonus: 'Bonus' };

  class UI {
    constructor(handlers) {
      this.h = handlers;
      this.stack = [];
      this.overlay = $('#overlay');
      this.toastEl = $('#toast');
      this.toastTimer = null;
      this.confirmResolve = null;

      this.overlay.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || b.disabled) return;
        if (b.id === 'confirmYes') return this.finishConfirm(true);
        if (b.id === 'confirmNo') return this.finishConfirm(false);
        if (b.hasAttribute('data-back')) return this.back();
        if (b.dataset.action) this.h.action(b.dataset.action, b.dataset);
      });
      this.overlay.addEventListener('keydown', (e) => {
        if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
          if (this.isFormField(e.target) && e.code === 'ArrowRight') return;
          this.moveFocus(1);
          e.preventDefault();
        } else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
          if (this.isFormField(e.target) && e.code === 'ArrowLeft') return;
          this.moveFocus(-1);
          e.preventDefault();
        } else if (e.code === 'Escape') {
          this.back();
          e.preventDefault();
          e.stopPropagation();
        }
      });
    }

    isFormField(el) {
      return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT');
    }

    get current() {
      return this.stack[this.stack.length - 1] || null;
    }

    isOpen() {
      return this.stack.length > 0;
    }

    // Show a screen. push=false replaces the whole stack (a new root screen).
    show(id, push) {
      if (push) this.stack.push(id);
      else this.stack = [id];
      this.render();
    }

    render() {
      const cur = this.current;
      for (const sec of this.overlay.querySelectorAll('.screen')) sec.classList.toggle('active', sec.id === 'scr-' + cur);
      this.overlay.classList.toggle('open', !!cur);
      this.overlay.classList.toggle('dim', !!cur && cur !== 'title');
      if (cur) setTimeout(() => this.focusFirst(), 0);
    }

    hideAll() {
      this.stack = [];
      this.render();
    }

    back() {
      if (this.current === 'confirm') return this.finishConfirm(false);
      if (this.stack.length > 1) {
        this.stack.pop();
        this.render();
        this.h.action('back', {});
      } else if (this.h.rootBack) this.h.rootBack(this.current);
    }

    focusables() {
      const sec = this.current && $('#scr-' + this.current);
      if (!sec) return [];
      return Array.from(sec.querySelectorAll('button, input, select')).filter((b) => !b.disabled && b.offsetParent !== null && !b.hidden);
    }

    focusFirst() {
      const list = this.focusables();
      if (list.length && !list.includes(document.activeElement)) list[0].focus();
    }

    moveFocus(delta) {
      const list = this.focusables();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      const n = i < 0 ? 0 : (i + delta + list.length) % list.length;
      list[n].focus();
      if (this.h.onNavigate) this.h.onNavigate();
    }

    activate() {
      const el = document.activeElement;
      if (el && this.overlay.contains(el) && el.tagName === 'BUTTON') el.click();
    }

    confirm(text, yesLabel) {
      $('#confirmText').textContent = text;
      $('#confirmYes').textContent = yesLabel || 'Yes';
      this.stack.push('confirm');
      this.render();
      return new Promise((resolve) => {
        this.confirmResolve = resolve;
      });
    }

    finishConfirm(ok) {
      if (this.current === 'confirm') {
        this.stack.pop();
        this.render();
      }
      const r = this.confirmResolve;
      this.confirmResolve = null;
      if (r) r(ok);
    }

    toast(msg, kind) {
      const t = this.toastEl;
      t.textContent = msg;
      t.className = 'toast show ' + (kind || 'ok');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => (t.className = 'toast'), kind === 'error' ? 5200 : 3200);
    }

    // ---- save slots ----

    describe(rec) {
      const sm = rec.summary || {};
      const line1 = `Round ${sm.round} · ${SCENE_NAMES[sm.scene] || ''} · ${sm.maze || ''}`;
      let line2;
      if (sm.players === 2) line2 = `2P · Scores ${(sm.scores || []).join(' / ')} · Lives ${(sm.lives || []).join(' / ')}`;
      else line2 = `1P · Score ${(sm.scores || [0])[0]} · Lives ${(sm.lives || [0])[0]}`;
      let when = '';
      try {
        when = new Date(rec.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      } catch (e) {
        when = rec.savedAt || '';
      }
      return [line1, line2, when];
    }

    renderSlots(mode, entries, opts) {
      const o = opts || {};
      const titles = { save: 'Save Game', load: 'Load Game', import: 'Import Save' };
      $('#slotsTitle').textContent = titles[mode];
      let sub =
        mode === 'save'
          ? 'Choose a slot. A save keeps everything, even mid-scene, so you resume exactly here.'
          : mode === 'load'
            ? 'Pick a save to continue. Export copies a slot to a file you can keep or share.'
            : 'File checked: ' + (o.importLabel || '') + '. Choose a slot to keep it in, or play it now.';
      if (!o.storage) sub += ' Browser storage is unavailable here, so slots cannot be used — export and import files instead.';
      $('#slotsSub').textContent = sub;
      $('#btnExportCurrent').hidden = mode !== 'save' || o.canExport === false;
      $('#btnPlayImported').hidden = mode !== 'import';

      const list = $('#slotList');
      list.textContent = '';
      for (const ent of entries) {
        const card = document.createElement('div');
        card.className = 'slot' + (ent.record ? '' : ' empty');
        const thumb = document.createElement('div');
        thumb.className = 'thumb';
        if (ent.record && ent.record.thumb) {
          const img = document.createElement('img');
          img.alt = '';
          img.src = ent.record.thumb;
          thumb.appendChild(img);
        } else thumb.textContent = ent.record ? '—' : 'EMPTY';
        const info = document.createElement('div');
        info.className = 'info';
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = 'Slot ' + ent.slot;
        info.appendChild(name);
        const lines = ent.record ? this.describe(ent.record) : [ent.error ? 'Unreadable save: ' + ent.error : 'Empty slot'];
        for (const ln of lines) {
          const m = document.createElement('div');
          m.className = 'meta';
          m.textContent = ln;
          info.appendChild(m);
        }
        const actions = document.createElement('div');
        actions.className = 'actions';
        const btn = (label, action, disabled, cls) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          b.dataset.action = action;
          b.dataset.slot = String(ent.slot);
          b.disabled = !!disabled;
          if (cls) b.className = cls;
          actions.appendChild(b);
        };
        const has = !!ent.record;
        const broken = !!ent.error;
        if (mode === 'save') btn('Save here', 'slotSave', !o.storage, 'primary');
        if (mode === 'load') btn('Load', 'slotLoad', !has, 'primary');
        if (mode === 'import') btn('Put it here', 'slotImport', !o.storage, 'primary');
        if (mode !== 'import') {
          if (o.canExport !== false) btn('Export', 'slotExport', !has);
          btn('Delete', 'slotDelete', !has && !broken, 'danger');
        }
        card.append(thumb, info, actions);
        list.appendChild(card);
      }
    }

    // ---- options ----

    bindOptions(settings, onChange) {
      const music = $('#optMusic');
      const sfx = $('#optSfx');
      const shake = $('#optShake');
      const quality = $('#optQuality');
      const touch = $('#optTouch');
      const sync = () => {
        music.value = Math.round(settings.music * 100);
        sfx.value = Math.round(settings.sfx * 100);
        shake.checked = settings.shake;
        quality.value = settings.quality;
        touch.value = settings.touch;
      };
      sync();
      const update = () => {
        settings.music = Number(music.value) / 100;
        settings.sfx = Number(sfx.value) / 100;
        settings.shake = shake.checked;
        settings.quality = quality.value === 'low' ? 'low' : 'high';
        settings.touch = ['auto', 'on', 'off'].includes(touch.value) ? touch.value : 'auto';
        onChange(settings);
      };
      for (const el of [music, sfx, shake, quality, touch]) {
        el.addEventListener('input', update);
        el.addEventListener('change', update);
      }
      return sync;
    }

    showGameOver(s, top) {
      const box = $('#goScores');
      box.textContent = '';
      s.pl.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'score-row p' + (i + 1);
        row.textContent = `${DM.art.HEROES[i].name} (${i ? '2UP' : '1UP'}): ${p.score}`;
        box.appendChild(row);
      });
      const r = document.createElement('div');
      r.className = 'score-row top';
      r.textContent = `Reached round ${s.round} · Top score ${top}`;
      box.appendChild(r);
      this.show('gameover');
    }
  }

  DM.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
