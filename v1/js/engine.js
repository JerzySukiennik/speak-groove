// Speak & Groove audio engine: buses, instruments, 16-step scheduler and the energy-driven build-up
import * as M from './music.js';

export const LAYERS = ['pad', 'kick', 'hats', 'acid', 'clap', 'arp', 'perc', 'vox', 'funk'];
const SAMPLES = ['kick', 'clap', 'hat', 'openhat', 'rim', 'crash', 'cymverb', 'snare', 'conga', 'congalow', 'shaker'];
const BUS = {
  pad: { g: 0.3, rev: 0.5, dly: 0, pump: true },
  kick: { g: 0.85, rev: 0, dly: 0 },
  hats: { g: 0.68, rev: 0.06, dly: 0 },
  acid: { g: 0.42, rev: 0.05, dly: 0.14, pump: true },
  clap: { g: 0.55, rev: 0.4, dly: 0 },
  arp: { g: 0.2, rev: 0.25, dly: 0.5, pump: true },
  perc: { g: 0.6, rev: 0.16, dly: 0.05 },
  vox: { g: 0.55, rev: 0.6, dly: 0.3, pump: true },
  funk: { g: 0.3, rev: 0.16, dly: 0.12, pump: true },
  stylo: { g: 0.46, rev: 0.4, dly: 0.28 },
  speech: { g: 1.0, rev: 0.75, dly: 0.32 },
  fx: { g: 0.5, rev: 0.6, dly: 0 },
};
const TEMPO_MIN = 100;
const TEMPO_SPAN = 40;
const hold = (p, t) => (p.cancelAndHoldAtTime ? p.cancelAndHoldAtTime(t) : p.cancelScheduledValues(t));

