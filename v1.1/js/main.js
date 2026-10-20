// Speak & Groove UI: device layout, keys, knobs, round stylophone, touch FX pad, VFD and gestures
import { Engine, LAYERS } from './engine.js';
import { degMidi, A3, NOTE } from './music.js';

const engine = new Engine();
engine.preload();

const $ = (id) => document.getElementById(id);
const device = $('device');
const vfdBig = $('vfdBig');
const vfdInfo = $('vfdInfo');
const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, parent) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
};
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const pair = (a, b) => a + '!'.repeat(Math.max(1, 9 - a.length - b.length)) + b;

const DIMS = { land: [1280, 820], port: [440, 1060] };
const CHANNELS = [
  ['pad', 'PAD'], ['kick', 'KICK'], ['hats', 'HATS'], ['acid', 'ACID 33'], ['clap', 'CLAP'],
  ['arp', 'ARP'], ['perc', 'SWING 60'], ['vox', 'VOX'], ['funk', 'FUNK'], ['stylo', 'STYLO'],
];
const SHORT = { pad: 'PAD', kick: 'KICK', hats: 'HATS', acid: 'ACID', clap: 'CLAP', arp: 'ARP', perc: 'PERC', vox: 'VOX', funk: 'FUNK' };
const KNOBS = [
  ['tempo', 'TEMPO', (v) => String(Math.round(100 + v * 40))],
  ['swing', 'SWING', (v) => String(Math.round(50 + v * 25))],
  ['cutoff', 'CUTOFF', null, 'CUT'],
  ['reso', 'RESO', null],
  ['drive', 'DRIVE', null],
  ['release', 'RELEASE', null, 'REL'],
  ['space', 'SPACE', null],
  ['echo', 'ECHO', null],
];
const DEFAULTS = { ...engine.p };
const FN = {
  erase: ['ERASE', '⌫'], sayit: ['SAY IT', '⏎ enter'], off: ['OFF', 'esc'], hold: ['HOLD', 'tab'],
  less: ['LESS', '↓'], more: ['MORE', '↑'], space: ['', 'space'],
};
const KEYS_LAND = [
  [...'ABCDEFGHIJKLM'],
  [...'NOPQRSTUVWXYZ'],
  [...'1234567890', ['erase', 3]],
  [['off', 1], ['hold', 1], ['less', 1], ['more', 1], ['space', 6], ['sayit', 3]],
];
const KEYS_PORT = [
  [...'ABCDEFG'], [...'HIJKLMN'], [...'OPQRSTU'], [...'VWXYZ', ['erase', 2]],
  [...'1234567'], [...'890', ['space', 4]], [['off', 1], ['hold', 1], ['less', 1], ['more', 1], ['sayit', 3]],
];

let on = false;
let portrait = null;
let scale = 1;
let text = '';
let spell = null;
let info = { text: '', until: 0 };
let chordName = 'AMI7';
const flashUntil = {};
let loopOn = false;
let bootUntil = 0;

/* ---------- layout ---------- */
function layout() {
  const p = innerWidth < innerHeight * 0.9;
  const [dw, dh] = p ? DIMS.port : DIMS.land;
  if (!innerWidth || !innerHeight) return;
  scale = Math.min(innerWidth / dw, innerHeight / dh) * (p ? 0.97 : 0.94);
  const x = (innerWidth - dw * scale) / 2;
  const y = (innerHeight - dh * scale) / 2;
  device.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  if (p !== portrait) {
    portrait = p;
    device.classList.toggle('portrait', p);
    buildKeyboard();
    $('cable').setAttribute('viewBox', `0 0 ${dw} ${dh}`);
  }
  sizeXY();
  placeStylus(true);
}

/* ---------- keyboard ---------- */
function buildKeyboard() {
  const kb = $('keyboard');
  kb.innerHTML = '';
  for (const row of portrait ? KEYS_PORT : KEYS_LAND) {
    for (const item of row) {
      const [k, span] = Array.isArray(item) ? item : [item, 1];
      const b = document.createElement('button');
      b.className = 'key';
      b.tabIndex = -1;
      b.dataset.k = k;
      if (span > 1) b.style.gridColumn = `span ${span}`;
      if (FN[k]) {
        b.classList.add('fn');
        if (k === 'sayit') b.classList.add('say');
        if (k === 'space') b.classList.add('space');
        b.innerHTML = `${FN[k][0]}<small>${FN[k][1]}</small>`;
        b.setAttribute('aria-label', FN[k][0] || 'space');
      } else {
        b.textContent = k;
      }
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('down');
        act(k);
      });
      const up = () => b.classList.remove('down');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('pointercancel', up);
      kb.appendChild(b);
    }
  }
  const hold = kb.querySelector('[data-k="hold"]');
  if (hold) hold.classList.toggle('lit', engine.holding);
}

