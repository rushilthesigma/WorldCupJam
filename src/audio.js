// Audio: real .wav files (synthesized in tools/gen-audio.mjs, served from
// /public/sfx) for the crowd, plus tiny synth blips for ball/whistle. The crowd
// loop runs continuously and its volume is driven by on-pitch tension.
let ctx = null;
let master = null;
let crowdGain = null;
let crowdBase = 0.18; // resting murmur level
let crowdBoost = 1; // stadium loudness multiplier (>1 = raucous ground, e.g. AFC qualifying)
const buffers = {}; // name -> AudioBuffer
let loading = false;
let crowdStarted = false;
let crowdMuted = false; // silenced while the game is paused
let crowdOff = localStorage.getItem("wcj-crowd-off") === "1"; // user setting; default ON (only an explicit mute silences it)
let sfxOff = localStorage.getItem("wcj-sfx-off") === "1"; // mute ball/goal/whistle sounds
let lastOoh = -10;

// Master volume 0..1 — overall loudness of the whole bus (crowd + sfx). Persisted;
// defaults to full. The master gain node sits at MASTER_BASE * masterVol so a full
// setting keeps the old headroom (0.9) and 0 is a hard mute.
const MASTER_BASE = 0.9;
let masterVol = (() => {
  const v = parseFloat(localStorage.getItem("wcj-master-vol"));
  return isNaN(v) ? 1 : clamp01(v);
})();

function crowdSilent() {
  return crowdMuted || crowdOff;
}

// Resting (no-tension) crowd level, scaled by the loudness boost and capped to
// stay just under unity so a boosted ground doesn't hard-clip the master bus.
function restingGain() {
  return crowdSilent() ? 0 : Math.min(0.97, crowdBase * crowdBoost);
}

function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = MASTER_BASE * masterVol;
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
        // Base-aware: under GitHub Pages the app is served from /WorldCupJam/,
        // so /sfx/* (root-absolute) 404s. import.meta.env.BASE_URL is "/" in dev
        // without a base and "/WorldCupJam/" in the deploy — both end in a slash.
        const res = await fetch(`${import.meta.env.BASE_URL}sfx/${n}.wav`);
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
  crowdGain.gain.value = restingGain();
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
    const target = Math.min(0.97, (crowdBase + clamp01(level) * 0.55) * crowdBoost);
    crowdGain.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
  },
  // Mute/unmute the ambient crowd loop — used to fall silent while paused.
  setCrowdMuted(muted) {
    crowdMuted = muted;
    if (!crowdGain || !ctx) return;
    crowdGain.gain.setTargetAtTime(restingGain(), ctx.currentTime, 0.15);
  },
  setCrowdOff(off) {
    crowdOff = off;
    localStorage.setItem("wcj-crowd-off", off ? "1" : "0");
    if (!crowdGain || !ctx) return;
    crowdGain.gain.setTargetAtTime(restingGain(), ctx.currentTime, 0.15);
  },
  get crowdOff() {
    return crowdOff;
  },
  // Live crowd-audio introspection (used by the __wcj test hook).
  get crowdState() {
    return {
      off: crowdOff,
      muted: crowdMuted,
      silent: crowdSilent(),
      started: crowdStarted,
      loaded: !!buffers["crowd-loop"],
      ctxState: ctx ? ctx.state : null,
      gain: crowdGain ? +crowdGain.gain.value.toFixed(3) : null,
    };
  },
  // Scale the whole stadium — resting murmur, tension swell, and goal roar.
  // boost = 1 is the normal level; AFC qualifying drives a louder ground.
  setCrowdBoost(boost) {
    crowdBoost = Math.max(1, boost || 1);
    if (!crowdGain || !ctx) return;
    crowdGain.gain.setTargetAtTime(restingGain(), ctx.currentTime, 0.2);
  },
  // Anticipation "ooh" for a chance/near-miss (rate-limited).
  ooh() {
    if (!ctx || sfxOff) return;
    if (ctx.currentTime - lastOoh < 1.2) return;
    lastOoh = ctx.currentTime;
    playBuffer("ooh", 0.9);
  },
  // A scored goal. The stadium roar (cheer sample) only fires when the HOME side
  // scores; an away goal still gets the little fanfare blip but no crowd cheer.
  goal(homeCheer = true) {
    if (sfxOff) return;
    if (homeCheer) playBuffer("cheer", Math.min(1.6, crowdBoost));
    tone(440, 0.12, "square", 0.14);
    setTimeout(() => tone(660, 0.12, "square", 0.14), 110);
    setTimeout(() => tone(880, 0.22, "square", 0.14), 220);
  },
  cheer() { if (!sfxOff) playBuffer("cheer", Math.min(1.6, crowdBoost)); },
  setSfxOff(off) {
    sfxOff = off;
    localStorage.setItem("wcj-sfx-off", off ? "1" : "0");
  },
  get sfxOff() {
    return sfxOff;
  },
  // Master volume (0..1) — scales the whole bus. Ramped briefly so a step doesn't
  // click. Persisted so the level survives reloads.
  setMasterVol(v) {
    masterVol = clamp01(v);
    localStorage.setItem("wcj-master-vol", String(masterVol));
    if (master && ctx) master.gain.setTargetAtTime(MASTER_BASE * masterVol, ctx.currentTime, 0.04);
  },
  get masterVol() {
    return masterVol;
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
