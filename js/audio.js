/*
 * Devil's Maze — procedural sound.
 *
 * Every effect is synthesised with WebAudio oscillators and filtered noise, and
 * the music is a tiny step sequencer playing original tunes written for this
 * remake (no audio from the original game). Notes are scheduled on the audio
 * clock, so timing does not depend on the display or frame rate.
 */
(function (root) {
  'use strict';
  const DM = (root.DM = root.DM || {});

  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  function midi(name) {
    const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
    return 12 * (+m[2] + 1) + NOTE[m[1]];
  }
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // "D5:2 A4:2 -:4" -> [[midi|null, steps], ...]; steps are 16th notes.
  function seq(str) {
    return str
      .trim()
      .split(/\s+/)
      .map((tok) => {
        const [n, d] = tok.split(':');
        return [n === '-' ? null : midi(n), +(d || 1)];
      });
  }
  // One bar per chord root: eighth-note bass "R R' 5 R'".
  function bassLine(roots) {
    return roots
      .map((r) => {
        const m = midi(r);
        return [
          [m, 2],
          [m + 12, 2],
          [m + 7, 2],
          [m + 12, 2],
          [m, 2],
          [m + 12, 2],
          [m + 7, 2],
          [m + 10, 2],
        ];
      })
      .flat();
  }
  function arpLine(chords) {
    return chords
      .map((ch) => {
        const ns = ch.split(' ').map(midi);
        const out = [];
        for (let k = 0; k < 16; k++) out.push([ns[k % ns.length], 1]);
        return out;
      })
      .flat();
  }

  // Original compositions for this remake.
  const TRACKS = {
    maze: {
      bpm: 132,
      lead: seq(
        'D5:2 A4:2 F4:2 A4:2 D5:2 E5:2 F5:4 ' +
          'E5:2 D5:2 C5:2 A4:2 Bb4:4 A4:4 ' +
          'G4:2 Bb4:2 D5:2 Bb4:2 C5:2 D5:2 E5:4 ' +
          'F5:2 E5:2 D5:2 C#5:2 D5:6 -:2 ' +
          'A5:2 F5:2 D5:2 F5:2 A5:2 G5:2 F5:4 ' +
          'G5:2 F5:2 E5:2 D5:2 C#5:4 A4:4 ' +
          'Bb4:2 D5:2 G5:2 F5:2 E5:2 D5:2 C#5:2 E5:2 ' +
          'D5:4 A4:2 F4:2 D4:4 -:4'
      ),
      bass: bassLine(['D2', 'C2', 'G1', 'A1', 'D2', 'A1', 'G1', 'D2']),
      arp: arpLine(['D4 F4 A4', 'C4 E4 G4', 'G3 Bb3 D4', 'A3 C#4 E4', 'D4 F4 A4', 'A3 C#4 E4', 'G3 Bb3 D4', 'D4 F4 A4']),
      drums: 'k-h-s-h-k-h-s-hh',
    },
    bonus: {
      bpm: 152,
      lead: seq(
        'F5:2 A5:2 C6:2 A5:2 G5:2 A5:2 F5:4 ' +
          'E5:2 G5:2 C6:2 G5:2 F5:2 E5:2 D5:4 ' +
          'D5:2 F5:2 Bb5:2 A5:2 G5:2 F5:2 E5:2 G5:2 ' +
          'F5:4 C5:2 A4:2 F4:4 -:4'
      ),
      bass: bassLine(['F2', 'C2', 'Bb1', 'C2']),
      arp: arpLine(['F4 A4 C5', 'C4 E4 G4', 'Bb3 D4 F4', 'C4 E4 G4']),
      drums: 'k-hhs-hhk-hhs-hs',
    },
    title: {
      bpm: 84,
      lead: seq('A4:4 D5:4 F5:4 E5:4 D5:8 C5:4 A4:4 Bb4:4 D5:4 G5:4 F5:4 E5:8 C#5:8'),
      bass: seq('D2:16 C2:16 G1:16 A1:16'),
      arp: arpLine(['D4 A4 F4 A4', 'C4 G4 E4 G4', 'G3 D4 Bb3 D4', 'A3 E4 C#4 E4']),
      drums: '',
      soft: true,
    },
  };

  const JINGLES = {
    start: { bpm: 168, notes: seq('D5:1 F5:1 A5:1 D6:1 -:1 A5:1 D6:4') },
    clear: { bpm: 150, notes: seq('C5:1 E5:1 G5:1 C6:2 G5:1 E6:1 C6:4') },
    gameover: { bpm: 90, notes: seq('A4:4 F4:4 D4:4 C#4:4 D4:8') },
    egg: { bpm: 180, notes: seq('G5:1 B5:1 D6:1 G6:2 F#6:1 G6:3') },
    seal: { bpm: 150, notes: seq('D5:1 A5:1 D6:3') },
  };

  class Sound {
    constructor() {
      this.ac = null;
      this.vol = { music: 0.45, sfx: 0.7 };
      this.track = null;
      this.timer = null;
      this.dotFlip = false;
      this.lastPowerBeep = 0;
      this.paused = false;
    }

    // Must be called from a user gesture (browser autoplay rules).
    unlock() {
      if (this.ac) {
        if (this.ac.state === 'suspended' && !this.paused) this.ac.resume().catch(() => {});
        return;
      }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      try {
        this.ac = new AC();
      } catch (e) {
        this.ac = null;
        return;
      }
      const ac = this.ac;
      this.master = ac.createGain();
      this.master.gain.value = 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(ac.destination);
      this.musicGain = ac.createGain();
      this.sfxGain = ac.createGain();
      this.musicGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.setVolumes(this.vol.music, this.vol.sfx);
      // shared noise buffer
      const len = ac.sampleRate;
      this.noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.pulse = {};
      for (const duty of [0.125, 0.25]) {
        const n = 32;
        const re = new Float32Array(n);
        const im = new Float32Array(n);
        for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
        this.pulse[duty] = ac.createPeriodicWave(re, im);
      }
      if (this.pendingTrack) {
        const t = this.pendingTrack;
        this.pendingTrack = null;
        this.music(t);
      }
    }

    setVolumes(music, sfx) {
      this.vol.music = music;
      this.vol.sfx = sfx;
      if (!this.ac) return;
      const now = this.ac.currentTime;
      this.musicGain.gain.setTargetAtTime(music * 0.55, now, 0.02);
      this.sfxGain.gain.setTargetAtTime(sfx, now, 0.02);
    }

    pause() {
      this.paused = true;
      if (this.ac && this.ac.state === 'running') this.ac.suspend().catch(() => {});
    }
    resume() {
      this.paused = false;
      if (this.ac && this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    }

    // ---- primitives ----

    osc(type, f0, f1, dur, vol, when, out, opts) {
      const ac = this.ac;
      const o = opts || {};
      const t0 = Math.max(ac.currentTime, when || ac.currentTime);
      const osc = ac.createOscillator();
      if (type === 'pulse25' || type === 'pulse12') osc.setPeriodicWave(this.pulse[type === 'pulse25' ? 0.25 : 0.125]);
      else osc.type = type;
      osc.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      if (o.vibrato) {
        const lfo = ac.createOscillator();
        const lg = ac.createGain();
        lfo.frequency.value = o.vibrato;
        lg.gain.value = f0 * 0.04;
        lfo.connect(lg);
        lg.connect(osc.frequency);
        lfo.start(t0);
        lfo.stop(t0 + dur + 0.05);
      }
      const g = ac.createGain();
      const att = o.attack || 0.004;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + att);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let node = osc;
      if (o.lowpass) {
        const f = ac.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = o.lowpass;
        osc.connect(f);
        node = f;
      }
      node.connect(g);
      g.connect(out || this.sfxGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    noise(dur, vol, type, f0, f1, when, q) {
      const ac = this.ac;
      const t0 = Math.max(ac.currentTime, when || ac.currentTime);
      const src = ac.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = type || 'lowpass';
      f.Q.value = q || 0.8;
      f.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.sfxGain);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + dur + 0.02);
    }

    jingle(name, out) {
      const j = JINGLES[name];
      if (!j || !this.ac) return;
      const step = 60 / j.bpm / 4;
      let t = this.ac.currentTime + 0.02;
      for (const [m, d] of j.notes) {
        if (m !== null) {
          this.osc('pulse25', hz(m), 0, d * step * 0.95, 0.16, t, out);
          this.osc('triangle', hz(m - 12), 0, d * step * 0.9, 0.12, t, out);
        }
        t += d * step;
      }
    }

    // ---- effects ----

    play(name) {
      if (!this.ac || this.paused) return;
      const now = this.ac.currentTime;
      switch (name) {
        case 'dot': {
          this.dotFlip = !this.dotFlip;
          const f = this.dotFlip ? 784 : 988;
          this.osc('pulse25', f, f * 1.25, 0.06, 0.09);
          break;
        }
        case 'fire':
          this.noise(0.28, 0.32, 'bandpass', 2600, 450, now, 1.1);
          this.osc('sine', 240, 70, 0.22, 0.28);
          break;
        case 'fizzle':
          this.noise(0.14, 0.12, 'lowpass', 900, 250);
          break;
        case 'fireEnd':
          this.noise(0.12, 0.1, 'lowpass', 1500, 300);
          break;
        case 'burn':
          this.noise(0.4, 0.28, 'highpass', 3200, 900);
          this.osc('sawtooth', 520, 110, 0.32, 0.1, now, null, { lowpass: 2200 });
          break;
        case 'freeze':
          this.osc('sine', 1760, 1660, 0.3, 0.13);
          this.osc('sine', 2637, 2500, 0.34, 0.08, now + 0.04);
          this.osc('triangle', 1319, 990, 0.25, 0.09, now + 0.08);
          break;
        case 'thaw':
          this.noise(0.16, 0.12, 'bandpass', 1800, 900, now, 2);
          break;
        case 'cross':
          [523, 659, 784, 1047].forEach((f, k) => this.osc('triangle', f, 0, 0.12, 0.18, now + k * 0.05));
          this.osc('pulse12', 2093, 0, 0.3, 0.05, now + 0.2);
          break;
        case 'powerWarn':
          this.osc('pulse25', 1175, 0, 0.05, 0.07);
          break;
        case 'powerOff':
          this.osc('pulse25', 659, 330, 0.22, 0.09);
          break;
        case 'treat':
        case 'toast':
          this.osc('sine', 1319, 0, 0.18, 0.16);
          this.osc('sine', 1760, 0, 0.26, 0.12, now + 0.07);
          break;
        case 'chest':
          this.osc('pulse25', 988, 0, 0.07, 0.12);
          this.osc('pulse25', 1319, 0, 0.3, 0.12, now + 0.07);
          break;
        case 'bible':
          [587, 740, 880].forEach((f) => this.osc('sawtooth', f, 0, 0.75, 0.06, now, null, { attack: 0.08, lowpass: 2400 }));
          this.osc('sine', 1175, 0, 0.6, 0.08, now + 0.1);
          break;
        case 'seal':
          [196, 392, 594, 790, 1180].forEach((f, k) => this.osc('sine', f, f * 0.995, 1.4 - k * 0.15, 0.16 / (k + 1)));
          this.noise(0.6, 0.12, 'bandpass', 600, 2400, now, 1.5);
          this.jingle('seal');
          break;
        case 'egg':
          this.jingle('egg');
          break;
        case 'die':
          this.osc('pulse25', 880, 110, 0.9, 0.16, now, null, { vibrato: 14 });
          break;
        case 'crush':
          this.noise(0.45, 0.35, 'lowpass', 700, 120);
          this.osc('sine', 140, 40, 0.4, 0.35);
          this.osc('pulse25', 600, 90, 0.7, 0.1, now + 0.15, null, { vibrato: 18 });
          break;
        case 'hatch':
          this.osc('sine', 130, 270, 0.22, 0.2);
          break;
        case 'enemyCrush':
          this.noise(0.22, 0.25, 'bandpass', 700, 200, now, 1.4);
          this.osc('sine', 320, 70, 0.22, 0.18);
          break;
        case 'pop':
          this.osc('sine', 500, 1500, 0.09, 0.15);
          break;
        case 'devilPoint':
          this.osc('sawtooth', 82, 62, 0.55, 0.16, now, null, { lowpass: 520, vibrato: 9 });
          this.noise(0.4, 0.07, 'lowpass', 400, 200);
          break;
        case 'crank':
          for (let k = 0; k < 7; k++) this.noise(0.035, 0.09, 'bandpass', 1400, 1200, now + k * 0.055, 3);
          break;
        case 'arrow':
          this.noise(0.3, 0.16, 'bandpass', 400, 2400, now, 1.2);
          this.osc('triangle', 660, 990, 0.14, 0.08);
          break;
        case 'go':
          this.jingle('start');
          break;
        case 'clear':
          this.jingle('clear');
          break;
        case 'gameover':
          this.jingle('gameover');
          break;
        case 'menu':
          this.osc('pulse25', 660, 0, 0.05, 0.06);
          break;
        case 'select':
          this.osc('pulse25', 880, 1320, 0.08, 0.08);
          break;
        default:
          break;
      }
    }

    // ---- music ----

    music(name) {
      if (!this.ac) {
        this.pendingTrack = name;
        return;
      }
      if (this.track && this.track.name === name) return;
      this.stopMusic();
      const tr = TRACKS[name];
      if (!tr) return;
      const lenSteps = tr.lead.reduce((a, n) => a + n[1], 0);
      // index each channel by the step its notes start on
      const mk = (list) => {
        const at = {};
        let s = 0;
        for (const [m, d] of list) {
          if (m !== null) at[s] = { m, d };
          s += d;
        }
        return { at, len: Math.max(1, s) };
      };
      this.track = {
        name,
        tr,
        len: lenSteps,
        step: 60 / tr.bpm / 4,
        t0: this.ac.currentTime + 0.1,
        next: 0,
        chans: { lead: mk(tr.lead), bass: mk(tr.bass), arp: mk(tr.arp) },
      };
      this.timer = setInterval(() => this.schedule(), 25);
      this.schedule();
    }

    stopMusic() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.track = null;
    }

    schedule() {
      const tk = this.track;
      if (!tk || !this.ac || this.ac.state !== 'running') return;
      const ahead = this.ac.currentTime + 0.15;
      for (;;) {
        const tStep = tk.t0 + tk.next * tk.step;
        if (tStep > ahead) break;
        if (tStep < this.ac.currentTime - 0.25) {
          // fell behind (tab was hidden): skip ahead instead of bursting notes
          const behind = Math.ceil((this.ac.currentTime - tk.t0) / tk.step);
          tk.next = Math.max(tk.next + 1, behind);
          continue;
        }
        const s = tk.next % tk.len;
        const tr = tk.tr;
        const { lead, bass, arp } = tk.chans;
        let e = lead.at[s % lead.len];
        if (e) {
          if (tr.soft) this.osc('triangle', hz(e.m), 0, e.d * tk.step * 0.98, 0.2, tStep, this.musicGain, { attack: 0.05 });
          else this.osc('pulse25', hz(e.m), 0, e.d * tk.step * 0.9, 0.11, tStep, this.musicGain, { lowpass: 3600 });
        }
        e = bass.at[s % bass.len];
        if (e) this.osc('triangle', hz(e.m), 0, e.d * tk.step * 0.92, 0.28, tStep, this.musicGain);
        e = arp.at[s % arp.len];
        if (e) this.osc('pulse12', hz(e.m + 12), 0, tk.step * 0.8, tr.soft ? 0.035 : 0.03, tStep, this.musicGain, { lowpass: 2600 });
        if (tr.drums) {
          const ch = tr.drums[s % tr.drums.length];
          if (ch === 'k') this.kick(tStep);
          else if (ch === 's') this.snare(tStep);
          else if (ch === 'h') this.hat(tStep);
        }
        tk.next++;
      }
    }

    kick(t) {
      const ac = this.ac;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g);
      g.connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.18);
    }
    drumNoise(t, dur, vol, type, f) {
      const ac = this.ac;
      const src = ac.createBufferSource();
      src.buffer = this.noiseBuf;
      const fl = ac.createBiquadFilter();
      fl.type = type;
      fl.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(fl);
      fl.connect(g);
      g.connect(this.musicGain);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.01);
    }
    snare(t) {
      this.drumNoise(t, 0.12, 0.22, 'bandpass', 1900);
    }
    hat(t) {
      this.drumNoise(t, 0.04, 0.1, 'highpass', 7000);
    }

    // ---- game events ----

    handle(events, s) {
      if (!this.ac) return;
      for (const e of events) {
        switch (e.t) {
          case 'dot':
          case 'fire':
          case 'fizzle':
          case 'burn':
          case 'freeze':
          case 'thaw':
          case 'cross':
          case 'treat':
          case 'toast':
          case 'chest':
          case 'bible':
          case 'seal':
          case 'egg':
          case 'hatch':
          case 'enemyCrush':
          case 'pop':
          case 'devilPoint':
          case 'crank':
          case 'arrow':
          case 'powerOff':
            this.play(e.t);
            break;
          case 'treats':
            this.play('treat');
            break;
          case 'fireEnd':
            if (e.why === 'wall') this.play('fireEnd');
            break;
          case 'die':
            this.play(e.kind === 'crush' ? 'crush' : 'die');
            break;
          case 'scene':
            this.stopMusic();
            break;
          case 'go':
            this.play('go');
            this.music(s.scene === 'bonus' ? 'bonus' : 'maze');
            break;
          case 'clear':
            this.stopMusic();
            this.play('clear');
            break;
          case 'gameover':
            this.stopMusic();
            this.play('gameover');
            break;
          default:
            break;
        }
      }
      // low-power warning beeps
      for (const p of s.pl) {
        if (p.st === 'walk' && p.bible < 0 && p.power > 0 && p.power <= 120 && p.power % 20 === 0 && s.tick !== this.lastPowerBeep) {
          this.lastPowerBeep = s.tick;
          this.play('powerWarn');
        }
      }
    }
  }

  DM.Sound = Sound;
  DM.audioData = { TRACKS, JINGLES, midi };
})(typeof window !== 'undefined' ? window : globalThis);
