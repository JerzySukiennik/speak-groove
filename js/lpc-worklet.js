// LPC-10 speech synth (TMS5100-style, 8 kHz internal) as an AudioWorklet with a small voice pool
const ORDER = 10;
const INTERP = 25;

class Voice {
  constructor() {
    this.hist = new Float64Array(ORDER);
    this.a = new Float64Array(ORDER + 1);
    this.prev = new Float64Array(ORDER + 1);
    this.k = new Float64Array(ORDER);
    this.active = false;
  }
}

class LPCProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const n = (options.processorOptions && options.processorOptions.voices) || 3;
    this.voices = Array.from({ length: n }, () => new Voice());
    this.queue = [];
    this.tokens = null;
    this.chirp = new Float32Array(1);
    this.hop = 200;
    this.fs = 8000;
    this.step = this.fs / sampleRate;
    this.seed = 22222;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'init') {
        this.tokens = m.tokens;
        this.chirp = Float32Array.from(m.chirp);
        this.hop = m.hop;
        this.fs = m.fs;
        this.step = this.fs / sampleRate;
      } else if (m.type === 'play') {
        this.queue.push(m);
      } else if (m.type === 'silence') {
        for (const v of this.voices) v.fade = 0.004;
      }
    };
  }

  noise() {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return (this.seed / 0x3fffffff - 1) * 1.732;
  }

  start(m, delay) {
    const tok = this.tokens && this.tokens[m.token];
    if (!tok) return;
    let v = this.voices.find((x) => !x.active);
    if (!v) v = this.voices.reduce((a, b) => (a.born < b.born ? a : b));
    v.active = true;
    v.born = currentTime;
    v.frames = tok.f;
    v.sus = tok.s;
    v.holdLeft = m.hold ? Math.round(m.hold * this.fs) : 0;
    v.fi = 0;
    v.si = 0;
    v.delay = delay;
    v.f0 = m.f0 || 120;
    v.contour = m.contour === undefined ? 0.35 : m.contour;
    v.gain = m.gain === undefined ? 1 : m.gain;
    v.vib = m.vib || 0;
    v.vibPh = 0;
    v.rate = m.rate || 1;
    v.acc = 0;
    v.phase = 0;
    v.cpos = 1e9;
    v.de = 0;
    v.cur = 0;
    v.last = 0;
    v.frac = 0;
    v.env = 1;
    v.fade = 0;
    v.hist.fill(0);
    this.params(v);
  }

  params(v) {
    const F = v.frames;
    const A = F[v.fi];
    const holding = v.holdLeft > 0 && v.fi === v.sus;
    const B = holding ? A : F[v.fi + 1];
    const t = v.si / this.hop;
    const same = B && A[0] === B[0];
    for (let i = 0; i < ORDER; i++) v.k[i] = same ? A[3 + i] + (B[3 + i] - A[3 + i]) * t : A[3 + i];
    v.sig = B ? A[1] + (B[1] - A[1]) * t : A[1] * (1 - t);
    v.voiced = A[0] > 0;
    const ratio = same && A[2] > 0 && B[2] > 0 ? A[2] + (B[2] - A[2]) * t : A[2] > 0 ? A[2] : 1;
    v.vibPh += (INTERP / this.fs) * 5.6 * Math.PI * 2;
    const f = v.f0 * Math.pow(ratio, v.contour) * (1 + v.vib * Math.sin(v.vibPh));
    v.period = this.fs / Math.max(40, Math.min(900, f));
    const a = v.a, p = v.prev;
    a.fill(0);
    a[0] = 1;
    for (let i = 1; i <= ORDER; i++) {
      for (let j = 0; j < i; j++) p[j] = a[j];
      const ki = v.k[i - 1];
      for (let j = 1; j < i; j++) a[j] = p[j] + ki * p[i - j];
      a[i] = ki;
    }
  }

  tick(v) {
    if (v.si % INTERP === 0) this.params(v);
    let e;
    if (v.voiced) {
      v.phase += 1;
      if (v.phase >= v.period) {
        v.phase -= v.period;
        v.cpos = 0;
      }
      const c = v.cpos < this.chirp.length ? this.chirp[v.cpos] : 0;
      v.cpos++;
      e = c * v.sig * Math.sqrt(v.period) + this.noise() * v.sig * 0.12;
    } else {
      e = this.noise() * v.sig;
    }
    const h = v.hist, a = v.a;
    let y = e;
    for (let j = 1; j <= ORDER; j++) y -= a[j] * h[j - 1];
    for (let j = ORDER - 1; j > 0; j--) h[j] = h[j - 1];
    h[0] = y;
    if (!(y < 50 && y > -50)) { h.fill(0); y = 0; }
    v.de = y + 0.85 * v.de;
    v.si++;
    if (v.si >= this.hop) {
      v.si = 0;
      if (v.holdLeft > 0 && v.fi === v.sus) {
        v.holdLeft -= this.hop;
      } else {
        v.fi++;
        if (v.fi >= v.frames.length - 1) v.active = false;
      }
    }
    return v.de;
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const N = out.length;
    out.fill(0);
    if (this.queue.length) {
      const horizon = currentTime + N / sampleRate;
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const m = this.queue[i];
        if (m.time === undefined || m.time < horizon) {
          const d = m.time === undefined ? 0 : Math.max(0, Math.round((m.time - currentTime) * sampleRate));
          this.queue.splice(i, 1);
          this.start(m, d);
        }
      }
    }
    for (const v of this.voices) {
      if (!v.active) continue;
      const step = this.step * v.rate;
      for (let n = 0; n < N; n++) {
        if (v.delay > 0) { v.delay--; continue; }
        v.frac += step;
        while (v.frac >= 1) {
          v.frac -= 1;
          v.last = v.cur;
          v.cur = v.active ? this.tick(v) : 0;
        }
        let s = v.last + (v.cur - v.last) * v.frac;
        if (v.fade > 0) {
          v.env -= v.fade;
          if (v.env <= 0) { v.active = false; break; }
        }
        s = Math.round(s * 384) / 384;
        out[n] += s * v.gain * v.env;
        if (!v.active && v.frac === 0) break;
      }
    }
    return true;
  }
}

registerProcessor('lpc-voice', LPCProcessor);
