// Offline render of js/lpc-worklet.js with a mocked AudioWorkletGlobalScope -> WAV for ASR checks
import fs from 'fs';
const SR = 48000;
let Proc = null;
globalThis.sampleRate = SR;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null }; } };
globalThis.registerProcessor = (n, c) => { Proc = c; };
await import('../js/lpc-worklet.js');
const voice = JSON.parse(fs.readFileSync(new URL('../assets/voice.json', import.meta.url)));
const p = new Proc({ processorOptions: { voices: 3 } });
p.port.onmessage({ data: { type: 'init', ...voice } });
const [outPath, ...tokens] = process.argv.slice(2);
const total = Math.ceil((1 + tokens.length * 0.75) * SR / 128) * 128;
const out = new Float32Array(total);
tokens.forEach((t, i) => p.port.onmessage({ data: { type: 'play', token: t, time: 1 + i * 0.75, f0: [110, 123, 131, 147, 165][i % 5] } }));
const buf = new Float32Array(128);
for (let i = 0; i < total; i += 128) {
  globalThis.currentTime = i / SR;
  p.process([], [[buf]]);
  out.set(buf, i);
}
let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
const pcm = Buffer.alloc(44 + total * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + total * 2, 4); pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(total * 2, 40);
for (let i = 0; i < total; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i] / Math.max(peak, 1e-6) * 0.8)) * 32767), 44 + i * 2);
fs.writeFileSync(outPath, pcm);
console.log('peak', peak.toFixed(3), 'nan', out.some(Number.isNaN));
