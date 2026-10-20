# Speak & Groove

A talking toy groovebox in the spirit of the 1978 spelling toy. Press a key and an 8 kHz LPC robot voice spells it through a big reverb. Keep typing and a techno band joins in, one layer every two bars, following what you type. Stop typing and it peels back down to the pad and the reverb tail.

## Play

- **Letters and digits**: the voice says them. A to G are literally their notes in A minor, the rest of the alphabet keeps climbing the scale.
- What you type steers the music: the last letter picks the next chord, the last 16 letters become the acid bassline and the arpeggio, vowels choose the vox chop (A = "hah", O = "hoo", E = "hey"...).
- **Enter / SAY IT**: the robot spells the current word on the beat.
- **Backspace / ERASE**, **Space** starts a new word.
- **↑ MORE / ↓ LESS**: force a layer in or out at the next bar. **Tab / HOLD** freezes the build. **Esc / OFF** powers down.
- **← →**: tempo.
- **Mixer LEDs**: click to mute a playing layer or force a silent one on, click again for auto.
- **Round stylophone**: press and drag around the ring. Outer edge adds vibrato.
- **Touch FX pad**: left is low-pass, right is high-pass, up adds resonance and a dub echo throw. Springs back on release.
- **Trackpad**: two-finger scroll up/down is the acid cutoff, sideways is the amp release, pinch is the reverb space.
- **Knobs**: drag up/down (Shift for fine), scroll over a knob, double-click to reset.

Layers in build order: pad, kick, hats, acid 33 (303 style bassline), clap, arpeggiator, swing 60 percussion (MPC style), vox chops, funk clav.

## How it works

- `js/lpc-worklet.js`: LPC-10 speech synthesis at 8 kHz (TMS5100 style lattice, chirp excitation, 8.6 bit output) running in an AudioWorklet, so the voice can sing any pitch with the formants intact.
- `assets/voice.json`: per-letter LPC frames, built by `Niepotrzebne/gen_voice.py` from macOS `say` (voice Reed). Checked with Whisper: the alphabet and digits come back right.
- `js/engine.js`: Web Audio graph, lookahead scheduler on a worker clock, energy-driven build-up, all synths.
- `js/music.js`: key, chords, pattern generators.
- `js/main.js`: the device UI.

No build step. Serve the folder over http (AudioWorklet needs it), e.g. `python3 -m http.server`.

## Credits

- Drum one-shots: "TR-909 Drum Hits" pack by GRD-music- on freesound.org (CC0). Conga and shaker by sgossner (CC0), low conga by Uberproduktion (CC0).
- VFD font: DSEG14 by keshikan, SIL Open Font License 1.1 (`assets/fonts/DSEG-LICENSE.txt`).
- UI font: Archivo (Google Fonts, OFL).