const keyEl = (k) => $('keyboard').querySelector(`[data-k="${k}"]`);

function mapKey(e) {
  const k = e.key;
  if (k.length === 1 && /[a-z0-9]/i.test(k)) return k.toUpperCase();
  return { ' ': 'space', Enter: 'sayit', Backspace: 'erase', Delete: 'erase', ArrowUp: 'more', ArrowDown: 'less', Tab: 'hold', Escape: 'off', ArrowLeft: 'slower', ArrowRight: 'faster' }[k] || null;
}

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = mapKey(e);
  if (!k) return;
  e.preventDefault();
  if (e.repeat) return;
  const el = keyEl(k);
  if (el) el.classList.add('down');
  act(k);
});
addEventListener('blur', () => document.querySelectorAll('.key.down').forEach((el) => el.classList.remove('down')));
addEventListener('mousedown', (e) => {
  if (e.target.closest && e.target.closest('button')) e.preventDefault();
});
addEventListener('keyup', (e) => {
  const k = mapKey(e);
  if (k && !(e.metaKey || e.ctrlKey || e.altKey)) e.preventDefault();
  const el = k && keyEl(k);
  if (el) el.classList.remove('down');
});

/* ---------- actions ---------- */
function act(k) {
  if (k === 'off' && !on) return;
  const ready = engine.start();
  const wasOff = !on;
  if (wasOff) powerUp();
  ready.then(() => {
    if (wasOff) boot(k === 'power');
    if (k !== 'power' && k !== 'wake') run(k);
    startLoop();
  }).catch((err) => {
    console.error(err);
    showText('ERROR');
    flashInfo('LOAD!FAIL', 4000);
  });
}

function run(k) {
  if (k.length === 1) {
    engine.key(k);
    spell = null;
    text = (text + k).slice(-40);
    renderBig();
    return;
  }
  switch (k) {
    case 'space':
      engine.space();
      text = (text + ' ').slice(-40);
      renderBig();
      break;
    case 'erase':
      engine.erase();
      text = text.slice(0, -1);
      renderBig();
      break;
    case 'sayit':
      engine.sayIt();
      break;
    case 'more':
      engine.more();
      flashInfo('MORE!!!!!');
      break;
    case 'less':
      engine.less();
      flashInfo('LESS!!!!!');
      break;
    case 'hold': {
      const h = engine.toggleHold();
      const el = keyEl('hold');
      if (el) el.classList.toggle('lit', h);
      flashInfo(h ? 'HOLD!!!ON' : 'HOLD!!OFF');
      break;
    }
    case 'off':
      powerDown();
      break;
    case 'slower':
    case 'faster':
      setKnob('tempo', engine.p.tempo + (k === 'faster' ? 1 : -1) / 40);
      break;
  }
  refreshMixer();
}

function powerUp() {
  on = true;
  device.classList.remove('off');
}

function powerDown() {
  if (!on) return;
  if (engine.ready) engine.off();
  on = false;
  text = '';
  spell = null;
  setTimeout(() => {
    if (!on) device.classList.add('off');
    renderBig();
    refreshMixer();
  }, 450);
  refreshMixer();
}

function boot(intro) {
  bootUntil = performance.now() + (intro ? 2000 : 200);
  vfdBig.textContent = '~~~~~~~~~~';
  vfdInfo.textContent = '~~~~~~~~~';
  setTimeout(() => {
    if (intro) {
      engine.intro();
      showText('SPEAK');
      setTimeout(() => showText('AND'), 520);
      setTimeout(() => showText('GROOVE'), 900);
      setTimeout(() => { if (!text) renderBig(); }, 1900);
    } else {
      renderBig();
    }
    renderInfo(true);
  }, intro ? 380 : 140);
  refreshMixer();
  renderDisc();
}

$('power').addEventListener('click', () => {
  if (on) powerDown();
  else act('power');
});

/* ---------- VFD ---------- */
const blankify = (s) => s.replace(/ /g, '!');

