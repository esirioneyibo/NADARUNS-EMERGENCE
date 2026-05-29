"""Generate distinct short notification tones (WAV) for NadaRuns alerts.

Pure stdlib (wave/struct/math) so it runs anywhere. Each sound is a short,
clean multi-tone chime with a smooth attack/decay envelope.
"""
import math
import os
import struct
import wave

OUT_DIR = "/app/frontend/assets/sounds"
os.makedirs(OUT_DIR, exist_ok=True)

SAMPLE_RATE = 44100
AMPLITUDE = 0.42


def note(freq, dur, sr=SAMPLE_RATE):
    """A single tone with attack/decay envelope; returns list of float samples."""
    n = int(sr * dur)
    out = []
    attack = int(0.012 * sr)
    release = int(0.10 * sr)
    for i in range(n):
        # envelope
        if i < attack:
            env = i / attack
        elif i > n - release:
            env = max(0.0, (n - i) / release)
        else:
            env = 1.0
        # base tone + subtle 2nd harmonic for a "chime" timbre
        s = math.sin(2 * math.pi * freq * i / sr)
        s += 0.25 * math.sin(2 * math.pi * 2 * freq * i / sr)
        out.append(s * env)
    return out


def silence(dur, sr=SAMPLE_RATE):
    return [0.0] * int(sr * dur)


def write_wav(name, samples):
    path = os.path.join(OUT_DIR, name)
    # normalize
    peak = max((abs(s) for s in samples), default=1.0) or 1.0
    scale = AMPLITUDE / peak
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for s in samples:
            v = int(max(-1.0, min(1.0, s * scale)) * 32767)
            frames += struct.pack("<h", v)
        w.writeframes(bytes(frames))
    print("wrote", path, f"({len(samples)/SAMPLE_RATE:.2f}s)")


def seq(*parts):
    out = []
    for p in parts:
        out += p
    return out


# Musical note frequencies
C5, D5, E5, F5, G5, A5, B5, C6, E6, G6 = (
    523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5, 1318.5, 1568.0,
)

# 1) NEW JOB (driver) — urgent attention double-beep, bright + repeated
write_wav("new_job.wav", seq(
    note(G6, 0.10), silence(0.05), note(G6, 0.10), silence(0.04), note(C6, 0.16),
))

# 2) JOB ACCEPTED (driver) — confident ascending triad
write_wav("job_accepted.wav", seq(
    note(C5, 0.10), note(E5, 0.10), note(G5, 0.22),
))

# 3) DRIVER ASSIGNED (shipper) — pleasant friendly two-note up chime
write_wav("driver_assigned.wav", seq(
    note(E5, 0.12), note(B5, 0.26),
))

# 4) ARRIVED AT PICKUP (shipper/driver) — soft single ding
write_wav("arrived_pickup.wav", seq(
    note(A5, 0.10), note(E6, 0.22),
))

# 5) ARRIVED AT DROPOFF (shipper/driver) — soft double ding (distinct from pickup)
write_wav("arrived_dropoff.wav", seq(
    note(E6, 0.10), silence(0.04), note(E6, 0.10), silence(0.03), note(A5, 0.16),
))

# 6) DELIVERED / SUCCESS — celebratory ascending run
write_wav("delivered.wav", seq(
    note(C5, 0.09), note(E5, 0.09), note(G5, 0.09), note(C6, 0.26),
))

print("DONE")
