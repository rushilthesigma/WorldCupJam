// Procedurally synthesizes the crowd audio as real .wav files (no copyrighted
// recordings). A stadium murmur is "babble noise": many independent voices, each
// band-limited noise around a vowel formant with its own slow amplitude drift.
// Summed, dozens of these wash into a convincing crowd. Run: node tools/gen-audio.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SR = 22050;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "sfx");
fs.mkdirSync(OUT, { recursive: true });

const rnd = (a = 1) => (Math.random() * 2 - 1) * a;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// State-variable band-pass filter applied sample-by-sample (returns band output).
function makeSVF(fc, q) {
  let low = 0, band = 0;
  const f = 2 * Math.sin((Math.PI * fc) / SR);
  const damp = 1 / q;
  return (x) => {
    low += f * band;
    const high = x - low - damp * band;
    band += f * high;
    return band;
  };
}

// A smooth random control curve (linear-interpolated control points).
function smoothEnv(len, hz, lo, hi) {
  const step = Math.max(1, (SR / hz) | 0);
  const out = new Float32Array(len);
  let prev = lo + Math.random() * (hi - lo);
  let next = lo + Math.random() * (hi - lo);
  let i = 0;
  while (i < len) {
    for (let j = 0; j < step && i < len; j++, i++) {
      out[i] = prev + (next - prev) * (j / step);
    }
    prev = next;
    next = lo + Math.random() * (hi - lo);
  }
  return out;
}

function babble(seconds, { voices, fLo, fHi, q, swellHz, bright }) {
  const len = (seconds * SR) | 0;
  const buf = new Float32Array(len);
  for (let v = 0; v < voices; v++) {
    const fc = fLo + Math.random() * (fHi - fLo);
    const bp = makeSVF(fc, q);
    const env = smoothEnv(len, swellHz * (0.6 + Math.random()), 0.05, 1);
    const gain = 0.8 + Math.random() * 0.6;
    for (let i = 0; i < len; i++) {
      buf[i] += bp(rnd()) * env[i] * gain;
    }
  }
  // gentle low rumble bed (many bodies)
  const rb = makeSVF(90, 0.7);
  for (let i = 0; i < len; i++) buf[i] += rb(rnd()) * 0.6;
  // optional brightness (distant whistles / excitement)
  if (bright) {
    const wb = makeSVF(2600, 6);
    const wenv = smoothEnv(len, 1.5, 0, 1);
    for (let i = 0; i < len; i++) buf[i] += wb(rnd()) * wenv[i] * bright;
  }
  lowpass(buf, 3200); // warm it up, kill hiss
  return buf;
}

// One-pole low-pass to take the hiss off and leave a warm crowd wash.
function lowpass(buf, fc) {
  const a = Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = y * a + buf[i] * (1 - a);
    buf[i] = y;
  }
  return buf;
}

// Sprinkle short individual shouts/whistles over a buffer for life.
function shouts(buf, count, { fLo = 300, fHi = 1100, amp = 0.5 } = {}) {
  for (let c = 0; c < count; c++) {
    const dur = ((0.12 + Math.random() * 0.22) * SR) | 0;
    const at = (Math.random() * (buf.length - dur - 1)) | 0;
    const bp = makeSVF(fLo + Math.random() * (fHi - fLo), 8);
    const a = amp * (0.5 + Math.random() * 0.6);
    for (let i = 0; i < dur; i++) buf[at + i] += bp(rnd()) * Math.sin((Math.PI * i) / dur) * a;
  }
  return buf;
}

function normalize(buf, peak = 0.7) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] / m) * peak;
  return buf;
}

// Make a seamless loop: synth a bit extra, then equal-power crossfade the tail
// back over the head so the loop point is click-free.
function seamless(seconds, opts) {
  const cf = 0.5; // crossfade seconds
  const total = babble(seconds + cf, opts);
  const len = (seconds * SR) | 0;
  const cfn = (cf * SR) | 0;
  shouts(total, (seconds * 2.5) | 0, { fLo: 300, fHi: 1000, amp: 0.4 });
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = total[i];
  for (let i = 0; i < cfn; i++) {
    const t = i / cfn;
    const a = Math.cos((t * Math.PI) / 2); // head fades in over the fold
    const b = Math.sin((t * Math.PI) / 2); // tail fades out
    out[i] = out[i] * a + total[len + i] * b;
  }
  return normalize(out, 0.6);
}

// A goal roar: louder, brighter babble that rises then sustains, plus claps.
function cheer(seconds = 3) {
  const len = (seconds * SR) | 0;
  const buf = babble(seconds, { voices: 40, fLo: 350, fHi: 1500, q: 2.5, swellHz: 4, bright: 0.5 });
  // clap transients
  for (let c = 0; c < 220; c++) {
    const at = (Math.random() * (len - 600)) | 0;
    const amp = 0.3 + Math.random() * 0.5;
    for (let i = 0; i < 220; i++) buf[at + i] += rnd() * amp * Math.exp(-i / 40);
  }
  // overall envelope: fast rise, long fall
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const env = clamp(t / 0.12, 0, 1) * Math.pow(1 - t, 0.6);
    buf[i] *= env;
  }
  return normalize(buf, 0.85);
}

// An anticipation "ooh" swell for a near-miss / chance.
function ooh(seconds = 1.6) {
  const len = (seconds * SR) | 0;
  const buf = babble(seconds, { voices: 26, fLo: 280, fHi: 700, q: 3, swellHz: 2 });
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const env = Math.sin(Math.PI * Math.min(1, t * 1.1)) * (1 - t * 0.3);
    buf[i] *= env;
  }
  return normalize(buf, 0.7);
}

function writeWav(name, data) {
  const n = data.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = clamp(data[i], -1, 1);
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  const p = path.join(OUT, name);
  fs.writeFileSync(p, buf);
  console.log("wrote", p, (buf.length / 1024).toFixed(0) + "KB");
}

console.log("synthesizing crowd audio...");
writeWav("crowd-loop.wav", seamless(9, { voices: 44, fLo: 230, fHi: 1050, q: 3, swellHz: 0.5, bright: 0.1 }));
writeWav("cheer.wav", cheer(3));
writeWav("ooh.wav", ooh(1.6));
console.log("done");
