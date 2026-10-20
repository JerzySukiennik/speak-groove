// Key of A minor; letters A-G are literally their notes, the rest of the alphabet keeps climbing the scale
export const SCALE = [0, 2, 3, 5, 7, 8, 10];
export const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const A1 = 33;
export const A2 = 45;
export const A3 = 57;
const VOWELS = 'AEIOUY';
const LIQUID = 'LMNRWY';
const ROOT_OF = [0, 5, 2, 3, 4, 5, 6];

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const isVowel = (ch) => VOWELS.includes(ch);

export function keyIndex(ch) {
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 65;
  if (ch >= '0' && ch <= '9') {
    const d = ch.charCodeAt(0) - 48;
    return d === 0 ? 9 : d - 1;
  }
  return -1;
}

export function degMidi(deg, base = A2) {
  const o = Math.floor(deg / 7);
  return base + 12 * o + SCALE[((deg % 7) + 7) % 7];
}

export function chordFor(idx) {
  const r = ROOT_OF[((idx % 7) + 7) % 7];
  const pcs = [r, r + 2, r + 4, r + 6, r + 8].map((d) => degMidi(d, A2) % 12);
  const third = (pcs[1] - pcs[0] + 12) % 12;
  const sev = (pcs[3] - pcs[0] + 12) % 12;
  const q = third === 3 ? 'MI7' : sev === 11 ? 'MAJ7' : '7';
  return { root: r, degs: [r, r + 2, r + 4, r + 6, r + 8], pcs, name: NOTE[pcs[0]] + q };
}

function nearest(pc, lo) {
  return lo + (((pc - lo) % 12) + 12) % 12;
}

export function padVoicing(chord) {
  const order = [chord.pcs[0], chord.pcs[2], chord.pcs[3], chord.pcs[1], chord.pcs[4]];
  const out = [nearest(order[0], 45)];
  for (let i = 1; i < order.length; i++) out.push(nearest(order[i], out[i - 1] + 1));
  return out;
}

export function voxVoicing(chord) {
  return [nearest(chord.pcs[0], 50), nearest(chord.pcs[2], 50)].sort((a, b) => a - b);
}

export function funkVoicing(chord) {
  return [nearest(chord.pcs[1], 60), nearest(chord.pcs[3], 60), nearest(chord.pcs[4], 64)].sort((a, b) => a - b);
}

export function voicePitch(idx, chord) {
  let m = degMidi(idx % 7, A2);
  const pc = m % 12;
  for (const c of chord.pcs.slice(0, 4)) {
    if ((pc - c + 12) % 12 === 1) return m - 1;
  }
  return m;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const ACID_RHYTHMS = [
  [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1],
  [1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0],
  [1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1],
  [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1],
];
const ACID_REL = [0, 0, 4, 7, 2, 6, 0, 3, 7, 4];

export function acidPattern(buf, chord) {
  const src = buf.length ? buf : ['A'];
  const rhythm = ACID_RHYTHMS[hash(src.join('')) % ACID_RHYTHMS.length];
  const steps = [];
  for (let s = 0; s < 16; s++) {
    const ch = src[s % src.length];
    const idx = Math.max(0, keyIndex(ch));
    const rel = ACID_REL[idx % ACID_REL.length];
    const up = idx >= 13 && s % 3 === 2 ? 12 : 0;
    steps.push({
      on: !!rhythm[s],
      note: degMidi(chord.root + rel, A1) + up,
      acc: isVowel(ch) || (s % 8 === 0),
      slide: false,
      ch,
    });
  }
  for (let s = 0; s < 16; s++) {
    const n = steps[(s + 1) % 16];
    steps[s].slide = steps[s].on && n.on && (LIQUID.includes(n.ch) || n.ch === steps[s].ch);
  }
  return steps;
}

export function arpPattern(buf, chord) {
  const tones = chord.degs.slice(0, 4).map((d) => degMidi(d, A3));
  const out = [];
  if (!buf.length) {
    const up = [0, 1, 2, 3, 2, 1];
    for (let s = 0; s < 16; s++) out.push(tones[up[s % up.length]]);
    return out;
  }
  for (let s = 0; s < 16; s++) {
    const idx = Math.max(0, keyIndex(buf[s % buf.length]));
    const t = tones[idx % 4];
    out.push(t + (Math.floor(idx / 4) % 2 && t < 70 ? 12 : 0));
  }
  return out;
}

export function voxToken(buf) {
  for (let i = buf.length - 1; i >= 0; i--) {
    const c = buf[i];
    if (c === 'A') return 'hah';
    if (c === 'O') return 'hoo';
    if (c === 'E') return 'hey';
    if (c === 'I' || c === 'Y') return 'hee';
    if (c === 'U') return 'huh';
  }
  return 'hah';
}

export const FUNK_PATTERNS = [
  [0, 0, 1, 0, 0, 1, 0, 0.35, 0, 0, 1, 0, 0.35, 1, 0, 0],
  [0, 0, 1, 0.35, 0, 0, 1, 0, 0.35, 0, 1, 0, 0, 1, 0, 0.35],
  [0.35, 0, 1, 0, 0, 1, 0, 1, 0, 0.35, 1, 0, 0, 1, 0, 0],
];

export function funkPattern(buf) {
  return FUNK_PATTERNS[hash(buf.slice(-4).join('')) % FUNK_PATTERNS.length];
}

export const PERC = {
  rim: [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0],
  conga: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1],
  congalow: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  shaker: [0.55, 0.25, 0.85, 0.3, 0.55, 0.25, 0.85, 0.3, 0.55, 0.25, 0.85, 0.3, 0.55, 0.25, 0.85, 0.4],
};

export const HAT_VEL = [0.32, 0.18, 0, 0.24, 0.32, 0.18, 0, 0.24, 0.32, 0.18, 0, 0.24, 0.32, 0.18, 0, 0.3];