function showText(s) {
  vfdBig.textContent = blankify(s.slice(-10).padStart(10, ' '));
}

function renderBig() {
  if (spell) {
    const w = spell.word;
    const pad = Math.max(0, 10 - w.length);
    let html = '!'.repeat(pad);
    w.slice(-10).forEach((c, i) => {
      html += i === spell.i ? `<b>${c}</b>` : i < spell.i ? c : `<i>${c}</i>`;
    });
    vfdBig.innerHTML = html;
    return;
  }
  if (!text) {
    vfdBig.textContent = on ? '!!!!!!!!!_' : '';
    return;
  }
  showText(text);
}

function flashInfo(s, ms = 1300) {
  info = { text: s, until: performance.now() + ms };
  renderInfo(true);
}

function renderInfo(force) {
  const now = performance.now();
  let s;
  if (info.until > now) s = info.text;
  else {
    const bpm = String(Math.round(engine.bpm));
    s = chordName.padEnd(9 - bpm.length, '!') + bpm;
  }
  s = s.padEnd(9, '!').slice(0, 9);
  if (force || vfdInfo.textContent !== s) vfdInfo.textContent = s;
}

const stepsEl = $('steps');
const meterEl = $('meter');
for (let i = 0; i < 16; i++) stepsEl.appendChild(document.createElement('i'));
for (let i = 0; i < LAYERS.length; i++) meterEl.appendChild(document.createElement('i'));
let lastStep = -1;
function renderStep(s) {
  if (lastStep >= 0) stepsEl.children[lastStep].classList.remove('on');
  if (s >= 0) stepsEl.children[s].classList.add('on');
  lastStep = s;
}
function renderMeter() {
  const lv = on ? engine.level : 0;
  const nx = on && engine.pending !== null ? engine.pending : -1;
  [...meterEl.children].forEach((el, i) => {
    el.classList.toggle('on', i < lv);
    el.classList.toggle('next', nx > lv && i === nx - 1);
  });
}

/* ---------- mixer ---------- */
const chEls = {};
for (const [name, label] of CHANNELS) {
  const b = document.createElement('button');
  b.className = 'ch' + (name === 'stylo' ? ' static' : '');
  b.tabIndex = -1;
  b.innerHTML = `<span class="led"></span><span class="lbl">${label}</span>`;
  b.setAttribute('aria-label', label);
  if (name !== 'stylo') {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!on || !engine.ready) return;
      const st = engine.toggle(name);
      flashInfo(pair(SHORT[name], st === 'auto' ? 'AUTO' : st === 'mute' ? 'MUTE' : 'ON'));
      refreshMixer();
    });
  }
  $('mixer').appendChild(b);
  chEls[name] = b;
}

function refreshMixer() {
  for (const name of LAYERS) {
    const el = chEls[name];
    const o = engine.override[name];
    el.classList.toggle('on', on && engine.audible(name));
    el.classList.toggle('muted', o === 'mute');
    el.classList.toggle('forced', o === 'force');
    const nx = engine.pending;
    el.classList.toggle('next', on && nx !== null && nx > engine.level && LAYERS.indexOf(name) === nx - 1 && !o);
  }
  chEls.stylo.classList.toggle('on', on && stylo.playing);
  renderMeter();
}

/* ---------- knobs ---------- */
const defs = svg('svg', { width: 0, height: 0, style: 'position:absolute' }, document.body);
const grad = svg('radialGradient', { id: 'capGrad', cx: '40%', cy: '32%', r: '75%' }, svg('defs', {}, defs));
svg('stop', { offset: '0%', 'stop-color': '#fffdf6' }, grad);
svg('stop', { offset: '70%', 'stop-color': '#eadfc4' }, grad);
svg('stop', { offset: '100%', 'stop-color': '#c9b88f' }, grad);

const knobEls = {};
const ang = (v) => -135 + v * 270;
const polar = (a, r) => [Math.sin((a * Math.PI) / 180) * r, -Math.cos((a * Math.PI) / 180) * r];

