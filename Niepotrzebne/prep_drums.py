# Trim + peak-normalize freesound CC0 previews into assets/drums
import sys, numpy as np
from scipy.io import wavfile
src, dst = sys.argv[1], sys.argv[2]
MAP = {"kick2": "kick", "clap1": "clap", "chh1": "hat", "ohh4": "openhat", "rim1": "rim", "cym3": "crash",
       "cymrev1": "cymverb", "snare1": "snare", "conga": "conga", "congalow": "congalow", "shaker": "shaker"}
for a, b in MAP.items():
    sr, x = wavfile.read(f"{src}/{a}.wav"); x = x.astype(np.float64) / 32768
    pk = np.abs(x).max()
    on = np.argmax(np.abs(x) > pk * 0.003) if b != "riser" else 0
    env = np.convolve(np.abs(x), np.ones(441) / 441, "same")
    end = np.where(env > pk * 0.0015)[0][-1] + 441
    y = x[max(0, on - 8):min(len(x), end)]
    fade = min(len(y) // 4, 2205)
    y[-fade:] *= np.linspace(1, 0, fade) ** 2
    y = y / np.abs(y).max() * 0.89
    wavfile.write(f"{dst}/{b}.wav", sr, (y * 32767).astype(np.int16))
    print(b, f"{len(y)/sr:.2f}s")
