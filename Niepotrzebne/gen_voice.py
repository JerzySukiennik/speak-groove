# Speak & Groove voice builder: macOS `say` -> 8 kHz LPC-10 frames (TMS5100 style) -> assets/voice.json
import json, os, subprocess, sys, warnings
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly, medfilt

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets", "voice.json")
TMP = os.path.join(HERE, "say")
VOICE = "Reed (English (US))"
RATE = 175
FS = 8000
HOP = 200
WIN = 240
ORDER = 10
PRE = 0.9375

TOKENS = {c: c for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"}
TOKENS.update({str(i): w for i, w in enumerate("zero one two three four five six seven eight nine".split())})
TOKENS.update({
    "erase": "erase", "sayit": "say it", "more": "more", "less": "less", "hold": "hold",
    "off": "off", "intro": "speak and groove", "space": "space",
})
VOX = {"hah": "Haaah", "hoo": "Hooo", "hey": "Heyyy", "hee": "Heee", "huh": "Huuuh"}


def render(text, name):
    path = os.path.join(TMP, name + ".wav")
    subprocess.run(["say", "-v", VOICE, "-r", str(RATE), "-o", path, "--file-format=WAVE",
                    "--data-format=LEI16@16000", text], check=True)
    sr, x = wavfile.read(path)
    x = x.astype(np.float64) / 32768.0
    x = resample_poly(x, 1, 2)
    a = np.abs(x)
    env = np.convolve(a, np.ones(80) / 80, "same")
    idx = np.where(env > env.max() * 0.012)[0]
    s, e = max(0, idx[0] - 80), min(len(x), idx[-1] + 160)
    return x[s:e]


def levinson(r):
    a = np.zeros(ORDER + 1); a[0] = 1.0
    k = np.zeros(ORDER)
    err = r[0]
    for i in range(1, ORDER + 1):
        acc = r[i] + np.dot(a[1:i], r[i - 1:0:-1])
        ki = -acc / err
        a_prev = a.copy()
        for j in range(1, i):
            a[j] = a_prev[j] + ki * a_prev[i - j]
        a[i] = ki
        k[i - 1] = ki
        err *= (1 - ki * ki)
    return k, err


def pitch_track(x):
    n = len(x) // HOP + 1
    f0 = np.zeros(n); conf = np.zeros(n)
    lo, hi = int(FS / 320), int(FS / 65)
    for i in range(n):
        c = i * HOP
        seg = x[max(0, c - 200):c + 200]
        if len(seg) < 300:
            continue
        seg = seg - seg.mean()
        cl = 0.3 * np.abs(seg).max()
        seg = np.where(seg > cl, seg - cl, np.where(seg < -cl, seg + cl, 0))
        r = np.correlate(seg, seg, "full")[len(seg) - 1:]
        if r[0] <= 0:
            continue
        r = r / r[0]
        lag = lo + np.argmax(r[lo:hi])
        conf[i] = r[lag]
        f0[i] = FS / lag
    return f0, conf


def quant(v, bits):
    q = 2 ** (bits - 1)
    return np.round(np.clip(v, -0.995, 0.995) * q) / q


def analyse(x, vox=False):
    pitch, conf = pitch_track(x)
    y = np.append(x[0], x[1:] - PRE * x[:-1])
    w = np.hamming(WIN)
    n = len(x) // HOP + 1
    pad = np.pad(y, (WIN, WIN))
    rms_raw = np.array([np.sqrt(np.mean(x[max(0, i * HOP - 120):i * HOP + 120] ** 2) + 1e-12) for i in range(n)])
    zcr = np.array([np.mean(np.abs(np.diff(np.sign(x[max(0, i * HOP - 120):i * HOP + 120])))) / 2 if i * HOP < len(x) else 1 for i in range(n)])
    lagwin = np.exp(-0.5 * (2 * np.pi * 50 * np.arange(ORDER + 1) / FS) ** 2)
    frames = []
    for i in range(n):
        seg = pad[i * HOP + WIN - WIN // 2: i * HOP + WIN + WIN // 2] * w
        r = np.array([np.dot(seg[:WIN - j], seg[j:]) for j in range(ORDER + 1)]) * lagwin
        r[0] *= 1.0001
        if r[0] < 1e-9:
            frames.append([0, 0.0, 0.0] + [0.0] * ORDER)
            continue
        k, err = levinson(r)
        sigma = np.sqrt(max(err, 0) / np.sum(w * w))
        voiced = rms_raw[i] > rms_raw.max() * 0.04 and (zcr[i] < 0.2 or (conf[i] > 0.38 and zcr[i] < 0.3))
        frames.append([1 if voiced else 0, sigma * (1.0 if voiced else 1.5), pitch[i] if (voiced and conf[i] > 0.3) else 0.0] + list(k))
    frames = np.array(frames, dtype=np.float64)
    v = frames[:, 0] > 0
    if v.sum() >= 3:
        v2 = medfilt(v.astype(float), 3) > 0
        frames[:, 0] = v2
        p = frames[:, 2].copy()
        p[~v2] = 0
        ps = medfilt(p, 5)
        ps[~v2] = 0
        med = np.median(ps[v2 & (ps > 0)]) if np.any(v2 & (ps > 0)) else 110.0
        frames[:, 2] = np.where(v2, np.clip(np.where(ps > 0, ps / med, 1.0), 0.6, 1.6), 0.0)
    else:
        frames[:, 2] = np.where(v, 1.0, 0.0)
    for j in range(ORDER):
        frames[:, 3 + j] = quant(frames[:, 3 + j], 6 if j < 2 else (5 if j < 5 else 4))
    sig = frames[:, 1]
    if sig.max() > 0:
        db = 20 * np.log10(sig / sig.max() + 1e-6)
        db = np.round(np.clip(db, -36, 0) / 2.4) * 2.4
        frames[:, 1] = np.where(sig > sig.max() * 0.012, 10 ** (db / 20), 0)
    while len(frames) > 2 and frames[-1, 1] == 0 and frames[-2, 1] == 0:
        frames = frames[:-1]
    sustain = 0
    if vox:
        vv = frames[:, 0] > 0
        best, bs, cur, cs = 0, 0, 0, 0
        for i, b in enumerate(vv):
            if b:
                if cur == 0:
                    cs = i
                cur += 1
                if cur > best:
                    best, bs = cur, cs
            else:
                cur = 0
        sustain = bs + best // 2
    return frames, sustain


CHIRP = None


def chirp():
    n = np.arange(28)
    c = np.exp(-n / 5.5) * np.cos(np.pi * n * (0.62 - n / 70.0))
    c[0] = 1.0
    return c / np.sqrt(np.sum(c * c))


def step_up(k):
    a = np.zeros(ORDER + 1); a[0] = 1.0
    for i in range(1, ORDER + 1):
        prev = a.copy()
        for j in range(1, i):
            a[j] = prev[j] + k[i - 1] * prev[i - j]
        a[i] = k[i - 1]
    return a


def synth(frames, f0=120.0, contour=0.35):
    ch = chirp()
    out = []
    hist = np.zeros(ORDER)
    de = 0.0
    phase, cpos = 0.0, 999
    rng = np.random.default_rng(1)
    last = frames[-1].copy()
    last[1] = 0
    fr = np.vstack([frames, last])
    for i in range(len(fr) - 1):
        A, B = fr[i], fr[i + 1]
        for s in range(HOP):
            t = s / HOP
            if s % 25 == 0:
                p = A if (A[0] != B[0]) else A + (B - A) * t
                a = step_up(p[3:])
                sig = A[1] + (B[1] - A[1]) * t
                voiced = A[0] > 0
                ratio = p[2] if p[2] > 0 else 1.0
                period = FS / (f0 * ratio ** contour)
            if voiced:
                phase += 1
                if phase >= period:
                    phase -= period
                    cpos = 0
                e = (ch[cpos] if cpos < len(ch) else 0.0) * sig * np.sqrt(period)
                cpos += 1
                e += rng.standard_normal() * sig * 0.12
            else:
                e = rng.standard_normal() * sig
            y = e - np.dot(a[1:], hist)
            hist = np.roll(hist, 1); hist[0] = y
            de = y + 0.85 * de
            out.append(de)
    return np.array(out)


def main():
    os.makedirs(TMP, exist_ok=True)
    data = {"fs": FS, "hop": HOP, "order": ORDER, "chirp": [round(v, 4) for v in chirp()], "tokens": {}}
    demo = []
    for name, text in list(TOKENS.items()) + list(VOX.items()):
        x = render(text, name)
        frames, sustain = analyse(x, name in VOX)
        y = synth(frames)
        peak = np.abs(y).max() + 1e-9
        frames[:, 1] *= 0.5 / peak
        rows = [[int(f[0]), round(float(f[1]), 5), round(float(f[2]), 3)] + [round(float(v), 4) for v in f[3:]] for f in frames]
        data["tokens"][name] = {"f": rows, "s": int(sustain)}
        if name in "SPEAKGROOVE" or name in ("intro", "hah", "hoo", "7"):
            demo.append(synth(frames) * 0.5 / peak)
            demo.append(np.zeros(1200))
        print(f"{name:6s} frames={len(rows):3d} voiced={int(frames[:,0].sum()):3d} sustain={sustain}")
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    d = np.concatenate(demo)
    wavfile.write(os.path.join(HERE, "voice-demo.wav"), FS, (np.clip(d, -1, 1) * 32000).astype(np.int16))
    print("bytes", os.path.getsize(OUT))


if __name__ == "__main__":
    main()