for (const [name, label] of KNOBS) {
  const wrap = document.createElement('div');
  wrap.className = 'knob';
  wrap.dataset.k = name;
  const s = svg('svg', { viewBox: '-40 -40 80 80' }, wrap);
  for (let i = 0; i <= 10; i++) {
    const a = ang(i / 10);
    const [x1, y1] = polar(a, 34);
    const [x2, y2] = polar(a, i % 5 === 0 ? 39 : 37);
    svg('line', { class: 'tick', x1, y1, x2, y2 }, s);
  }
  const arc = svg('path', { class: 'arc' }, s);
  svg('circle', { r: 24, cy: 2, fill: 'rgba(60,15,5,.35)' }, s);
  svg('circle', { class: 'cap', r: 24 }, s);
  svg('circle', { class: 'cap-edge', r: 24 }, s);
  const g = svg('g', {}, s);
  svg('line', { class: 'ptr', x1: 0, y1: -9, x2: 0, y2: -20 }, g);
  const l = document.createElement('span');
  l.className = 'lbl';
  l.textContent = label;
  wrap.appendChild(l);
  $('knobs').appendChild(wrap);
  knobEls[name] = { wrap, arc, g };

  let startY = 0, startV = 0;
  wrap.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('active');
    startY = e.clientY;
    startV = engine.p[name];
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!wrap.hasPointerCapture(e.pointerId)) return;
    const k = e.shiftKey ? 0.0015 : 0.005;
    setKnob(name, startV + ((startY - e.clientY) / scale) * k);
  });
  const end = () => wrap.classList.remove('active');
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  wrap.addEventListener('dblclick', () => setKnob(name, DEFAULTS[name]));
  drawKnob(name);
}

function drawKnob(name) {
  const v = engine.p[name];
  const { arc, g } = knobEls[name];
  g.setAttribute('transform', `rotate(${ang(v)})`);
  const [x1, y1] = polar(-135, 30);
  const [x2, y2] = polar(ang(v), 30);
  arc.setAttribute('d', v < 0.004 ? '' : `M${x1} ${y1} A30 30 0 ${v * 270 > 180 ? 1 : 0} 1 ${x2} ${y2}`);
}

function setKnob(name, v, show = true) {
  v = clamp(v);
  engine.set(name, v);
  drawKnob(name);
  if (show && on) {
    const def = KNOBS.find((k) => k[0] === name);
    const lab = def[3] || def[1];
    const val = def[2] ? def[2](v) : String(Math.round(v * 99));
    flashInfo(pair(lab, val));
  }
}

/* ---------- gestures ---------- */
addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!on) return;
  const m = e.deltaMode === 1 ? 16 : 1;
  const dy = e.deltaY * m;
  const dx = e.deltaX * m;
  const kn = e.target.closest && e.target.closest('.knob');
  if (e.ctrlKey) setKnob('space', engine.p.space - dy * 0.008);
  else if (kn) setKnob(kn.dataset.k, engine.p[kn.dataset.k] - dy * 0.002);
  else if (Math.abs(dy) >= Math.abs(dx)) setKnob('cutoff', engine.p.cutoff - dy * 0.0016);
  else setKnob('release', engine.p.release - dx * 0.0016);
}, { passive: false });

let pinchBase = 0;
addEventListener('gesturestart', (e) => { e.preventDefault(); pinchBase = engine.p.space; });
addEventListener('gesturechange', (e) => {
  e.preventDefault();
  if (on) setKnob('space', pinchBase + (e.scale - 1) * 0.6);
});
addEventListener('gestureend', (e) => e.preventDefault());

/* ---------- round stylophone ---------- */
const disc = $('disc');
const discSvg = $('discSvg');
const N_CONTACTS = 15;
const R1 = 52, R2 = 94;
const contacts = [];
const chordDots = [];
const stylo = { playing: false, idx: -1, down: false, hover: false };

function sector(i) {
  const a0 = ((i * 360) / N_CONTACTS - 12 + 0.9) * (Math.PI / 180);
  const a1 = (((i + 1) * 360) / N_CONTACTS - 12 - 0.9) * (Math.PI / 180);
  const p = (a, r) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
  return `M${p(a0, R1)} L${p(a0, R2)} A${R2} ${R2} 0 0 1 ${p(a1, R2)} L${p(a1, R1)} A${R1} ${R1} 0 0 0 ${p(a0, R1)} Z`;
}

for (let i = 0; i < N_CONTACTS; i++) {
  contacts.push(svg('path', { class: 'contact', d: sector(i) }, discSvg));
  const a = ((i * 360) / N_CONTACTS + 0) * (Math.PI / 180);
  const t = svg('text', { class: 'contact-label', x: (Math.sin(a) * 80).toFixed(2), y: (-Math.cos(a) * 80).toFixed(2) }, discSvg);
  t.textContent = NOTE[degMidi(i, A3) % 12];
  chordDots.push(svg('circle', { class: 'chord-dot', r: 2.4, cx: (Math.sin(a) * 61).toFixed(2), cy: (-Math.cos(a) * 61).toFixed(2) }, discSvg));
}