function pulseWave(ctx, duty, n = 48) {
  const re = new Float32Array(n + 1);
  const im = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ctx.createPeriodicWave(re, im);
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.buf = {};
    this.events = [];
    this.p = { tempo: 0.6, swing: 0.24, cutoff: 0.38, reso: 0.62, drive: 0.32, release: 0.4, space: 0.5, echo: 0.38 };
    this.level = 0;
    this.pending = null;
    this.energy = 0;
    this.holding = false;
    this.override = {};
    this.typed = [];
    this.word = [];
    this.chord = M.chordFor(0);
    this.nextChord = null;
    this.running = false;
    this.step = 0;
    this.bar = 0;
    this.nextTime = 0;
    this.barsSince = 0;
    this.idleBars = 0;
    this.padVoices = [];
    this.padChordName = '';
    this.lastTick = 0;
    this.patterns();
  }

  preload() {
    const wavs = SAMPLES.map((n) => fetch(`assets/drums/${n}.wav`).then((r) => r.arrayBuffer()));
    this.raw = Promise.all([fetch('assets/voice.json').then((r) => r.json()), ...wavs]);
    this.raw.catch(() => {});
  }

  start() {
    if (!this.ready) {
      if (navigator.audioSession) {
        try { navigator.audioSession.type = 'playback'; } catch (e) {}
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.ctx.resume();
      this.ready = this.boot();
    } else if (this.ctx.state !== 'running') {
      this.ctx.resume();
    }
    return this.ready;
  }

  async boot() {
    const ctx = this.ctx;
    const [voice, ...wavs] = await this.raw;
    const decoded = await Promise.all(wavs.map((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej))));
    SAMPLES.forEach((n, i) => (this.buf[n] = decoded[i]));
    const src = this.buf.cymverb;
    const rev = ctx.createBuffer(1, src.length, src.sampleRate);
    rev.getChannelData(0).set(Float32Array.from(src.getChannelData(0)).reverse());
    this.buf.riser = rev;
    this.graph();
    await ctx.audioWorklet.addModule('js/lpc-worklet.js');
    const mk = (voices) => new AudioWorkletNode(ctx, 'lpc-voice', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { voices },
    });
    this.speech = mk(3);
    this.vox = mk(4);
    for (const n of [this.speech, this.vox]) n.port.postMessage({ type: 'init', ...voice });
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    const pres = ctx.createBiquadFilter();
    pres.type = 'peaking';
    pres.frequency.value = 2300;
    pres.gain.value = 4;
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 9000;
    this.speech.connect(hp).connect(pres).connect(soft).connect(this.bus.speech);
    const vhp = ctx.createBiquadFilter();
    vhp.type = 'highpass';
    vhp.frequency.value = 160;
    this.vox.connect(vhp).connect(this.bus.vox);
    this.timer();
    for (const k in this.p) this.set(k, this.p[k]);
  }

  graph() {
    const ctx = this.ctx;
    const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const F = (type, f, q = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    this.G = G;
    this.F = F;
    this.mix = G();
    this.dry = G();
    this.kHP = F('highpass', 20);
    this.kLP = F('lowpass', 20000);
    this.master = G(0.7);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.dry.connect(this.mix);
    this.mix.connect(this.kHP).connect(this.kLP).connect(this.master).connect(comp).connect(ctx.destination);
    comp.connect(this.analyser);

    this.revIn = G();
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(3.8);
    this.revOut = G(0.5);
    this.revIn.connect(conv).connect(this.revOut).connect(this.mix);

    this.dlyIn = G();
    this.dL = ctx.createDelay(2);
    this.dR = ctx.createDelay(2);
    const dlp = F('lowpass', 2600);
    const dhp = F('highpass', 180);
    this.fb = G(0.4);
    const pL = ctx.createStereoPanner();
    const pR = ctx.createStereoPanner();
    pL.pan.value = -0.75;
    pR.pan.value = 0.75;
    this.dlyOut = G(0.5);
    this.dlyIn.connect(dhp).connect(this.dL);
    this.dL.connect(dlp).connect(this.dR);
    this.dR.connect(this.fb).connect(this.dL);
    this.dL.connect(pL).connect(this.dlyOut);
    this.dR.connect(pR).connect(this.dlyOut);
    this.dlyOut.connect(this.mix);
    const smear = G(0.22);
    this.dlyOut.connect(smear).connect(this.revIn);
    this.throw = G(0);
    this.dry.connect(this.throw).connect(this.dlyIn);

    this.pumpG = G(1);
    this.pumpG.connect(this.dry);
    this.bus = {};
    this.sendRev = {};
    for (const [name, c] of Object.entries(BUS)) {
      const b = G(c.g);
      b.connect(c.pump ? this.pumpG : this.dry);
      if (c.rev) b.connect((this.sendRev[name] = G(c.rev))).connect(this.revIn);
      if (c.dly) b.connect(G(c.dly)).connect(this.dlyIn);
      this.bus[name] = b;
    }

    this.padLfo = ctx.createOscillator();
    this.padLfo.frequency.value = 0.07;
    this.padLfoAmt = G(380);
    this.padLfo.connect(this.padLfoAmt);
    this.padLfo.start();

    this.acidOsc = ctx.createOscillator();
    this.acidOsc.type = 'sawtooth';
    this.acidF1 = F('lowpass', 400, 14);
    this.acidF2 = F('lowpass', 400, -2);
    this.acidShaper = ctx.createWaveShaper();
    this.acidShaper.oversample = '2x';
    this.acidVca = G(0);
    this.acidOsc.connect(this.acidF1).connect(this.acidF2).connect(this.acidShaper).connect(this.acidVca).connect(this.bus.acid);
    this.acidOsc.start();

    this.styloOsc = ctx.createOscillator();
    this.styloOsc.setPeriodicWave(pulseWave(ctx, 0.36));
    this.styloOsc.frequency.value = 220;
    const sLfo = ctx.createOscillator();
    sLfo.frequency.value = 5.8;
    this.styloVib = G(0);
    sLfo.connect(this.styloVib).connect(this.styloOsc.detune);
    sLfo.start();
    const sHp = F('highpass', 260, 0);
    const sPk = F('peaking', 2400, 1.4);
    sPk.gain.value = 7;
    this.styloLp = F('lowpass', 5000, 0);
    this.styloVca = G(0);
    this.styloOsc.connect(sHp).connect(sPk).connect(this.styloLp).connect(this.styloVca).connect(this.bus.stylo);
    this.styloOsc.start();

    this.funkWave = pulseWave(ctx, 0.22);
  }

  impulse(sec) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const n = Math.floor(sec * sr);
    const pre = Math.floor(0.018 * sr);
    const b = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        const a = 0.08 + 0.85 * Math.exp(-t * 1.6);
        lp += a * (Math.random() * 2 - 1 - lp);
        const early = t < 0.09 && Math.random() < 0.02 ? 2.5 : 1;
        d[i] = lp * Math.exp((-t * 6.9) / sec) * early;
      }
    }
    return b;
  }

  timer() {
    const code = 'let id;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
    try {
      this.worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      this.worker.onmessage = () => this.tick();
      this.worker.postMessage(25);
    } catch (e) {
      setInterval(() => this.tick(), 25);
    }
  }

  get bpm() { return TEMPO_MIN + this.p.tempo * TEMPO_SPAN; }
  get sd() { return 60 / this.bpm / 4; }
  get swingOff() { return this.p.swing * 0.5 * this.sd; }
  rel(min, max) { return min + (max - min) * this.p.release * this.p.release; }

  set(name, v) {
    this.p[name] = v;
    if (!this.ctx || !this.bus) return;
    const now = this.ctx.currentTime;
    if (name === 'tempo') {
      const dt = (60 / this.bpm) * 0.75;
      this.dL.delayTime.setTargetAtTime(dt, now, 0.05);
      this.dR.delayTime.setTargetAtTime(dt, now, 0.05);
    } else if (name === 'space') {
      this.revOut.gain.setTargetAtTime(v * 1.25, now, 0.06);
    } else if (name === 'echo') {
      this.dlyOut.gain.setTargetAtTime(0.15 + v * 0.85, now, 0.06);
      this.fb.gain.setTargetAtTime(0.18 + v * 0.5, now, 0.06);
    } else if (name === 'drive') {
      const k = 1 + v * 14;
      const c = new Float32Array(1024);
      const norm = Math.tanh(k);
      for (let i = 0; i < c.length; i++) {
        const x = (i / (c.length - 1)) * 2 - 1;
        c[i] = Math.tanh(k * x) / norm;
      }
      this.acidShaper.curve = c;
      this.bus.acid.gain.setTargetAtTime(BUS.acid.g * (1 - v * 0.35), now, 0.05);
    } else if (name === 'reso') {
      this.acidF1.Q.setTargetAtTime(3 + v * 19, now, 0.03);
    } else if (name === 'cutoff') {
      if (this.acidLive) {
        const f = this.acidBase();
        this.acidF1.frequency.setTargetAtTime(f, now, 0.03);
        this.acidF2.frequency.setTargetAtTime(f, now, 0.03);
      }
    }
  }

  acidBase() { return 80 * Math.pow(32, this.p.cutoff) * (0.85 + Math.min(1, this.energy) * 0.3); }

  emit(t, type, data) {
    const e = { t, type, data };
    const q = this.events;
    let i = q.length;
    while (i > 0 && q[i - 1].t > t) i--;
    q.splice(i, 0, e);
    if (q.length > 600) this.events = q.filter((x) => x.type !== 'step' && x.type !== 'hit');
  }

  audible(name) {
    const o = this.override[name];
    if (o === 'mute') return false;
    if (o === 'force') return true;
    return LAYERS.indexOf(name) < this.level;
  }

  toggle(name) {
    if (this.override[name]) delete this.override[name];
    else this.override[name] = LAYERS.indexOf(name) < this.level ? 'mute' : 'force';
    if (name === 'pad' && this.ctx) {
      const t = this.ctx.currentTime + 0.02;
      if (this.audible('pad')) this.padChord(t);
      else this.padRelease(t);
    }
    return this.override[name] || 'auto';
  }

  patterns() {
    const buf = this.typed.slice(-16);
    this.acidPat = M.acidPattern(buf, this.chord);
    this.arpPat = M.arpPattern(buf.slice(-8), this.chord);
    this.funkPat = M.funkPattern(buf);
    this.voxTok = M.voxToken(buf);
  }

  tick() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dt = Math.min(0.5, now - (this.lastTick || now));
    this.lastTick = now;
    if (!this.holding) this.energy *= Math.pow(0.5, dt / 5);
    if (!this.running) return;
    while (this.nextTime < now + 0.12) {
      this.schedule(this.step, this.nextTime);
      this.nextTime += this.sd;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  transport(t) {
    this.running = true;
    this.step = 0;
    this.bar = 0;
    this.barsSince = 0;
    this.idleBars = 0;
    this.nextTime = t;
    this.emit(t, 'run', true);
  }

  gridTime(now, every = 1) {
    if (!this.running) return now + 0.01;
    const sd = this.sd;
    let k = Math.floor((this.nextTime - now) / sd);
    let t = this.nextTime - k * sd;
    let s = (this.step - k + 1600) % 16;
    while (s % every) { t += sd; s = (s + 1) % 16; }
    return t + (s % 2 ? this.swingOff : 0);
  }

  setLevel(n, t) {
    const old = this.level;
    this.level = Math.max(0, Math.min(LAYERS.length, n));
    this.barsSince = 0;
    const padWas = LAYERS.indexOf('pad') < old;
    const padNow = this.audible('pad');
    if (padNow && (!padWas || !this.padVoices.length)) this.padChord(t);
    if (!padNow && this.override.pad !== 'force') this.padRelease(t);
    if (this.level > old && this.level >= 2 && old < 2) this.hit('crash', t, 0.5, this.bus.fx);
    if (this.level === LAYERS.length && old < this.level) this.hit('crash', t, 0.6, this.bus.fx);
    this.emit(t, 'level', this.level);
  }

  queueLevel(n, at) {
    this.pending = n;
    if (n > this.level && (n === 2 || n === LAYERS.length)) this.riser(at);
    this.emit(this.ctx.currentTime, 'pending', n);
  }

  bar0(t) {
    const barDur = this.sd * 16;
    if (this.pending !== null) {
      this.setLevel(this.pending, t);
      this.pending = null;
    } else {
      this.barsSince++;
    }
    if (this.bar % 2 === 0 && this.nextChord) {
      const changed = this.nextChord.name !== this.chord.name;
      this.chord = this.nextChord;
      this.nextChord = null;
      if (changed && this.audible('pad')) this.padChord(t);
      this.emit(t, 'chord', this.chord.name);
    }
    this.patterns();
    const E = this.energy;
    if (!this.holding && this.pending === null) {
      if (E > 0.3 && this.level < LAYERS.length && this.barsSince >= 1) this.queueLevel(this.level + 1, t + barDur);
      else if (E < 0.1 && this.level > 1 && this.barsSince >= 1) this.queueLevel(this.level - 1, t + barDur);
      else if (E < 0.025 && this.level === 1 && this.barsSince >= 3) this.queueLevel(0, t + barDur);
    }
    if (this.level === 0 && this.pending === null && E < 0.025) {
      this.idleBars++;
      if (this.idleBars > 4) {
        this.running = false;
        this.emit(t, 'run', false);
      }
    } else {
      this.idleBars = 0;
    }
  }

  schedule(s, t) {
    if (s === 0) this.bar0(t);
    const tt = t + (s % 2 ? this.swingOff : 0);
    const E = Math.min(1, this.energy);
    this.emit(tt, 'step', { s, bar: this.bar });
    if (this.audible('kick') && s % 4 === 0) {
      this.hit('kick', t, 1, this.bus.kick);
      this.pump(t);
      this.emit(t, 'hit', 'kick');
    }
    if (this.audible('hats')) {
      if (s % 4 === 2) {
        this.hit('openhat', tt, 0.42 + E * 0.1, this.bus.hats, 1, 0.15);
        this.emit(tt, 'hit', 'hats');
      } else if (M.HAT_VEL[s]) {
        this.hit('hat', tt, M.HAT_VEL[s] * (1.2 + E * 0.6), this.bus.hats, 1, 0.3);
      }
    }
    if (this.audible('clap') && (s === 4 || s === 12 || (s === 15 && this.bar % 4 === 3))) {
      this.hit('clap', s === 15 ? tt : t, s === 15 ? 0.35 : 0.8, this.bus.clap);
      this.emit(t, 'hit', 'clap');
    }
    if (this.audible('perc')) {
      const P = M.PERC;
      if (P.rim[s]) this.hit('rim', tt, 0.32, this.bus.perc, 1, -0.35);
      if (P.conga[s]) this.hit('conga', tt, 0.55, this.bus.perc, 1, 0.4);
      if (P.congalow[s]) this.hit('congalow', tt, 0.45, this.bus.perc, 1, -0.2);
      if (P.shaker[s]) this.hit('shaker', tt, P.shaker[s] * 0.5, this.bus.perc, 1, 0.55);
      if (P.rim[s] || P.conga[s]) this.emit(tt, 'hit', 'perc');
    }
    if (this.audible('acid')) this.acidStep(s, tt);
    else if (this.acidLive) {
      this.acidLive = false;
      this.acidVca.gain.setTargetAtTime(0, t, 0.02);
    }
    if (this.audible('arp')) this.arpStep(s, tt);
    if (this.audible('funk') && this.funkPat[s]) {
      this.funkStab(tt, this.funkPat[s]);
      if (this.funkPat[s] > 0.5) this.emit(tt, 'hit', 'funk');
    }
    if (this.audible('vox')) {
      if (s === 2) this.voxStab(tt, this.bar % 2 ? 0.16 : 0.3);
      if (s === 10 && this.bar % 2) this.voxStab(tt, 0.22);
    }
    if (this.audible('pad') && s === 0) this.emit(t, 'hit', 'pad');
  }

  hit(name, t, gain, dest, rate = 1, pan = 0) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.buf[name];
    s.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(dest);
    } else {
      g.connect(dest);
    }
    s.start(Math.max(t, ctx.currentTime));
  }

  pump(t) {
    const g = this.pumpG.gain;
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(0.38, t + 0.012);
    g.setTargetAtTime(1, t + 0.04, 0.085);
  }

  riser(at) {
    const ctx = this.ctx;
    const b = this.buf.riser;
    const start = at - b.duration;
    const now = ctx.currentTime + 0.01;
    const s = ctx.createBufferSource();
    s.buffer = b;
    const g = ctx.createGain();
    g.gain.value = 0.55;
    s.connect(g).connect(this.bus.fx);
    if (start >= now) s.start(start);
    else s.start(now, now - start);
    const barDur = this.sd * 16;
    for (let i = 0; i < 8; i++) this.hit('snare', at - barDur / 2 + (i * barDur) / 16, 0.08 + i * 0.05, this.bus.fx);
  }

  padChord(t) {
    this.padRelease(t);
    const ctx = this.ctx;
    const notes = M.padVoicing(this.chord);
    this.padVoices = notes.map((m, i) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.085, t + 0.7 + i * 0.08);
      const f = this.F('lowpass', 700 + i * 160, 1);
      this.padLfoAmt.connect(f.frequency);
      const pan = ctx.createStereoPanner();
      pan.pan.value = (i % 2 ? 1 : -1) * (0.15 + i * 0.12);
      const oscs = [-9, 9].map((det) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = M.mtof(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        return o;
      });
      f.connect(g).connect(pan).connect(this.bus.pad);
      return { g, oscs, f };
    });
  }

  padRelease(t) {
    const r = this.rel(0.4, 6);
    for (const v of this.padVoices) {
      hold(v.g.gain, t);
      v.g.gain.setTargetAtTime(0, t, r / 4);
      for (const o of v.oscs) o.stop(t + r * 1.3 + 0.1);
      const lfo = this.padLfoAmt;
      setTimeout(() => { try { lfo.disconnect(v.f.frequency); } catch (e) {} }, (t - this.ctx.currentTime + r * 1.3 + 0.3) * 1000);
    }
    this.padVoices = [];
  }

  acidStep(s, t) {
    const st = this.acidPat[s];
    if (!st.on) return;
    const prev = this.acidPat[(s + 15) % 16];
    const sliding = this.acidLive && prev.on && prev.slide;
    this.acidLive = true;
    const f = M.mtof(st.note);
    const o = this.acidOsc.frequency;
    if (sliding) o.setTargetAtTime(f, t, 0.03);
    else o.setValueAtTime(f, t);
    const base = this.acidBase();
    if (!sliding) {
      const peak = Math.min(base * (st.acc ? 7 : 3.6), 14000);
      const dec = (st.acc ? 0.05 : 0.09) + this.p.release * 0.18;
      for (const flt of [this.acidF1, this.acidF2]) {
        flt.frequency.setValueAtTime(peak, t);
        flt.frequency.setTargetAtTime(base, t + 0.003, dec / 2.5);
      }
      this.acidVca.gain.setTargetAtTime(st.acc ? 0.95 : 0.6, t, 0.002);
      this.emit(t, 'hit', 'acid');
    }
    if (!st.slide) this.acidVca.gain.setTargetAtTime(0, t + this.sd * 0.55, 0.008 + this.rel(0.004, 0.09));
  }

  arpStep(s, t) {
    const m = this.arpPat[s];
    if (m == null) return;
    const ctx = this.ctx;
    const acc = [1, 0.55, 0.7, 1, 0.55, 0.7, 1, 0.6][s % 8];
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = M.mtof(m);
    const f = this.F('lowpass', 900, 4);
    const top = 1200 + 5200 * this.p.cutoff * acc;
    f.frequency.setValueAtTime(top, t);
    f.frequency.setTargetAtTime(500, t + 0.002, 0.07);
    const g = ctx.createGain();
    const r = this.rel(0.04, 0.9);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * acc, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.03, r / 3);
    o.connect(f).connect(g).connect(this.bus.arp);
    o.start(t);
    o.stop(t + 0.05 + r * 1.6);
    if (s % 4 === 0) this.emit(t, 'hit', 'arp');
  }

  funkStab(t, vel) {
    const ctx = this.ctx;
    const bp = this.F('bandpass', 500, 3.2);
    bp.frequency.setValueAtTime(450, t);
    bp.frequency.exponentialRampToValueAtTime(2400 + 1600 * this.p.cutoff, t + 0.03);
    bp.frequency.exponentialRampToValueAtTime(650, t + 0.2);
    const g = ctx.createGain();
    const r = this.rel(0.04, 0.45);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.025 + (vel > 0.5 ? 0.04 : 0), r / 3);
    bp.connect(g).connect(this.bus.funk);
    const end = t + 0.1 + r * 1.5;
    for (const m of M.funkVoicing(this.chord)) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.funkWave);
      o.frequency.value = M.mtof(m);
      o.connect(bp);
      o.start(t);
      o.stop(end);
    }
  }

  voxStab(t, len) {
    const notes = M.voxVoicing(this.chord);
    notes.forEach((m, i) => {
      this.vox.port.postMessage({ type: 'play', token: this.voxTok, time: t, f0: M.mtof(m), hold: len, contour: 0.12, vib: 0.01, gain: i ? 0.4 : 0.55 });
    });
    this.emit(t, 'hit', 'vox');
  }

  say(token, t, f0, gain = 1) {
    this.speech.port.postMessage({ type: 'play', token, time: t, f0, gain });
  }

  key(ch) {
    const now = this.ctx.currentTime;
    const idx = M.keyIndex(ch);
    if (idx < 0) return;
    this.energy = Math.min(1.25, this.energy + 0.13);
    this.idleBars = 0;
    if (this.pending !== null && this.pending < this.level) this.pending = null;
    this.typed.push(ch);
    if (this.typed.length > 32) this.typed.shift();
    this.word.push(ch);
    if (this.word.length > 16) this.word.shift();
    this.nextChord = M.chordFor(idx);
    if (!this.running) {
      this.chord = this.nextChord;
      this.nextChord = null;
      this.patterns();
      this.emit(now, 'chord', this.chord.name);
      this.transport(now + 0.02);
    }
    if (this.level === 0 && this.pending === null) this.setLevel(1, now + 0.02);
    const t = this.audible('kick') ? this.gridTime(now) : now + 0.012;
    this.say(ch, t, M.mtof(M.voicePitch(idx, this.chord)));
    this.emit(t, 'say', ch);
  }

  sayIt() {
    const now = this.ctx.currentTime;
    const w = this.word.length ? this.word.slice() : this.typed.slice(-8);
    if (!w.length) {
      this.say('sayit', now + 0.01, 120);
      return;
    }
    const beat = this.running && this.audible('kick');
    const t0 = beat ? this.gridTime(now, 2) : now + 0.02;
    const gap = beat ? this.sd * 2 : 0.34;
    w.forEach((ch, i) => {
      const t = t0 + i * gap;
      const idx = M.keyIndex(ch);
      this.say(ch, t, M.mtof(M.voicePitch(idx + (i % 3 === 2 ? 2 : 0), this.chord)));
      this.emit(t, 'spell', { ch, i, n: w.length });
    });
    this.energy = Math.min(1.25, this.energy + 0.1);
  }

  space() {
    this.word = [];
    this.emit(this.ctx.currentTime, 'space', null);
  }

  erase() {
    this.typed.pop();
    this.word.pop();
    this.say('erase', this.ctx.currentTime + 0.01, 118);
  }

  more() {
    this.say('more', this.ctx.currentTime + 0.01, 130);
    this.energy = Math.max(this.energy, 0.75);
    if (!this.running) {
      this.transport(this.ctx.currentTime + 0.02);
      this.setLevel(1, this.ctx.currentTime + 0.02);
      return;
    }
    if (this.level < LAYERS.length) {
      const target = (this.pending !== null ? this.pending : this.level) + 1;
      this.queueLevel(Math.min(LAYERS.length, target), this.nextBarTime());
    }
  }

  less() {
    this.say('less', this.ctx.currentTime + 0.01, 104);
    this.energy = Math.min(this.energy, 0.2);
    const target = (this.pending !== null ? this.pending : this.level) - 1;
    if (this.running && target >= 0) this.queueLevel(target, this.nextBarTime());
  }

  toggleHold() {
    this.holding = !this.holding;
    this.say('hold', this.ctx.currentTime + 0.01, this.holding ? 132 : 100);
    return this.holding;
  }

  off() {
    const now = this.ctx.currentTime;
    this.say('off', now + 0.01, 96);
    this.energy = 0;
    this.holding = false;
    this.pending = null;
    this.override = {};
    this.setLevel(0, now + 0.05);
    this.padRelease(now + 0.05);
  }

  intro() {
    this.say('intro', this.ctx.currentTime + 0.05, 116);
  }

  nextBarTime() {
    const left = (16 - this.step) % 16;
    return this.nextTime + left * this.sd;
  }

  styloOn(m, bright, vib) {
    const now = this.ctx.currentTime;
    const f = M.mtof(m);
    this.styloOsc.frequency.setTargetAtTime(f, now, 0.002);
    this.styloLp.frequency.setTargetAtTime(1400 + bright * 7000, now, 0.02);
    this.styloVib.gain.setTargetAtTime(vib * 38, now, 0.05);
    hold(this.styloVca.gain, now);
    this.styloVca.gain.setTargetAtTime(0.3, now, 0.003);
  }

  styloOff() {
    const now = this.ctx.currentTime;
    hold(this.styloVca.gain, now);
    this.styloVca.gain.setTargetAtTime(0, now, this.rel(0.01, 0.9) / 3);
  }

  xy(x, y) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const lp = x < 0 ? 20000 * Math.pow(2, x * 8.6) : 20000;
    const hp = x > 0 ? 20 * Math.pow(2, x * 8.6) : 20;
    this.kLP.frequency.setTargetAtTime(lp, now, 0.02);
    this.kHP.frequency.setTargetAtTime(hp, now, 0.02);
    const q = y * 15;
    this.kLP.Q.setTargetAtTime(q, now, 0.03);
    this.kHP.Q.setTargetAtTime(q, now, 0.03);
    this.throw.gain.setTargetAtTime(y * y * 0.7, now, 0.04);
  }
}
