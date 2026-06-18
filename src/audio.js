// Audio: real .wav files (synthesized in tools/gen-audio.mjs, served from
// /public/sfx) for the crowd, plus tiny synth blips for ball/whistle. The crowd
// loop runs continuously and its volume is driven by on-pitch tension.
let ctx = null;
let master = null;
let crowdGain = null;
let crowdBase = 0.18; // resting murmur level
const buffers = {}; // name -> AudioBuffer
let loading = false;
let crowdStarted = false;
let crowdMuted = false; // silenced while the game is paused
let crowdOff = localStorage.getItem("wcj-crowd-off") !== "0"; // user setting; default off
let sfxOff = localStorage.getItem("wcj-sfx-off") === "1"; // mute ball/goal/whistle sounds
let lastOoh = -10;

function crowdSilent() {
  return crowdMuted || crowdOff;
}

function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
  }
  if (ctx && ctx.state === "suspended") ctx.resume();
  return ctx;
}

async function loadAll() {
  const a = ac();
  if (!a || loading) return;
  loading = true;
  const names = ["crowd-loop", "cheer", "ooh"];
  await Promise.all(
    names.map(async (n) => {
      try {
        const res = await fetch(`/sfx/${n}.wav`);
        const arr = await res.arrayBuffer();
        buffers[n] = await a.decodeAudioData(arr);
      } catch {
        /* ignore — keeps the game silent rather than crashing */
      }
    })
  );
  startCrowd();
}

function startCrowd() {
  const a = ac();
  if (!a || crowdStarted || !buffers["crowd-loop"]) return;
  crowdStarted = true;
  const src = a.createBufferSource();
  src.buffer = buffers["crowd-loop"];
  src.loop = true;
  crowdGain = a.createGain();
  crowdGain.gain.value = crowdSilent() ? 0 : crowdBase;
  src.connect(crowdGain).connect(master);
  src.start();
}

function playBuffer(name, vol = 1) {
  const a = ac();
  if (!a || !buffers[name]) return;
  const src = a.createBufferSource();
  src.buffer = buffers[name];
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start();
}

function tone(freq, dur, type = "square", vol = 0.15, slideTo = null) {
  const a = ac();
  if (!a || sfxOff) return;
  const t0 = a.currentTime;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(master || a.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

export const Sfx = {
  kick: () => tone(190, 0.08, "square", 0.16, 95),
  pass: () => tone(150, 0.06, "square", 0.1, 120),
  wall: () => tone(95, 0.05, "triangle", 0.08),
  whistle: () => tone(1200, 0.18, "sine", 0.12, 1500),
  // A committed lunge — a short downward whoosh.
  lunge: () => tone(260, 0.09, "triangle", 0.07, 70),
  // A won steal — a bright two-note "ding" so a turnover reads instantly.
  steal: () => {
    tone(640, 0.05, "square", 0.16, 300);
    setTimeout(() => tone(900, 0.09, "square", 0.13, 1100), 55);
  },

  // Crowd tension, 0..1 — louder as the ball nears a goal / a chance builds.
  setIntensity(level) {
    if (!crowdGain || !ctx || crowdSilent()) return;
    const target = crowdBase + clamp01(level) * 0.55;
    crowdGain.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
  },
  // Mute/unmute the ambient crowd loop — used to fall silent while paused.
  setCrowdMuted(muted) {
    crowdMuted = muted;
    if (!crowdGain || !ctx) return;
    crowdGain.gain.setTargetAtTime(crowdSilent() ? 0 : crowdBase, ctx.currentTime, 0.15);
  },
  setCrowdOff(off) {
    crowdOff = off;
    localStorage.setItem("wcj-crowd-off", off ? "1" : "0");
    if (!crowdGain || !ctx) return;
    crowdGain.gain.setTargetAtTime(crowdSilent() ? 0 : crowdBase, ctx.currentTime, 0.15);
  },
  get crowdOff() {
    return crowdOff;
  },
  // Anticipation "ooh" for a chance/near-miss (rate-limited).
  ooh() {
    if (!ctx || sfxOff) return;
    if (ctx.currentTime - lastOoh < 1.2) return;
    lastOoh = ctx.currentTime;
    playBuffer("ooh", 0.9);
  },
  // Goal roar.
  goal() {
    if (sfxOff) return;
    playBuffer("cheer", 1);
    tone(440, 0.12, "square", 0.14);
    setTimeout(() => tone(660, 0.12, "square", 0.14), 110);
    setTimeout(() => tone(880, 0.22, "square", 0.14), 220);
  },
  cheer() { if (!sfxOff) playBuffer("cheer", 1); },
  setSfxOff(off) {
    sfxOff = off;
    localStorage.setItem("wcj-sfx-off", off ? "1" : "0");
  },
  get sfxOff() {
    return sfxOff;
  },

  resume() {
    ac();
    if (!loading) loadAll();
    else startCrowd();
  },
};

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