function renderDisc() {
  const pcs = engine.chord.pcs.slice(0, 4);
  chordDots.forEach((d, i) => d.classList.toggle('on', pcs.includes(degMidi(i, A3) % 12)));
}

function discPos(e) {
  const r = disc.getBoundingClientRect();
  const dx = ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 100;
  const dy = ((e.clientY - (r.top + r.height / 2)) / (r.height / 2)) * 100;
  const rad = Math.hypot(dx, dy);
  let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  a = (a + 12 + 360) % 360;
  return { rad, idx: Math.floor(a / (360 / N_CONTACTS)) % N_CONTACTS };
}

function styloAt(e) {
  const { rad, idx } = discPos(e);
  const onRing = rad >= R1 - 2 && rad <= R2 + 4;
  if (stylo.down && onRing && on && engine.ready) {
    if (idx !== stylo.idx || !stylo.playing) {
      const m = degMidi(idx, A3);
      engine.styloOn(m, clamp((rad - R1) / (R2 - R1)), clamp((rad - 84) / 12));
      if (stylo.idx >= 0) contacts[stylo.idx].classList.remove('on');
      contacts[idx].classList.add('on');
      stylo.idx = idx;
      stylo.playing = true;
      flashInfo('STYLO!!' + NOTE[m % 12] + (Math.floor(m / 12) - 1));
      chEls.stylo.classList.add('on');
    } else {
      engine.styloOn(degMidi(idx, A3), clamp((rad - R1) / (R2 - R1)), clamp((rad - 84) / 12));
    }
  } else if (stylo.playing) {
    styloRelease();
  }
  stylusTarget(e);
}

function styloRelease() {
  if (stylo.playing && engine.ready) engine.styloOff();
  if (stylo.idx >= 0) contacts[stylo.idx].classList.remove('on');
  stylo.idx = -1;
  stylo.playing = false;
  chEls.stylo.classList.remove('on');
}

disc.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  disc.setPointerCapture(e.pointerId);
  stylo.down = true;
  if (!on) act('wake');
  const go = () => styloAt(e);
  if (engine.ready) engine.ready.then(go);
  else go();
});
disc.addEventListener('pointermove', (e) => {
  stylo.hover = true;
  styloAt(e);
});
const discUp = () => {
  stylo.down = false;
  styloRelease();
  if (portrait) {
    cableEl.classList.add('away');
    stylusRest();
  }
};
disc.addEventListener('pointerup', discUp);
disc.addEventListener('pointercancel', discUp);
disc.addEventListener('pointerleave', (e) => {
  if (stylo.down) return;
  stylo.hover = false;
  stylusRest();
});

/* ---------- stylus + cable ---------- */
const stylusG = $('stylus');
const cablePath = $('cablePath');
const jack = $('jack');
const cableEl = $('cable');
const st = { x: 0, y: 0, rot: 126, tx: 0, ty: 0, trot: 126, lift: 0, tlift: 0 };
let restPos = { x: 0, y: 0 };
let jackPos = { x: 0, y: 0 };

function toDevice(clientX, clientY) {
  const r = device.getBoundingClientRect();
  return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
}

function placeStylus(snap) {
  const r = disc.getBoundingClientRect();
  const c = toDevice(r.left + r.width / 2, r.top + r.height / 2);
  const rad = r.width / 2 / scale;
  restPos = { x: c.x + rad * 0.8, y: c.y + rad * 0.62 };
  jackPos = { x: c.x + rad * 1.02, y: c.y + rad * 0.98 };
  cableEl.classList.toggle('away', portrait && !stylo.down);
  jack.setAttribute('cx', jackPos.x);
  jack.setAttribute('cy', jackPos.y);
  if (snap || (!stylo.down && !stylo.hover)) {
    st.tx = restPos.x;
    st.ty = restPos.y;
    st.trot = 126;
    st.tlift = 0;
    if (snap) Object.assign(st, { x: st.tx, y: st.ty, rot: st.trot, lift: 0 });
  }
  drawStylus();
}

function stylusTarget(e) {
  const p = toDevice(e.clientX, e.clientY);
  st.tx = p.x;
  st.ty = p.y;
  st.trot = 28;
  st.tlift = stylo.down ? 0 : 1;
  if (stylo.down && cableEl.classList.contains('away')) {
    Object.assign(st, { x: p.x, y: p.y, rot: 28 });
    cableEl.classList.remove('away');
  }
  startLoop();
}

function stylusRest() {
  st.tx = restPos.x;
  st.ty = restPos.y;
  st.trot = 126;
  st.tlift = 0;
  startLoop();
}

function drawStylus() {
  const s = 1 + st.lift * 0.06;
  stylusG.setAttribute('transform', `translate(${st.x.toFixed(1)} ${st.y.toFixed(1)}) rotate(${st.rot.toFixed(1)}) scale(${s.toFixed(3)})`);
  const a = (st.rot * Math.PI) / 180;
  const tail = { x: st.x + Math.sin(a) * 128 * s, y: st.y - Math.cos(a) * 128 * s };
  const sag = 60 + Math.abs(tail.x - jackPos.x) * 0.3;
  const c2x = tail.x + Math.sin(a) * 46;
  const c2y = tail.y - Math.cos(a) * 46 + 50;
  cablePath.setAttribute('d', `M${jackPos.x} ${jackPos.y} C${jackPos.x + 40} ${(jackPos.y + sag).toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${tail.x.toFixed(1)} ${tail.y.toFixed(1)}`);
}

function animateStylus() {
  const k = stylo.down || stylo.hover ? 0.45 : 0.16;
  const dx = st.tx - st.x, dy = st.ty - st.y;
  st.x += dx * k;
  st.y += dy * k;
  st.rot += (st.trot - st.rot) * 0.2;
  st.lift += (st.tlift - st.lift) * 0.25;
  drawStylus();
  return Math.abs(dx) + Math.abs(dy) > 0.3 || Math.abs(st.trot - st.rot) > 0.2 || Math.abs(st.tlift - st.lift) > 0.01;
}

/* ---------- touch FX pad ---------- */
const xyEl = $('xy');
const xyCanvas = $('xyCanvas');
const xc = xyCanvas.getContext('2d');
const xy = { x: 0, y: 0, active: false, trail: [], dirty: true };

function sizeXY() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = xyEl.offsetWidth;
  xyCanvas.width = Math.round(w * scale * dpr);
  xyCanvas.height = Math.round(w * scale * dpr);
  xy.dirty = true;
}

function xyFrom(e) {
  const r = xyEl.getBoundingClientRect();
  xy.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
  xy.y = clamp(1 - (e.clientY - r.top) / r.height);
  xy.trail.push([xy.x, xy.y]);
  if (xy.trail.length > 24) xy.trail.shift();
  xy.dirty = true;
  if (engine.ready) engine.xy(xy.x, xy.y);
  const pct = Math.round(Math.abs(xy.x) * 99);
  flashInfo(Math.abs(xy.x) < 0.04 ? 'FX!!!!!!!' : (xy.x < 0 ? 'LP' : 'HP') + '!'.repeat(7 - String(pct).length) + pct, 900);
  startLoop();
}

xyEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!on) act('wake');
  xyEl.setPointerCapture(e.pointerId);
  xy.active = true;
  xy.trail = [];
  xyFrom(e);
});
xyEl.addEventListener('pointermove', (e) => { if (xy.active) xyFrom(e); });
const xyUp = () => { xy.active = false; startLoop(); };
xyEl.addEventListener('pointerup', xyUp);
xyEl.addEventListener('pointercancel', xyUp);

function animateXY() {
  if (!xy.active && (Math.abs(xy.x) > 0.002 || xy.y > 0.002)) {
    xy.x *= 0.8;
    xy.y *= 0.8;
    if (Math.abs(xy.x) < 0.003) xy.x = 0;
    if (xy.y < 0.003) xy.y = 0;
    if (engine.ready) engine.xy(xy.x, xy.y);
    xy.trail.push([xy.x, xy.y]);
    if (xy.trail.length > 24) xy.trail.shift();
    xy.dirty = true;
  } else if (!xy.active && xy.trail.length) {
    xy.trail.shift();
    xy.dirty = true;
  }
  if (xy.dirty) drawXY();
  return xy.active || xy.dirty || xy.trail.length > 0;
}

function drawXY() {
  xy.dirty = false;
  const W = xyCanvas.width;
  const c = xc;
  c.clearRect(0, 0, W, W);
  c.strokeStyle = 'rgba(140,255,230,0.06)';
  c.lineWidth = Math.max(1, W / 270);
  for (let i = 1; i < 8; i++) {
    const p = (i / 8) * W;
    c.beginPath(); c.moveTo(p, 0); c.lineTo(p, W); c.stroke();
    c.beginPath(); c.moveTo(0, p); c.lineTo(W, p); c.stroke();
  }
  c.strokeStyle = 'rgba(140,255,230,0.16)';
  c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, W); c.stroke();
  const px = (v) => ((v + 1) / 2) * W;
  const py = (v) => (1 - v) * W;
  const tr = xy.trail;
  for (let i = 1; i < tr.length; i++) {
    c.strokeStyle = `rgba(150,255,233,${(i / tr.length) * 0.5})`;
    c.lineWidth = (W / 270) * (1 + (i / tr.length) * 5);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(px(tr[i - 1][0]), py(tr[i - 1][1]));
    c.lineTo(px(tr[i][0]), py(tr[i][1]));
    c.stroke();
  }
  if (xy.active || xy.x !== 0 || xy.y !== 0) {
    const x = px(xy.x), y = py(xy.y), r = (W / 270) * 9;
    const g = c.createRadialGradient(x, y, 0, x, y, r * 4);
    g.addColorStop(0, 'rgba(160,255,235,0.55)');
    g.addColorStop(1, 'rgba(160,255,235,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r * 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#eafffa';
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
}

/* ---------- event loop ---------- */
function handle(ev) {
  switch (ev.type) {
    case 'step':
      renderStep(ev.data.s);
      break;
    case 'hit':
      flashUntil[ev.data] = performance.now() + 90;
      chEls[ev.data].classList.add('flash');
      break;
    case 'say': {
      const el = keyEl(ev.data);
      if (el) {
        el.classList.remove('spoke');
        void el.offsetWidth;
        el.classList.add('spoke');
      }
      break;
    }
    case 'spell':
      spell = { word: engine.word.length ? engine.word.slice() : engine.typed.slice(-8), i: ev.data.i };
      if (ev.data.i >= ev.data.n - 1) setTimeout(() => { spell = null; renderBig(); }, 420);
      renderBig();
      break;
    case 'level': {
      const lv = ev.data;
      if (on && lv > 0 && prevLevel !== lv) {
        const name = LAYERS[Math.max(lv, prevLevel) - 1];
        const word = SHORT[name];
        const tag = lv > prevLevel ? 'IN' : 'OUT';
        flashInfo(pair(word, tag), 1500);
      }
      prevLevel = lv;
      refreshMixer();
      break;
    }
    case 'pending':
      refreshMixer();
      break;
    case 'chord':
      chordName = ev.data;
      renderInfo();
      renderDisc();
      break;
    case 'run':
      if (!ev.data) renderStep(-1);
      break;
  }
}
let prevLevel = 0;

function frame() {
  const ctx = engine.ctx;
  if (ctx) {
    const now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    const q = engine.events;
    while (q.length && q[0].t <= now) handle(q.shift());
  }
  const t = performance.now();
  for (const k in flashUntil) {
    if (flashUntil[k] < t) {
      chEls[k].classList.remove('flash');
      delete flashUntil[k];
    }
  }
  if (on) {
    renderInfo();
    if (!text && !spell && t > bootUntil) {
      const cur = Math.floor(t / 530) % 2 ? '!!!!!!!!!_' : '!!!!!!!!!!';
      if (vfdBig.textContent !== cur) vfdBig.textContent = cur;
    }
  }
  const moving = animateStylus();
  const xyBusy = animateXY();
  const audioBusy = on || (ctx && engine.running);
  if (audioBusy || moving || xyBusy || Object.keys(flashUntil).length) requestAnimationFrame(frame);
  else loopOn = false;
}

function startLoop() {
  if (loopOn) return;
  loopOn = true;
  requestAnimationFrame(frame);
}

addEventListener('resize', layout);
addEventListener('orientationchange', () => setTimeout(layout, 200));
document.fonts && document.fonts.ready.then(() => { layout(); renderBig(); });
layout();
for (const [name] of KNOBS) drawKnob(name);
renderInfo(true);
renderDisc();
refreshMixer();
drawXY();
vfdBig.textContent = '';
vfdInfo.textContent = '';
window.__sg = { engine, act, refresh: refreshMixer };
