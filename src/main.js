import {
  VIEW_W,
  VIEW_H,
  FIELD,
  RUNOFF,
  GOAL_HALF,
  GOAL_DEPTH,
  CENTER_R,
  PEN_BOX_DEPTH,
  PEN_BOX_HALF,
  SIX_BOX_DEPTH,
  SIX_BOX_HALF,
  PEN_SPOT_DIST,
  PEN_ARC_R,
  CORNER_R,
  PLAYER_R,
  BALL_R,
  CONTROL_RADIUS,
  GK_REACH,
  GK_REACTION,
  DRIBBLE_OFFSET,
  BALL_FRICTION,
  PLAYER_SPEED,
  SPRINT_MULT,
  GK_SPEED,
  PLAYER_ACCEL,
  AUTOSWITCH_HYST,
  AUTOSWITCH_COOLDOWN,
  MARK_DIST,
  KICK_MIN,
  KICK_MAX,
  CHARGE_TIME,
  KICK_FREE_TIME,
  PASS_POWER,
  PASS_POWER_MAX,
  PASS_GUARD_TIME,
  PASS_MAGNET_MIN,
  PASS_MAGNET_MAX,
  STEAL_RANGE,
  STEAL_LUNGE_TIME,
  STEAL_LUNGE_SPEED,
  STEAL_COOLDOWN,
  STEAL_CHANCE,
  STEAL_FAIL_HOLD,
  STEAL_PROMPT_RANGE,
  STEAL_MAX_CHANCE,
  AI_LUNGE_RATE,
  TACKLE_COOLDOWN,
  POSSESSION_GRACE,
  MATCH_SECONDS,
  MATCH_MINUTES,
  GOAL_CELEBRATION,
  KICKOFF_PAUSE,
  SETPIECE_LABEL,
  HALFTIME_DURATION,
  STOPPAGE_MIN,
  STOPPAGE_MAX,
  OVR_MIN,
  OVR_MAX,
  MAX_SUBS,
  STATE,
} from "./constants.js";
import { NATIONS, NATION_KEYS, teamOvr, drawKit, preloadFlags } from "./nations.js";
preloadFlags();
import { drawText, drawTextCentered, textWidth } from "./font.js";
import { SPONSORS, makePen } from "./logos.js";
import { Sfx } from "./audio.js";
import { FEATURE } from "./features.js";
import { createWorldCup } from "./wc.js";

// Team kit/flag/squad data lookup. Works for every nation key, including the
// classic BRA/ARG used when the team-select feature is off.
const teamData = (key, kitType = "home") => {
  const n = NATIONS[key];
  if (kitType === "away") return { ...n, ...n.away };
  return n;
};

// ---------------------------------------------------------------------------
// Canvas setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById("game");
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

function resize() {
  // Fill the whole window, keeping the pitch aspect ratio (letterboxed).
  const scale = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  canvas.style.width = Math.round(VIEW_W * scale) + "px";
  canvas.style.height = Math.round(VIEW_H * scale) + "px";
}
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------------------
// Input — move with WASD / arrows, aim + kick with the mouse, and when
// defending press F to lunge in for a steal. E switches player, Shift sprints.
// ---------------------------------------------------------------------------
const keys = new Set();
const pressed = new Set(); // edge-triggered, cleared each rendered frame
window.addEventListener("keydown", (e) => {
  const k = norm(e.key);
  if (
    ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)
  )
    e.preventDefault();
  // P / Esc pause only during open play — never while a menu (incl. the
  // substitutions board) is up; there Esc means "go back".
  if ((k === "p" || k === "escape") && !subOpen) {
    if (controlsOpen) controlsOpen = false;
    else togglePause();
  }
  if (!keys.has(k)) pressed.add(k);
  keys.add(k);
  Sfx.resume();
});
window.addEventListener("keyup", (e) => keys.delete(norm(e.key)));
function norm(k) {
  return k.toLowerCase();
}
function down(...ks) {
  return ks.some((k) => keys.has(k));
}

// Mouse aiming — shots are aimed at the cursor.
let mouseX = VIEW_W / 2;
let mouseY = VIEW_H / 2;
let mouseActive = false;
let mouseShoot = false;
// Edge-triggered left-click latch, consumed by the menu screens (cleared each
// rendered frame, like `pressed`). Lets you click team cards / squad rows.
let clickPending = false;
let clickX = 0;
let clickY = 0;
// True only on frames where the mouse actually moved. Menu hover-select reads
// this so a STATIONARY cursor doesn't pin the selection every frame (which
// would fight keyboard navigation / scrolling).
let mouseMoved = false;
function toView(e) {
  const r = canvas.getBoundingClientRect();
  mouseX = clamp(((e.clientX - r.left) / r.width) * VIEW_W, 0, VIEW_W);
  mouseY = clamp(((e.clientY - r.top) / r.height) * VIEW_H, 0, VIEW_H);
  mouseActive = true;
}
canvas.addEventListener("mousemove", (e) => {
  toView(e);
  mouseMoved = true;
});
canvas.addEventListener("mouseleave", () => (mouseActive = false));
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0) {
    mouseShoot = true;
    toView(e);
    if (pibHandleClick(mouseX, mouseY)) {
      Sfx.resume();
      return;
    }
    clickPending = true;
    clickX = mouseX;
    clickY = mouseY;
    Sfx.resume();
  }
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouseShoot = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
// Mouse wheel scrolls the team-select list (independent of the cursor).
canvas.addEventListener(
  "wheel",
  (e) => {
    if (state === STATE.TEAM_SELECT) {
      e.preventDefault();
      gridScroll = clamp(gridScroll + (e.deltaY > 0 ? 1 : -1), 0, Math.max(0, gridRows() - GRID.vis));
    } else if (state === STATE.WC) {
      e.preventDefault();
      WC.onWheel(e.deltaY > 0 ? 1 : -1);
    }
  },
  { passive: false }
);

let paused = false;
let controlsOpen = false;
let pibCollapsed = false;
function togglePause() {
  if (state === STATE.PLAYING) {
    paused = !paused;
    if (!paused) controlsOpen = false;
    Sfx.setCrowdMuted(paused); // silence the crowd while paused
  }
}

const KEY = {
  up: ["arrowup", "w"],
  down: ["arrowdown", "s"],
  left: ["arrowleft", "a"],
  right: ["arrowright", "d"],
  switch: ["e"],
  sprint: ["shift"],
  start: ["enter"],
  back: ["escape", "backspace"], // menus: step back a screen
  subs: ["b"], // in-match: open the substitutions board
  rematch: ["r"], // full time: replay the same two teams
};
function keyDown(action) {
  return down(...KEY[action]);
}
function keyPressed(action) {
  return KEY[action].some((k) => pressed.has(k));
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
function len(x, y) {
  return Math.hypot(x, y);
}
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------------------
// Teams / formation (7-a-side 2-3-1, all in own half so kickoff is legal)
// ---------------------------------------------------------------------------
const FORMATION = [
  { role: "GK", fx: 0.04, fy: 0.5 },
  // Back two — wider spread so the pair covers the full defensive width
  { role: "DEF", fx: 0.16, fy: 0.24 },
  { role: "DEF", fx: 0.16, fy: 0.76 },
  // Midfield three — wide mids pinned to the flanks, central mid holds
  { role: "MID", fx: 0.31, fy: 0.13 },
  { role: "MID", fx: 0.30, fy: 0.5 },
  { role: "MID", fx: 0.31, fy: 0.87 },
  // Lone striker
  { role: "FWD", fx: 0.46, fy: 0.5 },
];

function homePos(slot, dir) {
  const fx = dir > 0 ? slot.fx : 1 - slot.fx;
  return {
    x: FIELD.left + fx * FIELD.width,
    y: FIELD.top + slot.fy * FIELD.height,
  };
}

// A player with no squad data (classic mode) plays at exactly the tuned
// constants — so the OVR system is a pure no-op until a real squad is supplied.
const NEUTRAL_ATTR = {
  speed: 1,
  shoot: 1,
  tackle: 1,
  control: 1, // first-touch / receiving range multiplier
  gkReaction: GK_REACTION,
  gkReach: GK_REACH,
};

// Turn a 1-99 OVR into the handful of multipliers the simulation reads. Ranges
// are intentionally narrow: a top side feels sharper (quicker, harder to rob,
// keeper reacts faster) without making weaker teams unplayable.
function attrsFromOvr(ovr, line) {
  const q = clamp((ovr - OVR_MIN) / (OVR_MAX - OVR_MIN), 0, 1);
  if (line === "GK") {
    return {
      speed: lerp(0.95, 1.1, q),
      shoot: 1,
      tackle: lerp(0.85, 1.15, q),
      control: 1, // keepers claim with gkReach, not the outfield touch radius
      gkReaction: lerp(GK_REACTION * 1.3, GK_REACTION * 0.72, q), // better = quicker
      gkReach: lerp(GK_REACH * 0.9, GK_REACH * 1.16, q),
    };
  }
  return {
    speed: lerp(0.93, 1.1, q),
    shoot: lerp(0.9, 1.14, q),
    tackle: lerp(0.8, 1.25, q),
    control: lerp(0.95, 1.3, q), // better players take a pass cleanly from farther out
    gkReaction: GK_REACTION,
    gkReach: GK_REACH,
  };
}

// How well a team protects the ball: the chance (0..1) that one of their passes
// survives a challenge, or that a dribbler shrugs off a steal attempt — read
// straight off the team OVR ("a percentage chance of your OVR"). Classic mode
// (no squad, ovr 0) falls back to a 50/50 baseline ("half the time"). Capped so
// even an elite side is never a literal sure thing.
function ovrGuard(ovr) {
  if (!ovr) return 0.5;
  return clamp(ovr / 100, 0.5, 0.95);
}

// Radius (px) within which the intended receiver of YOUR pass auto-collects the
// ball — grows with team OVR across the useful band, so a sharper side strings
// passes together more reliably. Classic mode (no squad) gets the floor.
function passMagnet(ovr) {
  if (!ovr) return PASS_MAGNET_MIN;
  const q = clamp((ovr - OVR_MIN) / (OVR_MAX - OVR_MIN), 0, 1);
  return lerp(PASS_MAGNET_MIN, PASS_MAGNET_MAX, q);
}

// Short position labels by formation line.
const POS_LABEL = { GK: "GK", DEF: "DF", MID: "MF", FWD: "FW" };
// Bench shape (generic substitutes — one of each line plus cover).
const BENCH_LINES = ["GK", "DEF", "DEF", "MID", "MID", "FWD"];

// Build a team. Players are generic (position + shirt number, no names) and all
// share `ovr` — one team-wide rating that drives play. `ovr` 0 (classic mode)
// means neutral attributes. Works for any FORMATION size (7-a-side, 11, ...).
function makeTeam(teamKey, dir, ovr) {
  const attr = ovr ? null : NEUTRAL_ATTR; // per-line attrs computed below when ovr>0
  return FORMATION.map((slot, i) => {
    const h = homePos(slot, dir);
    return {
      teamKey,
      dir,
      role: slot.role,
      slot,
      i,
      x: h.x,
      y: h.y,
      vx: 0,
      vy: 0,
      dvx: 0, // desired velocity (actual velocity eases toward this)
      dvy: 0,
      faceX: dir,
      faceY: 0,
      name: "",
      pos: POS_LABEL[slot.role] || slot.role,
      num: i + 1, // shirt number
      ovr: ovr || 0,
      attr: ovr ? attrsFromOvr(ovr, slot.role) : NEUTRAL_ATTR,
      // Steal-lunge state (see updateLunges / resolveSteals).
      lungeT: 0, // active dart time remaining
      lungeCd: 0, // cooldown before the next lunge
      lungeX: 0,
      lungeY: 0,
      lungeHit: false, // this dart has already had its one steal attempt
      lungeTimingScore: -1, // −1 = AI lunge; 0..1 = human timing quality (1 = dead-center gold zone)
    };
  });
}

// Generic substitutes for a team (used by the in-match substitutions board).
function makeBench(ovr) {
  return BENCH_LINES.map((line, i) => ({
    line,
    pos: POS_LABEL[line] || line,
    num: 12 + i,
    ovr: ovr || 0,
  }));
}

// Which side the human plays. Classic mode keeps BRA (left) vs ARG (right);
// a feature-on match overwrites these with the chosen nations.
let leftKey = "BRA";
let rightKey = "ARG";

let left, right, players, ball;
let lastMatch = null; // last match's teams + lineups, for a FULL TIME rematch
let benchL = []; // squad members not currently on the pitch (substitutes)
let benchR = [];
let subsUsedL = 0;
let subsUsedR = 0;
let subOpen = false; // substitutions board open (in-match; team-select flow only)
let isSquadMatch = false; // true when this match was launched via team-select (OVR + subs)
let inTournament = false; // true while playing a World Cup tournament match (returns to the hub at full time)
let autoPlay = false; // true in AI-vs-AI autoplay mode

// --- Team-select / squad menu state (only used when FEATURE.teamSelect) ---
let selStage = "home"; // "home" → "away" → "kit" within TEAM_SELECT
let leftKitType = "home"; // kit worn by left team ("home" | "away")
let rightKitType = "home"; // kit worn by right team
let kitInputDone = false; // guard: kit stage processes input once per render frame
let gridCursor = 0; // highlighted cell index into NATION_KEYS (0..7)
let pickedHome = null; // chosen home/your-team key
let pickedAway = null; // chosen opponent key
let teamSearchQuery = "";
let teamSearchFocused = false;
let squadStarters = []; // working copy of your XI (FORMATION order) on the SQUAD screen
let squadBench = []; // working copy of your bench on the SQUAD screen
let squadSel = 0; // selected row: 0..10 players, 11 = START / CLOSE
let squadPickBench = -1; // >=0 while choosing a same-line bench player to bring on

let controlled = null;
let lastAutoSwitchTime = -Infinity;
let charge = 0;
let chargeDir = 1; // shot meter ping-pongs: +1 filling, -1 draining
let passInFlight = false;
let passTarget = null;
let passTimer = 0;
let scoreL = 0;
let scoreR = 0;
let clock = 0;
let state = STATE.TITLE;
let stateTimer = 0;
let goalText = "";
let lastScorer = null;
let winnerText = "";
let halftimeDone = false;
let stoppageTime = 0; // extra real seconds added at 90' before full time is blown
let unluckyFlash = { t: 0, x: 0, y: 0 };
const UNLUCKY_DURATION = 0.85;

const isLeft = (p) => p && p.teamKey === leftKey;

// Start a match. With no arguments this is the classic neutral BRA-vs-ARG game
// (also used for replays). The team-select flow calls it with the chosen keys,
// edited starting elevens, and their benches.
function setupMatch(lk = leftKey, rk = rightKey, squadMatch = false, lKit = "home", rKit = "home", tourney = false) {
  leftKey = lk;
  rightKey = rk;
  leftKitType = lKit;
  rightKitType = rKit;
  isSquadMatch = squadMatch;
  inTournament = tourney; // a World Cup tournament match reports its result back to the hub
  // Remember the matchup so FULL TIME can offer a straight rematch.
  lastMatch = { lk, rk, squadMatch, lKit, rKit };
  // One team-wide OVR per side (0 = classic neutral); every player shares it.
  const lOvr = squadMatch ? teamOvr(lk) : 0;
  const rOvr = squadMatch ? teamOvr(rk) : 0;
  left = makeTeam(lk, +1, lOvr);
  right = makeTeam(rk, -1, rOvr);
  players = [...left, ...right];
  benchL = squadMatch ? makeBench(lOvr) : [];
  benchR = squadMatch ? makeBench(rOvr) : [];
  subsUsedL = 0;
  subsUsedR = 0;
  scoreL = 0;
  scoreR = 0;
  clock = 0;
  lastAutoSwitchTime = -Infinity;
  halftimeDone = false;
  stoppageTime = 0;
  winnerText = "";
  paused = false;
  controlsOpen = false;
  pibCollapsed = false;
  subOpen = false;
  Sfx.setCrowdMuted(false);
  // Fresh sponsor draw + stadium rebuild for the new match (10 of 64 brands).
  rollSponsors();
  stadiumType = matchCount % 3;
  matchCount++;
  // Dress the stands in the two nations' colours — home support fills the left
  // half of the bowl, away support the right, split down the halfway line.
  stadium = buildStadium(teamCrowdPalette(lk), teamCrowdPalette(rk), stadiumType);
  kickoff("L");
}

// Replay the same two teams (FULL TIME -> R). Falls back to a default match if
// nothing has been played yet.
function rematch() {
  if (!lastMatch) setupMatch();
  else setupMatch(lastMatch.lk, lastMatch.rk, lastMatch.squadMatch, lastMatch.lKit, lastMatch.rKit);
  Sfx.whistle();
}

// Pick two different random nations and start an AI-vs-AI match.
function startAutoPlay() {
  autoPlay = true;
  const lk = NATION_KEYS[((Math.random() * NATION_KEYS.length) | 0)];
  let rk;
  do { rk = NATION_KEYS[((Math.random() * NATION_KEYS.length) | 0)]; } while (rk === lk);
  const rKit = kitAutoRight(lk, "home", rk);
  setupMatch(lk, rk, true, "home", rKit);
}

// World Cup tournament controller. It owns the Mode Select, nation pick and
// tournament hub screens (state STATE.WC) and calls back here to launch matches.
const WC = createWorldCup({
  startMatch: (you, opp, knockout) => {
    const rKit = kitAutoRight(you, "home", opp);
    setupMatch(you, opp, true, "home", rKit, true); // squad match (OVR + subs) + tournament
  },
  quickPlay: () => { autoPlay = false; enterTeamSelect(); },
  toTitle: () => { autoPlay = false; state = STATE.TITLE; },
  autoPlay: () => startAutoPlay(),
  sfx: {
    pass: () => Sfx.pass(),
    whistle: () => Sfx.whistle(),
    ooh: () => Sfx.ooh(),
    goal: () => Sfx.goal(),
  },
});

// Input snapshot handed to the World Cup controller each frame (it doesn't read
// main.js globals directly).
function wcInput() {
  return {
    mx: mouseX,
    my: mouseY,
    mouseActive,
    mouseMoved,
    click: clickPending ? { x: clickX, y: clickY } : null,
    key: keyPressed,
    down: keyDown,
    pressed,
    // Lets the controller clear the ENTER latch after a screen transition so a
    // single press can't bleed into the next screen on a multi-step frame.
    consume: () => pressed.delete("enter"),
  };
}

function kickoff(possSide) {
  for (const t of [left, right]) {
    for (const p of t) {
      const h = homePos(p.slot, p.dir);
      p.x = h.x;
      p.y = h.y;
      p.vx = 0;
      p.vy = 0;
      p.dvx = 0;
      p.dvy = 0;
      p.faceX = p.dir;
      p.faceY = 0;
    }
  }
  ball = {
    x: FIELD.cx,
    y: FIELD.cy,
    vx: 0,
    vy: 0,
    owner: null,
    freeTimer: 0,
    tackleCd: 0,
    graceTimer: 0,
    lastTouch: null,
    // Pass-interception guard + magnet (see markPass / clearPass).
    passTeam: null, // teamKey whose pass is in flight (null = not a pass)
    passGuard: 0, // chance the pass beats an interception attempt
    passTimer: 0, // remaining time the guard is active
    passRolled: false, // the one interception roll has been taken
    passShield: false, // pass won that roll — opponents can't pick it off
    passReceiver: null, // your intended receiver (gets the magnet)
    magnet: 0, // radius the receiver auto-collects the ball within
  };
  setpieceLabel = "";
  setpieceTimer = 0;
  charge = 0;
  chargeDir = 1;
  passInFlight = false;
  passTarget = null;
  controlled = nearestField(left, ball.x, ball.y);
  state = STATE.KICKOFF;
  stateTimer = KICKOFF_PAUSE;
}

function nearestField(team, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const p of team) {
    if (p.role === "GK") continue;
    const d = len(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function goalAttack(dir) {
  return { x: dir > 0 ? FIELD.right : FIELD.left, y: FIELD.cy };
}
function ownGoalX(dir) {
  return dir > 0 ? FIELD.left : FIELD.right;
}

// ---------------------------------------------------------------------------
// Main update
// ---------------------------------------------------------------------------
// Wrapper: clears edge-triggered inputs after each logical step so they can't
// bleed into a second update() call in the same frame, and so they are never
// wiped by render() on high-refresh-rate displays (120 Hz ProMotion) where
// render() fires on frames that have no corresponding update() step.
function update(dt) {
  _update(dt);
  pressed.clear();
  clickPending = false;
  mouseMoved = false;
}
function _update(dt) {
  if (state === STATE.TITLE || state === STATE.FULLTIME) {
    Sfx.setIntensity(0); // resting murmur
    // Autoplay: count down then start a fresh random match; ESC exits to menu.
    if (state === STATE.FULLTIME && autoPlay) {
      stateTimer -= dt;
      if (stateTimer <= 0 || keyPressed("start")) { startAutoPlay(); return; }
      if (keyPressed("back")) { autoPlay = false; WC.enter(); state = STATE.WC; pressed.delete("escape"); }
      return;
    }
    // A finished World Cup tournament match returns to the hub (which records
    // the result and advances the matchweek) instead of the generic options.
    if (state === STATE.FULLTIME && inTournament) {
      if (keyPressed("start")) {
        WC.reportResult(scoreL, scoreR);
        inTournament = false;
        state = STATE.WC;
        pressed.delete("enter"); // don't let this ENTER bleed into the results CONTINUE
      }
      return;
    }
    // FULL TIME: R replays the same two teams; ENTER starts a fresh game with
    // two new teams (or just re-runs the classic match when select is off).
    if (state === STATE.FULLTIME && keyPressed("rematch")) {
      rematch();
      return;
    }
    const titleClicked = clickPending && clickX >= VIEW_W / 2 - 120 && clickX <= VIEW_W / 2 + 120 && clickY >= 178 && clickY <= 234;
    if (keyPressed("start") || titleClicked) {
      Sfx.whistle();
      if (FEATURE.teamSelect) {
        WC.enter(); // choose Quick Play or World Cup
        state = STATE.WC;
        pressed.delete("enter"); // don't let this ENTER instantly pick a mode
        clickPending = false;   // don't let this click bleed into the WC screen
      } else setupMatch();
    }
    return;
  }
  if (state === STATE.WC) {
    Sfx.setIntensity(0);
    WC.update(wcInput());
    // Consume click/keypresses so they can't bleed into the new state if the
    // fixed-timestep loop runs a second update() in this same frame.
    clickPending = false;
    pressed.clear();
    return;
  }
  if (state === STATE.TEAM_SELECT) {
    Sfx.setIntensity(0);
    updateTeamSelect();
    clickPending = false;
    pressed.clear();
    return;
  }
  if (state === STATE.SQUAD) {
    Sfx.setIntensity(0);
    updateSquad();
    clickPending = false;
    pressed.clear();
    return;
  }
  if (state === STATE.GOAL) {
    Sfx.setIntensity(0.85); // sustained roar through the celebration
    stateTimer -= dt;
    if (stateTimer <= 0) kickoff(lastScorer === "L" ? "R" : "L");
    return;
  }
  if (state === STATE.HALFTIME) {
    Sfx.setIntensity(0);
    stateTimer -= dt;
    if (stateTimer <= 0 || keyPressed("start")) {
      halftimeDone = true;
      swapSides(); // teams change ends: flip every player's direction
      kickoff("R");
    }
    return;
  }
  if (state === STATE.KICKOFF) {
    Sfx.setIntensity(0.12);
    stateTimer -= dt;
    for (const p of players) {
      p.vx = p.vy = p.dvx = p.dvy = 0;
    }
    if (stateTimer <= 0) {
      state = STATE.PLAYING;
      Sfx.whistle();
    }
    return;
  }

  // PLAYING
  if (paused) {
    return; // pause freezes the simulation (crowd muted in togglePause)
  }
  if (subOpen) {
    updateSubMenu(); // substitutions board freezes the sim while it's up
    return;
  }
  // Open the substitutions board (only in a squad match, with subs left).
  if (FEATURE.teamSelect && hasSquads() && keyPressed("subs") && subsUsedL < MAX_SUBS) {
    subOpen = true;
    squadSel = 0;
    squadPickBench = -1;
    return;
  }
  clock += dt;
  if (setpieceTimer > 0) setpieceTimer -= dt;
  if (unluckyFlash.t > 0) unluckyFlash.t -= dt;
  if (!halftimeDone && clock >= MATCH_SECONDS / 2) {
    triggerHalftime();
    return;
  }
  if (clock >= MATCH_SECONDS) {
    if (stoppageTime === 0) stoppageTime = STOPPAGE_MIN + Math.random() * (STOPPAGE_MAX - STOPPAGE_MIN);
    if (clock >= MATCH_SECONDS + stoppageTime) { endMatch(); return; }
  }

  updateOwner(dt);
  updateControl();
  handleHumanInput(dt);
  updateAI(dt);
  applySpacing(); // tactics: hold team shape — push teammates off each other
  updateLunges(dt); // commit darts (overrides movement) + tick cooldowns
  integratePlayers(dt);
  separatePlayers();
  resolveSteals(); // a landed dart wins the ball
  updateBall(dt);
  Sfx.setIntensity(audioTension()); // crowd rises with the danger
}

// Crowd tension 0..1 — louder as the ball nears a goal, peaks on a goalbound shot.
function audioTension() {
  const dl = len(ball.x - FIELD.left, ball.y - FIELD.cy);
  const dr = len(ball.x - FIELD.right, ball.y - FIELD.cy);
  const dNear = Math.min(dl, dr);
  let t = clamp(1 - dNear / (FIELD.width * 0.62), 0, 1);
  t *= t; // only really climbs in the final third
  const nearGoalX = Math.min(Math.abs(ball.x - FIELD.left), Math.abs(ball.x - FIELD.right));
  const inBox = nearGoalX < PEN_BOX_DEPTH && Math.abs(ball.y - FIELD.cy) < PEN_BOX_HALF;
  if (inBox) t = Math.max(t, 0.62);
  // a goalbound shot in flight spikes the noise
  const speed = len(ball.vx, ball.vy);
  const goalbound =
    (ball.vx < -45 && ball.x < FIELD.cx) || (ball.vx > 45 && ball.x > FIELD.cx);
  if (!ball.owner && speed > 150 && goalbound && Math.abs(ball.y - FIELD.cy) < PEN_BOX_HALF) {
    t = Math.max(t, 0.92);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Possession + control
// ---------------------------------------------------------------------------

// How much wider a teammate's trap radius gets while receiving a pass (multiplied
// further by their per-player control rating). This is what makes a pass "stick".
const PASS_RECEIVE_MULT = 1.85;
function updateOwner(dt) {
  if (ball.tackleCd > 0) ball.tackleCd -= dt;
  if (ball.graceTimer > 0) ball.graceTimer -= dt;
  if (ball.passTimer > 0) {
    ball.passTimer -= dt;
    if (ball.passTimer <= 0) clearPass();
  }
  if (ball.freeTimer > 0) {
    // The loose window stops the kicker re-grabbing their own kick — but a
    // keeper must still be able to get hands to a shot mid-flight, otherwise a
    // close-range effort reaches the net before anyone is allowed to own it.
    // That keeper save is the whole point.
    ball.owner = null;
    let gk = null;
    let gkD = Infinity;
    for (const p of players) {
      if (p.role !== "GK" || p.teamKey === ball.lastTouch) continue;
      const d = len(p.x - ball.x, p.y - ball.y);
      if (d < p.attr.gkReach && d < gkD) {
        gkD = d;
        gk = p;
      }
    }
    if (gk) {
      ball.owner = gk;
      ball.lastTouch = gk.teamKey;
      ball.freeTimer = 0;
      ball.graceTimer = Math.max(ball.graceTimer, POSSESSION_GRACE);
    }
    return;
  }
  const prev = ball.owner;
  let best = null;
  let bestD = Infinity;
  for (const p of players) {
    const d = len(p.x - ball.x, p.y - ball.y);
    let reach;
    if (p.role === "GK") {
      // Keepers claim with their reach (OVR-scaled) — kept tight so a well-placed
      // close shot can beat them instead of being smothered every time.
      reach = p.attr.gkReach;
    } else {
      // Outfield trap radius scales gently with OVR (better first touch).
      reach = CONTROL_RADIUS * (p.attr.control || 1);
      // Auto-receive: while a pass from this player's team is in flight, a teammate
      // pulls it in from much farther out — a clean first touch whose range scales
      // with their control rating, so passes actually find their man.
      if (ball.passTeam && p.teamKey === ball.passTeam) reach *= PASS_RECEIVE_MULT;
      // Magnet: when the ball is within the OVR-scaled pull range of the intended
      // receiver, updateBall steers it smoothly toward them. Ownership resolves
      // at normal CONTROL_RADIUS so the ball curves in rather than snapping.
      // (reach is NOT extended here — the pull does the work instead)
    }
    if (d <= reach && d < bestD) {
      bestD = d;
      best = p;
    }
  }
  // An OPPONENT closing on a player who already has the ball can't simply walk it
  // off them by being nearest — that's a challenge, resolved as a 50/50 coin flip
  // (OVR leans it only slightly). Win it and they take possession; lose it and the
  // carrier shrugs them off and is SHIELDED for STEAL_FAIL_HOLD seconds, so they
  // can't be mobbed the instant a defender is near. While that shield (or a fresh
  // turnover cooldown) is up, opponents can't take it at all.
  if (prev && best && best.teamKey !== prev.teamKey && best.role !== "GK") {
    if (ball.graceTimer > 0 || ball.tackleCd > 0) {
      best = prev; // carrier still protected — no handover
    } else if (stealSucceeds(prev, best)) {
      ball.tackleCd = TACKLE_COOLDOWN; // won the challenge — brief turnover grace
      Sfx.wall();
    } else {
      best = prev; // carrier shrugged it off — keeps it...
      ball.graceTimer = Math.max(ball.graceTimer, STEAL_FAIL_HOLD); // ...now shielded
    }
  }

  // Pass-interception guard: while a kick aimed at a teammate is in flight, the
  // OTHER side can only pick it off if it beats a single roll set by the passing
  // team's OVR. Survive that roll and the ball is shielded for the rest of the
  // flight so it reaches the intended man. Keepers are exempt — a save is not an
  // interception — and a teammate collecting it ends the pass (cleared below).
  if (ball.passTeam && best && best.teamKey !== ball.passTeam && best.role !== "GK") {
    if (!ball.passRolled) {
      ball.passRolled = true;
      ball.passShield = Math.random() < ball.passGuard;
    }
    if (ball.passShield) best = null; // shielded — opponent can't intercept
  }

  ball.owner = best;
  if (best) {
    ball.lastTouch = best.teamKey;
    // A fresh trap gets a brief grace window before it can be tackled.
    if (best !== prev) ball.graceTimer = Math.max(ball.graceTimer, POSSESSION_GRACE);
    if (ball.passTeam) clearPass(); // ball is controlled again — pass resolved
  }
}

function updateControl() {
  // While a pass is travelling, keep steering the intended receiver.
  if (passInFlight) {
    passTimer -= 1 / 60;
    if (ball.owner && isLeft(ball.owner)) passInFlight = false;
    else if (ball.owner && !isLeft(ball.owner)) passInFlight = false;
    else if (passTimer <= 0) passInFlight = false;
    if (passInFlight && passTarget) controlled = passTarget;
  }

  const weHaveBall = ball.owner && isLeft(ball.owner) && ball.owner.role !== "GK";

  // If our team has the ball at an outfielder's feet, you control the carrier.
  if (weHaveBall) {
    controlled = ball.owner;
    passInFlight = false;
  } else if (!passInFlight) {
    // Auto-switch: hand control to the player best placed to win the ball.
    // Only fires when the nearest player is significantly closer (AUTOSWITCH_HYST)
    // AND enough time has passed since the last switch (AUTOSWITCH_COOLDOWN),
    // so 2nd-closest doesn't trigger a switch every few seconds.
    const near = nearestField(left, ball.x, ball.y);
    if (near && near !== controlled && clock - lastAutoSwitchTime >= AUTOSWITCH_COOLDOWN) {
      const dCur = controlled && isLeft(controlled) ? dist(controlled, ball) : Infinity;
      if (dCur - dist(near, ball) > AUTOSWITCH_HYST) {
        controlled = near;
        lastAutoSwitchTime = clock;
      }
    }
  }

  // Manual switch — always jump to the player nearest the ball, now.
  if (keyPressed("switch")) {
    switchPlayer();
  }

  if (!controlled || !isLeft(controlled) || controlled.role === "GK") {
    controlled = nearestField(left, ball.x, ball.y);
  }
}

function switchPlayer() {
  const c = nearestField(left, ball.x, ball.y);
  if (c) controlled = c;
}

// Flip every player to the opposite end — called once at half time.
// All dir-based AI (goalAttack, ownGoalX, homePos) reads p.dir directly, so
// flipping it is all that's needed. Scoring + set-piece logic reads left[0].dir
// to know which team defends which end (see updateBall / restartGoalLine).
function swapSides() {
  for (const p of players) {
    p.dir = -p.dir;
    p.faceX = p.dir;
    p.faceY = 0;
    p.vx = p.vy = p.dvx = p.dvy = 0;
  }
}

// ---------------------------------------------------------------------------
// Steal timing meter (human only)
// ---------------------------------------------------------------------------
const STEAL_GOLD_CENTER = 0.80; // where the gold zone is centred on the meter (80% of CHARGE_TIME)

// Half-width of the gold zone: wider for better tacklers, narrower vs stronger carriers.
// Range roughly 4–12% of the bar — hard but not pixel-perfect.
function stealGoldHalfWidth(challenger, carrier) {
  const cQ = challenger.ovr > 0
    ? clamp((challenger.ovr - OVR_MIN) / (OVR_MAX - OVR_MIN), 0, 1)
    : 0.5;
  const oQ = carrier && carrier.ovr > 0
    ? clamp((carrier.ovr - OVR_MIN) / (OVR_MAX - OVR_MIN), 0, 1)
    : 0.5;
  return lerp(0.06, 0.13, cQ) * lerp(1.15, 0.85, oQ);
}

// ---------------------------------------------------------------------------
// Human input
// ---------------------------------------------------------------------------
function handleHumanInput(dt) {
  if (autoPlay) return;
  const p = controlled;
  if (!p) return;

  let mx = 0;
  let my = 0;
  if (keyDown("left")) mx -= 1;
  if (keyDown("right")) mx += 1;
  if (keyDown("up")) my -= 1;
  if (keyDown("down")) my += 1;
  const wantSprint = keyDown("sprint");
  const sprint = wantSprint ? SPRINT_MULT : 1;
  if (mx || my) {
    const l = len(mx, my);
    mx /= l;
    my /= l;
    p.dvx = mx * PLAYER_SPEED * sprint * p.attr.speed; // pace scales with OVR
    p.dvy = my * PLAYER_SPEED * sprint * p.attr.speed;
    p.faceX = mx;
    p.faceY = my;
  } else {
    p.dvx = 0;
    p.dvy = 0;
  }

  const hasBall = ball.owner === p;

  const nearCarrier = !hasBall && ball.owner &&
    ball.owner.teamKey !== p.teamKey &&
    len(ball.owner.x - p.x, ball.owner.y - p.y) < STEAL_PROMPT_RANGE &&
    p.lungeT <= 0 && p.lungeCd <= 0;

  // Left-click is context-sensitive: charges a kick when you have the ball,
  // or a steal attempt when you're defending next to a carrier.
  if (mouseShoot && (hasBall || nearCarrier)) {
    charge += chargeDir * dt;
    if (charge >= CHARGE_TIME) { charge = CHARGE_TIME; chargeDir = -1; }
    else if (charge <= 0) { charge = 0; chargeDir = 1; }
  }
  if (!mouseShoot && charge > 0) {
    if (hasBall) {
      const t = charge / CHARGE_TIME;
      const power = (KICK_MIN + t * (KICK_MAX - KICK_MIN)) * p.attr.shoot; // OVR strike
      const a = aimVec(p);
      kickBall(p, a.x, a.y, power);
      const mate = kickReceiver(p, a, power);
      if (mate) {
        controlled = mate;
        passInFlight = true;
        passTarget = mate;
        passTimer = 1.4;
        markPass(p, mate);
      }
      power > KICK_MIN + (KICK_MAX - KICK_MIN) * 0.55 ? Sfx.kick() : Sfx.pass();
    } else if (nearCarrier) {
      const t = charge / CHARGE_TIME;
      const hw = stealGoldHalfWidth(p, ball.owner);
      const timingQuality = Math.max(0, 1 - Math.abs(t - STEAL_GOLD_CENTER) / hw);
      tryLunge(p, timingQuality);
    }
    charge = 0;
    chargeDir = 1;
  }
}

// Aim direction for a kick: cursor if the mouse is in play, else facing, else
// straight at the opponent goal.
function aimVec(p) {
  if (mouseActive) {
    const dx = mouseX - p.x;
    const dy = mouseY - p.y;
    if (len(dx, dy) > 2) return { x: dx, y: dy };
  }
  if (len(p.faceX, p.faceY) > 0.1) return { x: p.faceX, y: p.faceY };
  const g = goalAttack(p.dir);
  return { x: g.x - p.x, y: g.y - p.y };
}

// A teammate roughly along the kick line and within its reach (so control can
// follow the pass). Returns null for a shot / nobody in the lane.
function kickReceiver(p, a, power) {
  const l = len(a.x, a.y) || 1;
  const ux = a.x / l;
  const uy = a.y / l;
  const reach = (power / 60 / (1 - BALL_FRICTION)) * 1.1; // how far the ball rolls
  let best = null;
  let bestScore = 0.86; // require fairly good alignment to count as a pass
  for (const t of left) {
    if (t === p || t.role === "GK") continue;
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const d = len(dx, dy);
    if (d < 14 || d > reach + 30) continue;
    const align = (dx / d) * ux + (dy / d) * uy;
    if (align > bestScore) {
      bestScore = align;
      best = t;
    }
  }
  return best;
}

function passTo(p, target) {
  // Lead the pass toward where the receiver is heading.
  const tx = target.x + target.vx * 0.12;
  const ty = target.y + target.vy * 0.12;
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = len(dx, dy) || 1;
  const power = clamp(60 + d * 1.7, PASS_POWER, PASS_POWER_MAX);
  kickBall(p, dx, dy, power);
  markPass(p, target); // guard it; your side's receiver also gets the magnet
  Sfx.pass();
  if (isLeft(p)) {
    controlled = target;
    passInFlight = true;
    passTarget = target;
    passTimer = 1.2;
  }
}

// Score teammates by: alignment with facing, being ahead, being open, distance.
function bestPassTarget(p) {
  const mates = (isLeft(p) ? left : right).filter(
    (t) => t !== p && t.role !== "GK"
  );
  const fl = len(p.faceX, p.faceY) || 1;
  let best = null;
  let bestScore = -Infinity;
  for (const t of mates) {
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const d = len(dx, dy);
    if (d < 12 || d > 220) continue;
    const align = (dx / d) * (p.faceX / fl) + (dy / d) * (p.faceY / fl);
    const forward = (t.x - p.x) * p.dir > 0 ? 1 : -0.6;
    const open = Math.min(nearestOppDist(t), 50) / 50;
    let score = align * 2.0 + forward * 0.8 + open * 1.0 - d / 260;
    // Both AIs read the passing lane now — favouring a teammate they can reach
    // through clear space with room to turn, so neither side blindly forces it
    // into traffic. The CPU still weights it harder, keeping its distribution edge.
    const lane = Math.min(laneClearance(p, t), 40) / 40;
    score += isFullAI(p) ? lane * 1.0 + open * 0.5 : lane * 0.82 + open * 0.42;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function nearestOppDist(p) {
  const opp = isLeft(p) ? right : left;
  let m = Infinity;
  for (const o of opp) m = Math.min(m, len(o.x - p.x, o.y - p.y));
  return m;
}

// How clear the passing lane from `from` to `to` is: the perpendicular distance
// of the nearest opponent to that line (bigger = cleaner). The CPU uses this to
// avoid threading a pass straight at a defender and pick the open outlet instead.
function laneClearance(from, to) {
  const opp = isLeft(from) ? right : left;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const segSq = dx * dx + dy * dy || 1;
  let clear = Infinity;
  for (const o of opp) {
    if (o.role === "GK") continue;
    const t = clamp(((o.x - from.x) * dx + (o.y - from.y) * dy) / segSq, 0, 1);
    clear = Math.min(clear, len(o.x - (from.x + dx * t), o.y - (from.y + dy * t)));
  }
  return clear;
}

function kickBall(p, dx, dy, power) {
  let l = len(dx, dy);
  if (l < 0.001) {
    dx = p.dir;
    dy = 0;
    l = 1;
  }
  ball.vx = (dx / l) * power;
  ball.vy = (dy / l) * power;
  ball.owner = null;
  ball.freeTimer = KICK_FREE_TIME;
  ball.lastTouch = p.teamKey;
  ball.x = p.x + (dx / l) * (CONTROL_RADIUS + BALL_R + 1);
  ball.y = p.y + (dy / l) * (CONTROL_RADIUS + BALL_R + 1);
  clearPass(); // a fresh kick is a shot until the caller marks it as a pass
}

// Flag the ball in flight as a pass from `passer`'s team, so the other side has
// to beat an OVR-based roll to intercept it (see the guard in updateOwner). When
// the pass belongs to YOUR side (left), the intended `receiver` also gets a
// magnet: an enlarged, OVR-scaled radius they auto-collect the ball within.
function markPass(passer, receiver) {
  ball.passTeam = passer.teamKey;
  ball.passGuard = ovrGuard(passer.ovr);
  ball.passTimer = PASS_GUARD_TIME;
  ball.passRolled = false;
  ball.passShield = false;
  if (receiver && isLeft(receiver)) {
    ball.passReceiver = receiver;
    ball.magnet = passMagnet(passer.ovr);
  } else {
    ball.passReceiver = null;
    ball.magnet = 0;
  }
}

function clearPass() {
  ball.passTeam = null;
  ball.passGuard = 0;
  ball.passTimer = 0;
  ball.passRolled = false;
  ball.passShield = false;
  ball.passReceiver = null;
  ball.magnet = 0;
  ballTrail.length = 0;
}

// Resolve a steal attempt on a carrier. The carrier first resists with a chance
// equal to their team OVR% (50/50 in classic mode) — rolled on EVERY challenge,
// so a dribbler keeps shrugging defenders off — and only if that protection
// fails does the challenger's own tackle rating decide it.
function stealSucceeds(carrier, challenger) {
  if (Math.random() < ovrGuard(carrier.ovr)) return false; // shrugged off
  return Math.random() < Math.min(0.97, STEAL_CHANCE * challenger.attr.tackle);
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------
let freezeAI = false;
// Debug A/B toggle (exposed on window.__wcj): off restores the old swarm-the-ball
// behaviour so the spacing tactics can be measured against it. Always true in play.
let tacticsOn = true;
function updateAI(dt) {
  if (freezeAI) {
    for (const p of players) if (p !== controlled) p.dvx = p.dvy = 0;
    return;
  }
  for (const team of [left, right]) {
    const presser = nearestField(team, ball.x, ball.y);
    const teamHasBall = ball.owner && ball.owner.teamKey === team[0].teamKey;
    // Both sides hunt the ball in pairs: when a team hasn't got possession a
    // second man pinches in to support the press and help trap the carrier. For
    // your side this means a teammate backs up whoever you're pressing with,
    // instead of leaving you to win the ball back single-handed.
    const second = !teamHasBall
      ? nearestField(team.filter((q) => q !== presser), ball.x, ball.y)
      : null;
    const marks = teamHasBall ? null : assignMarks(team, presser, second);
    for (const p of team) {
      if (p === controlled && !autoPlay) continue;
      // Pressing defenders time their own lunge at the carrier.
      if (
        !teamHasBall &&
        ball.owner &&
        ball.owner.teamKey !== team[0].teamKey &&
        (p === presser || p === second) &&
        p.role !== "GK" &&
        len(p.x - ball.owner.x, p.y - ball.owner.y) < STEAL_PROMPT_RANGE &&
        Math.random() < AI_LUNGE_RATE * dt
      ) {
        tryLunge(p);
      }
      if (p.role === "GK") {
        goalkeeperAI(p, dt);
      } else if (ball.owner === p) {
        carrierAI(p, dt);
      } else if (teamHasBall) {
        attackRunAI(p);
      } else if (p === presser) {
        pressAI(p);
      } else if (p === second) {
        supportPressAI(p);
      } else {
        markAI(p, marks.get(p));
      }
    }
  }
}

// Top speed an AI player can hit when sprinting — matches the human's Shift
// burst exactly, so the opponent can run with you instead of being outpaced.
const AI_SPRINT = PLAYER_SPEED * SPRINT_MULT;

// CPU difficulty. The opponent is always the right/ARG side (the human plays
// left), and it plays a level above the human's own AI teammates: quicker to
// close gaps, it presses the ball in pairs, reads loose balls earlier, and
// commits to shots/runs sooner. On top of pace it has the edge in decisions —
// it places its shots into the open side of the goal (see carrierAI) and picks
// the teammate behind a clear passing lane (see bestPassTarget), so it keeps the
// ball and finishes better. Tune these to make the opponent harder/easier.
const isOpp = (p) => !isLeft(p);
const isFullAI = (p) => autoPlay || isOpp(p); // in autoplay both teams get full CPU quality
const OPP_INTERCEPT = 48; // loose-ball pounce range (vs 35 for the human's side)
const AI_SPEED = 1.10;
const aiPace = (p, s) => s * AI_SPEED;

// Press the ball: close down the carrier from the goal side to channel them.
// Sprint to make up a real gap, then settle to a contain pace once you're on them.
function pressAI(p) {
  const own = ownGoalX(p.dir);
  const goalSide = own > ball.x ? 2 : -2; // nudge to sit between ball and goal
  const gap = len(ball.x - p.x, ball.y - p.y);
  const speed = gap > 24 ? AI_SPRINT : PLAYER_SPEED * 1.08;
  moveToward(p, ball.x + goalSide, ball.y, aiPace(p, speed));
}

// Second man in the CPU press: pinch in from the carrier's open (far) side and
// a step toward our own goal, cutting the forward outlet while the first man
// holds the ball up. The two of them trap the carrier instead of standing off.
function supportPressAI(p) {
  const own = ownGoalX(p.dir);
  const vside = ball.y >= FIELD.cy ? -12 : 12; // close the side the presser leaves open
  const goalSide = own > ball.x ? 7 : -7; // sit a touch goal-side to deny the through-ball
  const gap = len(ball.x - p.x, ball.y - p.y);
  const speed = gap > 26 ? AI_SPRINT : PLAYER_SPEED * 1.04;
  moveToward(p, ball.x + goalSide, ball.y + vside, aiPace(p, speed));
}

// Assign each spare defender to mark the most dangerous unmarked attacker.
function assignMarks(team, presser, second) {
  const map = new Map();
  const opp = (team[0].teamKey === leftKey ? right : left).filter(
    (o) => o.role !== "GK" && o !== ball.owner
  );
  const defenders = team.filter(
    (p) => p.role !== "GK" && p !== presser && p !== second
  );
  const ownG = ownGoalX(team[0].dir);
  // Most threatening = closest to our goal.
  opp.sort((a, b) => Math.abs(a.x - ownG) - Math.abs(b.x - ownG));
  const used = new Set();
  for (const t of opp) {
    let best = null;
    let bd = Infinity;
    for (const d of defenders) {
      if (used.has(d)) continue;
      const dd = len(d.x - t.x, d.y - t.y);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    if (best) {
      used.add(best);
      map.set(best, t);
    }
  }
  return map;
}

// Mark a man goal-side; pounce on a loose ball only if it's right at your feet;
// else hold the zonal line. The designated presser (and the CPU's support man)
// is the one who hunts the loose ball down — markers stay home and keep shape
// instead of the whole team collapsing onto it, which is what used to turn every
// loose touch into a scrum.
function markAI(p, target) {
  if (!target) return defendAI(p);
  // Only break the mark for a ball that has genuinely rolled to you.
  const loose = len(ball.x - p.x, ball.y - p.y);
  // Your markers read loose balls almost as sharply as the CPU now (17 vs 18),
  // so they break onto a stray touch near them instead of standing off it.
  const looseRange = tacticsOn ? (isOpp(p) ? 19 : 18) : (isFullAI(p) ? OPP_INTERCEPT : 42);
  if (!ball.owner && loose < looseRange) {
    const sp = tacticsOn ? PLAYER_SPEED : (loose > 22 ? AI_SPRINT : PLAYER_SPEED);
    return moveToward(p, ball.x, ball.y, aiPace(p, sp));
  }
  const ownG = ownGoalX(p.dir);
  const side = Math.sign(ownG - target.x) || p.dir * -1;
  let tx = target.x + side * MARK_DIST; // sit between the man and our goal
  let ty = target.y;
  // shade into the passing lane between the ball and the man
  tx = lerp(tx, (target.x + ball.x) / 2, 0.18);
  ty = lerp(ty, (target.y + ball.y) / 2, 0.18);
  moveToward(
    p,
    clamp(tx, FIELD.left + 8, FIELD.right - 8),
    clamp(ty, FIELD.top + 8, FIELD.bottom - 8),
    aiPace(p, PLAYER_SPEED * 0.96)
  );
}

function moveToward(p, tx, ty, speed) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const l = len(dx, dy);
  if (l < 1.5) {
    p.dvx = 0;
    p.dvy = 0;
    return;
  }
  const s = speed * p.attr.speed; // pace scales with the player's OVR
  p.dvx = (dx / l) * s;
  p.dvy = (dy / l) * s;
  p.faceX = dx / l;
  p.faceY = dy / l;
}

let aiKickCd = new WeakMap();
function carrierAI(p, dt) {
  const cd = (aiKickCd.get(p) || 0) - dt;
  aiKickCd.set(p, cd);
  const goal = goalAttack(p.dir);
  const dxG = goal.x - p.x;
  const distXG = Math.abs(dxG);

  // Instinct finish: inside the six-yard area bypass the cooldown and put it
  // away immediately — a striker standing over the ball doesn't hesitate.
  const veryClose = distXG < SIX_BOX_DEPTH + 10 && Math.abs(p.y - FIELD.cy) < GOAL_HALF + 18;
  if (isFullAI(p) && veryClose) {
    const gk = (isLeft(p) ? right : left).find((o) => o.role === "GK");
    const open = gk && gk.y < FIELD.cy ? 1 : -1;
    const tuck = 0.72 + Math.random() * 0.22;
    const aimY = FIELD.cy + open * GOAL_HALF * tuck;
    kickBall(p, dxG, aimY - p.y, KICK_MAX * (0.88 + Math.random() * 0.10) * p.attr.shoot);
    Sfx.kick();
    aiKickCd.set(p, 0.7);
    return;
  }

  // Shoot only when genuinely close and central — distance pot-shots just feed
  // the keeper. Spaced out by a longer cooldown so play builds instead of
  // turning into a shooting gallery.
  // CPU gets a wider zone (PEN_BOX_HALF - 8) so it finishes from all angles
  // inside the box, not just a narrow corridor straight ahead of goal.
  const shootRange = isFullAI(p) ? 135 : 120;
  const shootHalfW = isFullAI(p) ? PEN_BOX_HALF - 8 : GOAL_HALF + 36;
  if (cd <= 0 && distXG < shootRange && Math.abs(p.y - FIELD.cy) < shootHalfW) {
    // Both sides place the shot into the open side of the goal; CPU aims tighter
    // to the post, but both now pick their spot rather than firing at random.
    const gk = (isLeft(p) ? right : left).find((o) => o.role === "GK");
    const open = gk && gk.y < FIELD.cy ? 1 : -1; // aim away from where the keeper sits
    const tuck = isFullAI(p) ? 0.70 + Math.random() * 0.22 : 0.52 + Math.random() * 0.36;
    const aimY = FIELD.cy + open * GOAL_HALF * tuck;
    kickBall(p, dxG, aimY - p.y, KICK_MAX * (0.85 + Math.random() * 0.13) * p.attr.shoot);
    Sfx.kick();
    aiKickCd.set(p, isFullAI(p) ? 0.85 : 1.1);
    return;
  }

  // Jammed against the attacking byline and out wide — a dead-end corner.
  const offCenter = Math.abs(p.y - FIELD.cy);
  const cornered = distXG < 70 && offCenter > FIELD.height * 0.34;

  // Move the ball on. Pass when pressured or cornered; also knock it forward
  // unprompted to a teammate who's ahead and in space.
  const pressure = nearestOppDist(p);
  const releaseAt = isFullAI(p) ? 23 : 21; // both sides release quickly under pressure
  const underPressure = pressure < releaseAt || cornered;
  if (cd <= 0) {
    const tgt = bestPassTarget(p);
    const forward = tgt ? (tgt.x - p.x) * p.dir : -999; // >0 means ahead of the carrier
    const open = tgt ? nearestOppDist(tgt) : 0;
    // Build-up ball: only when the option is clearly better placed (ahead + open).
    const buildUp = tgt && forward > 16 && open > 34 && Math.random() < 0.55;
    if (tgt && (buildUp || (underPressure && (cornered || forward > -10)))) {
      passTo(p, tgt);
      aiKickCd.set(p, isFullAI(p) ? 0.45 : 0.50);
      return;
    }
    // No outlet and stuck in the corner: clear it back toward the middle.
    if (underPressure && cornered) {
      kickBall(p, -p.dir * 0.4, FIELD.cy - p.y, PASS_POWER_MAX);
      Sfx.kick();
      aiKickCd.set(p, 0.6);
      return;
    }
  }

  // Otherwise carry toward the goal MOUTH (not the corner flag): the closer to
  // the byline, the harder we curl back to central.
  const opp = nearestOpp(p);
  const centerPull = clamp(1 - distXG / 200, 0.05, 0.6);
  let ty = lerp(p.y, FIELD.cy, centerPull);
  if (opp && Math.abs(opp.x - p.x) < 21 && Math.abs(opp.y - p.y) < 19) {
    let away = opp.y > p.y ? -26 : 26; // dodge the defender...
    // ...but if that dodge runs us into the near touchline, cut inside instead.
    const towardEdge = (away < 0 && p.y < FIELD.cy) || (away > 0 && p.y > FIELD.cy);
    away = towardEdge ? (FIELD.cy - p.y) * 0.5 : away;
    ty += away;
  }
  ty = clamp(ty, FIELD.top + 8, FIELD.bottom - 8);
  // Sprint into open space on a counter; ease off when a defender is closing in
  // so the carrier can still feint and turn rather than steam straight ahead.
  const clear = !opp || len(opp.x - p.x, opp.y - p.y) > 42;
  moveToward(p, goal.x, ty, aiPace(p, clear ? AI_SPRINT : PLAYER_SPEED * 0.98));
}

function nearestOpp(p) {
  const opp = isLeft(p) ? right : left;
  let best = null;
  let bestD = Infinity;
  for (const o of opp) {
    const d = len(o.x - p.x, o.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function attackRunAI(p) {
  const h = homePos(p.slot, p.dir);
  // Both sides push up hard in attack; CPU still breaks a touch harder on the counter.
  // Bigger leads so the FWD hits the box and wide mids reach the penalty-box edge.
  // Lateral drift reduced so players hold their lanes and stay spread rather than
  // all drifting toward wherever the ball happens to be.
  const push = isFullAI(p) ? 1.36 : 1.27;
  const lead =
    (p.role === "FWD" ? 188 : p.role === "MID" ? 106 : 26) * push;
  let tx = h.x + p.dir * lead;
  let ty = h.y + (ball.y - h.y) * 0.15;
  // don't bunch onto the goal line
  const goal = goalAttack(p.dir);
  tx = p.dir > 0 ? Math.min(tx, goal.x - 18) : Math.max(tx, goal.x + 18);
  moveToward(
    p,
    clamp(tx, FIELD.left + 8, FIELD.right - 8),
    clamp(ty, FIELD.top + 8, FIELD.bottom - 8),
    aiPace(p, PLAYER_SPEED * 0.82)
  );
}

function defendAI(p) {
  const h = homePos(p.slot, p.dir);
  const own = ownGoalX(p.dir);
  // Sit goal-side of the ball, holding formation height.
  const threat = clamp((own - ball.x) / (own - FIELD.cx || 1), 0, 1);
  let tx = lerp(h.x, lerp(h.x, own + p.dir * 28, 0.6), threat);
  // shade toward the ball horizontally a touch
  tx = lerp(tx, ball.x, 0.12);
  let ty = h.y + (ball.y - h.y) * 0.22; // hold defensive width — less ball-tracking than before
  moveToward(
    p,
    clamp(tx, FIELD.left + 10, FIELD.right - 10),
    clamp(ty, FIELD.top + 8, FIELD.bottom - 8),
    aiPace(p, PLAYER_SPEED * 0.89)
  );
}

const gkMem = new WeakMap(); // per-keeper shot reaction state
function goalkeeperAI(p, dt) {
  const ownKeeper = isLeft(p); // player's side — buffed slightly
  const og = ownGoalX(p.dir);
  const lineX = og + p.dir * 12; // resting position, just off the goal line

  if (ball.owner === p) {
    // Distribute to an open teammate up-field & wide — never hoof it straight
    // back into trouble.
    const tgt = bestPassTarget(p);
    if (tgt) passTo(p, tgt);
    else kickBall(p, p.dir, (Math.random() - 0.5) * 1.2, PASS_POWER_MAX);
    Sfx.kick();
    return;
  }

  // 1) SHOT STOP — a loose ball is travelling at goal. The keeper predicts where
  //    it will cross the line and dives there, but only AFTER a short reaction
  //    beat: it can't pre-empt the strike. That reaction window is what makes the
  //    keeper beatable — a fast, well-placed shot can be in before the dive lands,
  //    while tame or central efforts get saved.
  const towardGoal = p.dir > 0 ? ball.vx < -18 : ball.vx > 18;
  if (!ball.owner && towardGoal && Math.abs(ball.vx) > 35) {
    const tCross = (lineX - ball.x) / ball.vx; // time to reach the keeper's line
    if (tCross > 0 && tCross < 2.2) {
      const crossY = ball.y + ball.vy * tCross;
      if (Math.abs(crossY - FIELD.cy) < GOAL_HALF + 20) {
        // Track reaction: a freshly-struck shot (big velocity change) resets it.
        let mem = gkMem.get(p);
        if (!mem || Math.abs(ball.vx - mem.vx) > 28 || Math.abs(ball.vy - mem.vy) > 28) {
          mem = { react: 0 };
        }
        mem.react += dt;
        mem.vx = ball.vx;
        mem.vy = ball.vy;
        gkMem.set(p, mem);

        if (mem.react >= p.attr.gkReaction * (ownKeeper ? 0.36 : 0.58)) {
          // Reacted — commit to a fast dive toward the crossing point.
          const ty = clamp(crossY, FIELD.cy - GOAL_HALF - 4, FIELD.cy + GOAL_HALF + 4);
          moveToward(p, lineX, ty, GK_SPEED * (ownKeeper ? 5.0 : 3.8));
        } else {
          // Still reacting — hold a set, near-central stance.
          const ty = clamp(
            FIELD.cy + (crossY - FIELD.cy) * 0.3,
            FIELD.cy - GOAL_HALF + 2,
            FIELD.cy + GOAL_HALF - 2
          );
          moveToward(p, lineX, ty, GK_SPEED * (ownKeeper ? 1.55 : 1.25));
        }
        return;
      }
    }
  } else {
    gkMem.delete(p); // no shot in flight — reset reaction memory
  }

  const inBox =
    Math.abs(ball.x - og) < PEN_BOX_DEPTH && Math.abs(ball.y - FIELD.cy) < PEN_BOX_HALF;
  const oppHasBall = ball.owner && ball.owner.teamKey !== p.teamKey;

  // 2) SMOTHER — an attacker is genuinely through, right on top of goal: rush out
  //    to cut the angle. Kept tight so the keeper doesn't needlessly abandon the
  //    line and get chipped/placed around.
  if (oppHasBall && inBox && Math.abs(ball.x - og) < SIX_BOX_DEPTH + (ownKeeper ? 40 : 26)) {
    moveToward(p, ball.x, ball.y, GK_SPEED * (ownKeeper ? 3.4 : 2.4));
    return;
  }

  // 3) CLAIM — a loose ball rolling in the box.
  if (!ball.owner && inBox && Math.abs(ball.x - og) < SIX_BOX_DEPTH + 18 &&
      len(ball.x - p.x, ball.y - p.y) < 54) {
    moveToward(p, ball.x, ball.y, GK_SPEED * (ownKeeper ? 2.3 : 1.85));
    return;
  }

  // 4) SET — an attacker is lining up a shot from range: stay compact and
  //    central on a near line (shots arrive near the middle), leaning only
  //    slightly toward the ball. Being set and central is what turns shots into
  //    saves; the dive above then covers the exact placement.
  if (oppHasBall && Math.abs(ball.x - og) < PEN_BOX_DEPTH + 24) {
    const setX = og + p.dir * 9;
    const setY = clamp(
      FIELD.cy + (ball.y - FIELD.cy) * (ownKeeper ? 0.36 : 0.28),
      FIELD.cy - GOAL_HALF + 2,
      FIELD.cy + GOAL_HALF - 2
    );
    moveToward(p, setX, setY, GK_SPEED * (ownKeeper ? 3.4 : 2.4));
    return;
  }

  // 5) POSITION — narrow the angle: sit on the line from goal centre to the
  //    ball, coming off the line a touch when the ball is closer/central.
  const gy = FIELD.cy;
  const dx = ball.x - og;
  const dy = ball.y - gy;
  const d = len(dx, dy) || 1;
  const closeness = clamp(1 - Math.abs(dx) / (FIELD.width * 0.5), 0, 1);
  const out = lerp(7, 18, closeness); // cut the angle, but stay near enough to react
  let tx = og + (dx / d) * out;
  let ty = gy + (dy / d) * out;
  ty = clamp(ty, FIELD.cy - GOAL_HALF + 1, FIELD.cy + GOAL_HALF - 1);
  tx = p.dir > 0 ? clamp(tx, og + 6, og + 22) : clamp(tx, og - 22, og - 6);
  moveToward(p, tx, ty, GK_SPEED * (ownKeeper ? 1.7 : 1.35));
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------
function integratePlayers(dt) {
  const maxStep = PLAYER_ACCEL * dt;
  for (const p of players) {
    // Ease actual velocity toward desired velocity (momentum / weight).
    p.vx += clamp(p.dvx - p.vx, -maxStep, maxStep);
    p.vy += clamp(p.dvy - p.vy, -maxStep, maxStep);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = clamp(p.x, FIELD.left + PLAYER_R, FIELD.right - PLAYER_R);
    p.y = clamp(p.y, FIELD.top + PLAYER_R, FIELD.bottom - PLAYER_R);
  }
}

// Tactics: keep the team spread. Once every AI has chosen where it wants to go,
// nudge each player's desired velocity away from nearby TEAMMATES so they fan out
// into space and hold their shape, instead of all converging on the ball and
// piling into a scrum. This is the difference between "everyone crowds the ball"
// and a side that keeps real distance and offers passing angles. The carrier, the
// human-controlled player and committed lungers are left alone — they go where
// they (or you) intend.
const SPACING_RADIUS = 50; // teammates closer than this repel each other — larger radius keeps pairs spread across the pitch
const SPACING_FORCE = 40; // strength of the spread, in px/s of desired-velocity nudge
function applySpacing() {
  if (!tacticsOn) return; // A/B: skip the spread entirely so the old swarm shows through
  for (const team of [left, right]) {
    for (const p of team) {
      if (p === controlled || p === ball.owner || p.role === "GK" || p.lungeT > 0) continue;
      let sx = 0;
      let sy = 0;
      for (const q of team) {
        if (q === p || q.role === "GK") continue;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const d = len(dx, dy);
        if (d > 0.001 && d < SPACING_RADIUS) {
          const w = (SPACING_RADIUS - d) / SPACING_RADIUS; // stronger the closer they sit
          sx += (dx / d) * w;
          sy += (dy / d) * w;
        }
      }
      if (sx === 0 && sy === 0) continue;
      p.dvx += sx * SPACING_FORCE;
      p.dvy += sy * SPACING_FORCE;
      // Don't let the spread push a player past a flat-out sprint.
      const l = len(p.dvx, p.dvy);
      const cap = AI_SPRINT * p.attr.speed;
      if (l > cap) {
        p.dvx = (p.dvx / l) * cap;
        p.dvy = (p.dvy / l) * cap;
      }
    }
  }
}

function separatePlayers() {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = len(dx, dy);
      const min = PLAYER_R * 2;
      if (d < min && d > 0.0001) {
        const push = (min - d) / 2;
        dx /= d;
        dy /= d;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stealing — a committed lunge wins the ball. The human times the steal meter
// (gold zone = clean tackle); the AI times its own. If timed = true the lunge
// auto-succeeds; otherwise the old random formula applies.
// ---------------------------------------------------------------------------
// timingScore: 0..1 for human (1 = dead-centre gold zone), -1 for AI (uses stealSucceeds formula)
function tryLunge(p, timingScore = -1) {
  if (!p || p.role === "GK" || p.lungeT > 0 || p.lungeCd > 0) return false;
  const tx = ball.owner ? ball.owner.x : ball.x;
  const ty = ball.owner ? ball.owner.y : ball.y;
  const dx = tx - p.x;
  const dy = ty - p.y;
  const l = len(dx, dy) || 1;
  p.lungeX = dx / l;
  p.lungeY = dy / l;
  p.lungeT = STEAL_LUNGE_TIME;
  p.lungeHit = false;
  p.lungeTimingScore = timingScore;
  Sfx.pass();
  return true;
}

function updateLunges(dt) {
  for (const p of players) {
    if (p.lungeT > 0) {
      // Commit to the dart: a forward burst that overrides normal movement.
      const s = STEAL_LUNGE_SPEED * p.attr.speed;
      p.dvx = p.lungeX * s;
      p.dvy = p.lungeY * s;
      p.vx = p.dvx;
      p.vy = p.dvy;
      p.faceX = p.lungeX;
      p.faceY = p.lungeY;
      p.lungeT -= dt;
      if (p.lungeT <= 0) {
        p.lungeT = 0;
        p.lungeCd = STEAL_COOLDOWN; // committed whether you won it or whiffed
      }
    } else if (p.lungeCd > 0) {
      p.lungeCd -= dt;
    }
  }
}

// A landed lunge resolves into a steal — exactly one attempt per dart.
function resolveSteals() {
  const o = ball.owner;
  if (!o || ball.tackleCd > 0 || ball.graceTimer > 0) return;
  for (const p of players) {
    if (p.teamKey === o.teamKey || p.lungeT <= 0 || p.lungeHit) continue;
    if (len(p.x - o.x, p.y - o.y) >= STEAL_RANGE) continue;
    p.lungeHit = true; // one go at it per lunge
    // Human: chance scales with timing quality — perfect centre = STEAL_MAX_CHANCE (65%),
    //        edge of gold zone = 0%. AI: existing ovrGuard + tackle formula.
    const isHuman = p.lungeTimingScore >= 0;
    const succeeded = isHuman
      ? Math.random() < p.lungeTimingScore * STEAL_MAX_CHANCE
      : stealSucceeds(o, p);
    if (!succeeded) {
      ball.graceTimer = Math.max(ball.graceTimer, STEAL_FAIL_HOLD);
      if (isHuman && p.lungeTimingScore > 0)
        unluckyFlash = { t: UNLUCKY_DURATION, x: p.x, y: p.y };
      return;
    }
    // Won it: knock the ball to the challenger's side so they collect it.
    const ang = Math.atan2(p.y - o.y, p.x - o.x);
    ball.owner = null;
    ball.freeTimer = 0.06;
    ball.tackleCd = TACKLE_COOLDOWN;
    ball.x = o.x + Math.cos(ang) * (CONTROL_RADIUS + 2);
    ball.y = o.y + Math.sin(ang) * (CONTROL_RADIUS + 2);
    ball.vx = Math.cos(ang) * 42;
    ball.vy = Math.sin(ang) * 42;
    ball.lastTouch = p.teamKey;
    Sfx.wall();
    return;
  }
}

function updateBall(dt) {
  if (ball.freeTimer > 0) ball.freeTimer -= dt;

  if (ball.owner) {
    const o = ball.owner;
    let fx = o.faceX;
    let fy = o.faceY;
    const fl = len(fx, fy);
    if (fl < 0.01) {
      fx = o.dir;
      fy = 0;
    } else {
      fx /= fl;
      fy /= fl;
    }
    ball.x = o.x + fx * DRIBBLE_OFFSET;
    ball.y = o.y + fy * DRIBBLE_OFFSET;
    ball.vx = o.vx;
    ball.vy = o.vy;
    return;
  }

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  const fr = Math.pow(BALL_FRICTION, dt * 60);
  ball.vx *= fr;
  ball.vy *= fr;
  if (Math.abs(ball.vx) < 2) ball.vx = 0;
  if (Math.abs(ball.vy) < 2) ball.vy = 0;

  // Magnet steering: bend the ball's velocity toward the intended receiver when
  // inside the pull radius, so it curves in smoothly instead of snapping.
  if (ball.passReceiver && ball.magnet > 0) {
    const rx = ball.passReceiver.x - ball.x;
    const ry = ball.passReceiver.y - ball.y;
    const rd = len(rx, ry);
    if (rd > 0 && rd <= ball.magnet) {
      const spd = Math.max(len(ball.vx, ball.vy), 60);
      const t = clamp(9 * dt, 0, 1); // steer rate — strong but visible curve
      ball.vx = lerp(ball.vx, (rx / rd) * spd, t);
      ball.vy = lerp(ball.vy, (ry / rd) * spd, t);
      // Record trail point for visual feedback.
      ballTrail.push({ x: ball.x, y: ball.y });
      if (ballTrail.length > BALL_TRAIL_LEN) ballTrail.shift();
    }
  } else if (ballTrail.length > 0) {
    ballTrail.length = 0; // clear trail when not attracting
  }

  // Real football out-of-play rules instead of arcade wall bounces.
  if (ball.y < FIELD.top) return restartThrowIn(ball.x);
  if (ball.y > FIELD.bottom) return restartThrowIn(ball.x);

  const inMouth = Math.abs(ball.y - FIELD.cy) < GOAL_HALF;
  // Which side scores depends on who defends each end, which flips at half time.
  // left[0].dir > 0 means left team defends the left goal (their own end is left).
  if (ball.x < FIELD.left) {
    if (inMouth) return score(left[0].dir > 0 ? "R" : "L");
    return restartGoalLine("left");
  }
  if (ball.x > FIELD.right) {
    if (inMouth) return score(left[0].dir > 0 ? "L" : "R");
    return restartGoalLine("right");
  }
}

// ---------------------------------------------------------------------------
// Set pieces (throw-in / corner / goal kick)
// ---------------------------------------------------------------------------
let setpieceLabel = "";
let setpieceTimer = 0;

function restartThrowIn(x) {
  // Awarded to whoever did NOT put it out.
  const team = ball.lastTouch === leftKey ? rightKey : leftKey;
  const edgeY = ball.y < FIELD.cy ? FIELD.top : FIELD.bottom;
  placeRestart(clamp(x, FIELD.left + 10, FIELD.right - 10), edgeY, team, false, "THROW IN");
}

function restartGoalLine(side) {
  // After half-time the teams swap ends, so which key defends each side flips.
  const leftDefendsLeft = left[0].dir > 0;
  const defKey = side === "left"
    ? (leftDefendsLeft ? leftKey : rightKey)
    : (leftDefendsLeft ? rightKey : leftKey);
  const atkKey = defKey === leftKey ? rightKey : leftKey;
  const og = side === "left" ? FIELD.left : FIELD.right;
  const inward = side === "left" ? 1 : -1;
  if (ball.lastTouch === atkKey) {
    // Attacker put it wide/over — a chance gone, so the crowd groans.
    Sfx.ooh();
    // Defending team restarts with a goal kick (keeper).
    placeRestart(og + inward * (SIX_BOX_DEPTH - 2), FIELD.cy, defKey, true, "GOAL KICK");
  } else {
    // Attacking team gets a corner.
    const cy = ball.y < FIELD.cy ? FIELD.top + 3 : FIELD.bottom - 3;
    placeRestart(og + inward * 3, cy, atkKey, false, "CORNER");
  }
}

function placeRestart(x, y, teamKey, toKeeper, label) {
  ball.x = x;
  ball.y = y;
  ball.vx = 0;
  ball.vy = 0;
  ball.freeTimer = 0;
  ball.tackleCd = 0;
  ball.graceTimer = 1.1; // can't be robbed instantly at a restart
  const team = teamKey === leftKey ? left : right;
  const taker = toKeeper ? team.find((p) => p.role === "GK") : nearestField(team, x, y);
  if (taker) {
    taker.x = clamp(x - taker.dir * 7, FIELD.left + 4, FIELD.right - 4);
    taker.y = clamp(y, FIELD.top + 4, FIELD.bottom - 4);
    taker.vx = taker.vy = taker.dvx = taker.dvy = 0;
    ball.owner = taker;
  }
  ball.lastTouch = teamKey;
  setpieceLabel = label;
  setpieceTimer = SETPIECE_LABEL;
  Sfx.whistle();
}

function score(side) {
  if (side === "L") scoreL++;
  else scoreR++;
  lastScorer = side;
  goalText = (side === "L" ? teamData(leftKey).abbr : teamData(rightKey).abbr) + " GOAL!";
  state = STATE.GOAL;
  stateTimer = GOAL_CELEBRATION;
  Sfx.goal();
}

function endMatch() {
  state = STATE.FULLTIME;
  Sfx.whistle();
  if (autoPlay) { stateTimer = 4.0; }
  // A tournament match shows the tie's outcome (resolving a knockout draw on
  // penalties); the hub records it when the player presses ENTER.
  if (inTournament) {
    winnerText = WC.previewOutcome(scoreL, scoreR);
    return;
  }
  if (scoreL > scoreR) winnerText = teamData(leftKey).name + " WINS";
  else if (scoreR > scoreL) winnerText = teamData(rightKey).name + " WINS";
  else winnerText = "DRAW";
}

function triggerHalftime() {
  state = STATE.HALFTIME;
  stateTimer = HALFTIME_DURATION;
  Sfx.whistle();
}

// ---------------------------------------------------------------------------
// Ball magnet trail — positions recorded while the ball is being steered.
const ballTrail = [];
const BALL_TRAIL_LEN = 10;

// Rendering
// ---------------------------------------------------------------------------
let stadium = null;
let matchCount = 0;
let stadiumType = 0;
function render() {
  if (!stadium)
    stadium = buildStadium(teamCrowdPalette(leftKey), teamCrowdPalette(rightKey), stadiumType);
  ctx.drawImage(stadium, 0, 0); // stands + crowd + grass runoff (pre-rendered)
  drawPitch();
  drawGoals();
  // The team-select / squad / World Cup screens use the pitch as a calm backdrop only.
  const menuBackdrop = state === STATE.TEAM_SELECT || state === STATE.SQUAD || state === STATE.WC;
  if (!menuBackdrop) {
    for (const p of players) drawShadow(p.x, p.y, PLAYER_R + 1);
    drawShadow(ball.x, ball.y, BALL_R + 0.5);
    for (const p of players) drawPlayer(p);
    drawShotTracker();
    drawBall();
    drawHud();
  }
  drawOverlays();
  if (subOpen) drawSubMenu();
  drawPauseIconBar();
  if (controlsOpen) drawControlsPanel();
  kitInputDone = false;
}

// Pre-render the stadium (Retro Bowl-style crowd, exits, brand billboards,
// floodlights, grass runoff) to an offscreen canvas once, then blit it each
// frame. Math.random runs only here, so there's no per-frame flicker.

// Retro Bowl-style crowd: chunky blob fans in flat colours, packed into neat
// staggered rows. The bowl is split down the halfway line — home support fills
// the left half dressed in the home nation's colours, away support the right —
// so the stands read as a real home-end-vs-away-end crowd. Whites/greys are
// woven into each block so it isn't a flat wall of one colour.
const FAN_MIX = [
  "#e7e9ec", "#e7e9ec", "#cfd4dc", "#9aa1ad", // whites & greys (most common)
  "#2b3553", "#444d64", // navy / charcoal coats
  "#f5d11a", "#7fc1e8", // Brazil yellow, Argentina sky
  "#1f4fb0", "#149a45", "#c23b3b", "#f2c200", // royal, green, red, gold pops
];
const FAN_HEAD = ["#caa46e", "#a9764e", "#d8c79c", "#2a2018", "#16110b", "#5e4126", "#8a8a8a"];

// Per-nation supporter palettes — flag + kit colours, primary weighted heaviest
// with a white/grey neutral or two so each end reads clearly as that team.
const CROWD_COLORS = {
  USA: ["#ffffff", "#ffffff", "#1a2a5e", "#1a2a5e", "#bf1a2f", "#e7e9ec", "#cfd4dc"], // red/white/blue
  MEX: ["#0b6b3a", "#0b6b3a", "#ffffff", "#ffffff", "#c8102e", "#0e7d44", "#e7e9ec"], // green/white/red
  CAN: ["#d52b1e", "#d52b1e", "#d52b1e", "#ffffff", "#ffffff", "#a81f16", "#e7e9ec"], // red/white
  BRA: ["#f7d417", "#f7d417", "#f7d417", "#1e9e4a", "#1f4fb0", "#c9a800", "#e7e9ec"], // yellow/green/blue
  FRA: ["#1e3a8a", "#1e3a8a", "#ffffff", "#ffffff", "#c8102e", "#16306e", "#e7e9ec"], // blue/white/red
  ESP: ["#c8102e", "#c8102e", "#c8102e", "#f5c518", "#f5c518", "#9e0c24", "#e7e9ec"], // red/yellow
  ARG: ["#7fbfe6", "#7fbfe6", "#7fbfe6", "#ffffff", "#ffffff", "#5a9fcf", "#e7e9ec"], // sky/white
  ECU: ["#ffd100", "#ffd100", "#ffd100", "#0a2472", "#d8242f", "#d6ae00", "#e7e9ec"], // yellow/blue/red
};

// Supporter palette for a nation: its curated flag/kit colours above, or a
// shirt-heavy kit-derived fallback (with neutrals) for any team not listed.
function teamCrowdPalette(key) {
  if (CROWD_COLORS[key]) return CROWD_COLORS[key];
  const t = teamData(key);
  return [t.shirt, t.shirt, t.shirt, t.shorts, t.shorts, t.shirtDark, "#e7e9ec", "#cfd4dc"];
}

// homeMix dresses the left half of the bowl, awayMix the right; default to one
// neutral mix everywhere when called bare.
// Three stadium types cycle each match:
//   0 = Classic Bowl   — dark navy, rectangular stands, corner floodlight pylons
//   1 = Open Corners   — warm concrete, stands only on straights (Copa-style gaps)
//   2 = Modern Night   — cool blue, LED roof rim, blue-tinted floodlight glow
function buildStadium(homeMix = FAN_MIX, awayMix = homeMix, type = 0) {
  const cv = document.createElement("canvas");
  cv.width = VIEW_W;
  cv.height = VIEW_H;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;

  const R = RUNOFF;
  const gx0 = FIELD.left - R, gy0 = FIELD.top - R;
  const gx1 = FIELD.right + R, gy1 = FIELD.bottom + R;
  const BOARD = 9;
  const bx0 = gx0 - BOARD, by0 = gy0 - BOARD;
  const bx1 = gx1 + BOARD, by1 = gy1 + BOARD;

  // Structural palette per type.
  const BG   = type === 2 ? "#040710" : "#080b13";
  const BASE = type === 2 ? "#080c1c" : "#0e1322";
  const ISLE = type === 2 ? "#162038" : "#2a3146";

  g.fillStyle = BG;
  g.fillRect(0, 0, VIEW_W, VIEW_H);

  const inStands = (x, y) => x < bx0 || x > bx1 || y < by0 || y > by1;

  const depth = (x, y) => {
    let d = 0;
    if (x < bx0) d = Math.max(d, bx0 - x);
    if (x > bx1) d = Math.max(d, x - bx1);
    if (y < by0) d = Math.max(d, by0 - y);
    if (y > by1) d = Math.max(d, y - by1);
    return d;
  };

  // Terraced base under the crowd so gaps read as shadow, not void.
  // Use the full outer region (not just inStands) so that type-1 open corners
  // show dark concrete instead of the void-black BG color.
  g.fillStyle = BASE;
  for (let y = 0; y < VIEW_H; y += 2)
    for (let x = 0; x < VIEW_W; x += 2)
      if (x < bx0 || x > bx1 || y < by0 || y > by1) g.fillRect(x, y, 2, 2);

  // --- Sideline board layout (constants also used below to draw the actual boards). ---
  // margin=0, gap=0: boards run flush edge-to-edge with no railing gaps.
  // FIFA WC 2026 is always pinned at the first board on each sideline (by rollSponsors).
  const margin = 0, gap = 0, perSide = 4, SBH = 12;
  const boardW = (gx1 - gx0 - 2 * margin - (perSide - 1) * gap) / perSide;

  // Pre-compute x-ranges that have NO sponsor board (margins + inter-board gaps).
  // Fans within these columns near the boards are replaced with the aisle colour,
  // making the board gaps read as railings running up into the stands.
  const railGaps = [];
  railGaps.push(gx0, gx0 + margin);
  for (let i = 0; i < perSide - 1; i++) {
    const rx0 = gx0 + margin + (i + 1) * boardW + i * gap;
    railGaps.push(rx0, rx0 + gap);
  }
  railGaps.push(gx0 + margin + perSide * boardW + (perSide - 1) * gap, gx1);
  const inRailGap = x => {
    for (let i = 0; i < railGaps.length; i += 2)
      if (x >= railGaps[i] && x < railGaps[i + 1]) return true;
    return false;
  };
  const RAILING_D = 16; // px of stand depth (from by0/by1) that the gap covers

  // --- Crowd: blob fans (head + body) on a packed, staggered grid. ---
  const STEP_X = 4, STEP_Y = 4;
  const emptyChance = type === 2 ? 0.05 : 0.08; // modern stadium = fuller house
  for (let gy = 0, rowi = 0; gy < VIEW_H; gy += STEP_Y, rowi++) {
    const stag = (rowi % 2) * 2;
    for (let gx = 0; gx < VIEW_W; gx += STEP_X) {
      const x = gx + stag, y = gy;
      const cx = x + 1, cy = y + 1;
      if (!inStands(cx, cy)) continue;
      const d = depth(cx, cy);
      if (Math.random() < emptyChance) continue;
      const mix = cx < FIELD.cx ? homeMix : awayMix;
      const jersey = mix[(Math.random() * mix.length) | 0];
      const head = FAN_HEAD[(Math.random() * FAN_HEAD.length) | 0];
      g.globalAlpha = clamp(0.8 - d * 0.006, 0.42, 0.8);
      g.fillStyle = jersey;
      g.fillRect(x, y + 1, 3, 2);
      g.fillStyle = head;
      g.fillRect(x + 1, y, 1, 1);
    }
  }
  g.globalAlpha = 1;

  // Type 2: bright LED roof rim painted over the outer edge of the stands.
  if (type === 2) {
    g.globalAlpha = 0.88;
    g.fillStyle = "#8ec8ff";
    g.fillRect(0, 0, VIEW_W, 3);
    g.fillRect(0, VIEW_H - 3, VIEW_W, 3);
    g.fillRect(0, 3, 3, VIEW_H - 6);
    g.fillRect(VIEW_W - 3, 3, 3, VIEW_H - 6);
    g.globalAlpha = 1;
  }

  // --- Exit tunnels (vomitories). ---
  for (let i = 1; i <= 5; i++) {
    const ex = gx0 + ((gx1 - gx0) * i) / 6;
    drawExit(g, ex - 4, 3, 8, by0 - 6, "down");
    drawExit(g, ex - 4, by1 + 3, 8, VIEW_H - (by1 + 3) - 3, "up");
  }
  for (const ey of [FIELD.cy - 100, FIELD.cy + 100]) {
    drawExit(g, 3, ey - 5, bx0 - 6, 10, "right");
    drawExit(g, bx1 + 3, ey - 5, VIEW_W - (bx1 + 3) - 3, 10, "left");
  }

  if (gameSponsors.length < 10) rollSponsors();

  drawGoalBoard(g, 12, FIELD.cy, 17, 150, gameSponsors[0]);
  drawGoalBoard(g, VIEW_W - 12, FIELD.cy, 17, 150, gameSponsors[1]);


  // --- Sideline brand boards. ---
  for (let i = 0; i < perSide; i++) {
    const sbx = gx0 + margin + i * (boardW + gap);
    drawSideBoard(g, sbx, gy0 - SBH, boardW, SBH, gameSponsors[2 + i]);
    drawSideBoard(g, sbx, gy1, boardW, SBH, gameSponsors[6 + i]);
  }

  g.fillStyle = "#0c5a22";
  g.fillRect(gx0, gy0, gx1 - gx0, gy1 - gy0);

  return cv;
}

// --- Sponsor pool (64 brands) lives in logos.js: each carries a board colour
// (`bg`) plus a `draw(pen, maxW, maxH)` that lays an original pixel emblem (the
// brand's mark, not its name). 10 are drawn at random per match. ---

// The 10 sponsors shown this match (slots: 0-1 goal billboards, 2-9 sidelines).
let gameSponsors = [];
function rollSponsors() {
  const idx = SPONSORS.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  gameSponsors = idx.slice(0, 10).map((i) => SPONSORS[i]);
}

// Lay a brand's emblem centred at (cx, cy) within maxW x maxH. The emblem art is
// authored ~11 design-units tall, so the pen scale tracks the available height.
function drawBrandLogo(g, b, cx, cy, maxW, maxH) {
  const u = Math.max(0.7, Math.min(maxH / 11, 1.4));
  const pen = makePen(g, Math.round(cx), Math.round(cy), u);
  b.draw(pen, maxW, maxH);
}

// A horizontal sideline hoarding carrying one brand emblem.
function drawSideBoard(g, x, y, w, h, b) {
  g.globalAlpha = 1;
  g.fillStyle = "#05070c"; // mounting frame
  g.fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle = b.bg;
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(255,255,255,0.10)"; // panel sheen
  g.fillRect(x, y, w, 1);
  drawBrandLogo(g, b, x + w / 2, y + h / 2, w - 6, h - 2);
}

// A large brand billboard at the back of a goal-end stand (rotated so it reads
// up the vertical panel). The 90deg rotation keeps pixels crisp.
function drawGoalBoard(g, cx, cy, w, h, b) {
  const x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
  g.globalAlpha = 1;
  g.fillStyle = "#05070c"; // mounting structure
  g.fillRect(x - 2, y - 2, w + 4, h + 4);
  g.fillStyle = b.bg;
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(255,255,255,0.10)";
  g.fillRect(x, y, w, 1);
  g.save();
  g.translate(Math.round(cx), Math.round(cy));
  g.rotate(-Math.PI / 2);
  drawBrandLogo(g, b, 0, 0, h - 10, w - 4);
  g.restore();
}

// A lit exit tunnel cut into a stand. `mouth` is the side that faces the pitch
// (where the green exit light and warm light-spill sit): "down"/"up" for the
// sideline stands, "left"/"right" for the goal-end stands.
function drawExit(g, x, y, w, h, mouth) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  g.globalAlpha = 1;
  // Concrete surround so the opening reads as a framed portal.
  g.fillStyle = "#222a3c";
  g.fillRect(x - 1, y - 1, w + 2, h + 2);
  // Dark tunnel.
  g.fillStyle = "#05070c";
  g.fillRect(x, y, w, h);
  // Warm light-spill + green exit light at the pitch-facing mouth.
  if (mouth === "down") {
    g.fillStyle = "rgba(150,135,90,0.22)"; g.fillRect(x, y + h - 5, w, 5);
    g.fillStyle = "#46f08a"; g.fillRect(x + (w >> 1) - 1, y + h - 2, 2, 2);
  } else if (mouth === "up") {
    g.fillStyle = "rgba(150,135,90,0.22)"; g.fillRect(x, y, w, 5);
    g.fillStyle = "#46f08a"; g.fillRect(x + (w >> 1) - 1, y, 2, 2);
  } else if (mouth === "right") {
    g.fillStyle = "rgba(150,135,90,0.22)"; g.fillRect(x + w - 5, y, 5, h);
    g.fillStyle = "#46f08a"; g.fillRect(x + w - 2, y + (h >> 1) - 1, 2, 2);
  } else {
    g.fillStyle = "rgba(150,135,90,0.22)"; g.fillRect(x, y, 5, h);
    g.fillStyle = "#46f08a"; g.fillRect(x, y + (h >> 1) - 1, 2, 2);
  }
}

// Mouse-aimed shot tracker: a dotted predicted trajectory toward the cursor,
// its length scaling with charge, ending in a reticle.
function drawShotTracker() {
  if (state !== STATE.PLAYING || paused || autoPlay) return;
  const p = controlled;
  if (!p || ball.owner !== p) return;

  const a = aimVec(p);
  const l = len(a.x, a.y) || 1;
  const dirx = a.x / l;
  const diry = a.y / l;

  // Power: preview at min power when not charging, otherwise the live charge.
  const t = charge / CHARGE_TIME;
  const charging = charge > 0;
  const power = KICK_MIN + (charging ? t : 0) * (KICK_MAX - KICK_MIN);

  // Simulate the ball flight with the same friction the physics uses.
  let x = p.x + dirx * (CONTROL_RADIUS + BALL_R + 1);
  let y = p.y + diry * (CONTROL_RADIUS + BALL_R + 1);
  let vx = dirx * power;
  let vy = diry * power;
  const dt = 1 / 60;
  let n = 0;
  for (let i = 0; i < 90; i++) {
    x += vx * dt;
    y += vy * dt;
    vx *= BALL_FRICTION;
    vy *= BALL_FRICTION;
    if (x < FIELD.left - GOAL_DEPTH || x > FIELD.right + GOAL_DEPTH) break;
    if (y < FIELD.top || y > FIELD.bottom) break;
    if (len(vx, vy) < 6) break;
    if (i % 4 === 0) {
      const fade = 1 - i / 90;
      ctx.fillStyle = charging
        ? `rgba(255,${Math.round(200 - t * 140)},80,${0.35 + fade * 0.5})`
        : `rgba(255,255,255,${0.18 + fade * 0.3})`;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      n++;
    }
  }

  // Reticle at the cursor.
  if (mouseActive) {
    const mx = Math.round(mouseX);
    const my = Math.round(mouseY);
    ctx.fillStyle = charging ? "#ffd23b" : "rgba(255,255,255,0.7)";
    ctx.fillRect(mx - 3, my, 2, 1);
    ctx.fillRect(mx + 2, my, 2, 1);
    ctx.fillRect(mx, my - 3, 1, 2);
    ctx.fillRect(mx, my + 2, 1, 2);
  }
}

function drawPitch() {
  // Mowing stripes across the marked pitch (perpendicular to play).
  const stripes = 12;
  const sw = FIELD.width / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#1f8a3a" : "#1b7d34";
    ctx.fillRect(FIELD.left + i * sw, FIELD.top, Math.ceil(sw), FIELD.height);
  }

  const t = 1;
  const c = "#dff5e3";
  ctx.fillStyle = c;

  // Boundary + halfway line + centre circle/spot.
  rectOutline(FIELD.left, FIELD.top, FIELD.width, FIELD.height, t);
  ctx.fillRect(FIELD.cx - t / 2, FIELD.top, t, FIELD.height);
  circleOutline(FIELD.cx, FIELD.cy, CENTER_R, t);
  dot(FIELD.cx, FIELD.cy);

  // Per-end markings: boxes, penalty spot, and the "D" arc.
  for (const dir of [+1, -1]) {
    const gx = dir > 0 ? FIELD.left : FIELD.right; // goal line x
    const inward = dir; // +1 points right (into field) for left end
    const penX = gx + inward * PEN_BOX_DEPTH;
    const sixX = gx + inward * SIX_BOX_DEPTH;
    const spotX = gx + inward * PEN_SPOT_DIST;

    // 18-yard box
    boxFromLine(gx, penX, PEN_BOX_HALF, t);
    // 6-yard box
    boxFromLine(gx, sixX, SIX_BOX_HALF, t);
    // penalty spot
    ctx.fillStyle = c;
    dot(spotX, FIELD.cy);
    // penalty arc — the "D", only the part beyond the box edge
    penaltyArc(spotX, FIELD.cy, PEN_ARC_R, inward, t);
  }

  // Corner arcs (quarter circles at each corner).
  cornerArc(FIELD.left, FIELD.top, 0, Math.PI / 2, t);
  cornerArc(FIELD.right, FIELD.top, Math.PI / 2, Math.PI, t);
  cornerArc(FIELD.right, FIELD.bottom, Math.PI, Math.PI * 1.5, t);
  cornerArc(FIELD.left, FIELD.bottom, Math.PI * 1.5, Math.PI * 2, t);
}

function dot(x, y) {
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
}

// A rectangle open on the goal-line side (the line itself is the boundary).
function boxFromLine(gx, farX, half, t) {
  const x = Math.min(gx, farX);
  const w = Math.abs(farX - gx);
  const y = FIELD.cy - half;
  const h = half * 2;
  ctx.fillRect(x, y, w, t); // top
  ctx.fillRect(x, y + h - t, w, t); // bottom
  ctx.fillRect(farX - (farX > gx ? t : 0), y, t, h); // far (vertical) line
}

function penaltyArc(cx, cy, r, dir, t) {
  // The penalty "D": half-circle facing the field, clipped to the part that
  // sticks out beyond the edge of the 18-yard box.
  const edge = PEN_BOX_DEPTH - PEN_SPOT_DIST; // box edge, measured from the spot
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / steps; // -90deg..+90deg
    const x = cx + Math.cos(a) * r * dir;
    const y = cy + Math.sin(a) * r;
    const beyond = dir > 0 ? x > cx + edge : x < cx - edge;
    if (beyond) ctx.fillRect(Math.round(x), Math.round(y), t, t);
  }
}

function cornerArc(cx, cy, start, end, t) {
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const a = start + ((end - start) * i) / steps;
    ctx.fillRect(Math.round(cx + Math.cos(a) * CORNER_R), Math.round(cy + Math.sin(a) * CORNER_R), t, t);
  }
}

function drawGoals() {
  drawNet(FIELD.left - GOAL_DEPTH, FIELD.cy - GOAL_HALF, GOAL_DEPTH, GOAL_HALF * 2);
  drawNet(FIELD.right, FIELD.cy - GOAL_HALF, GOAL_DEPTH, GOAL_HALF * 2);
}
function drawNet(x, y, w, h) {
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#eafff0";
  ctx.fillRect(x, y - 1, w, 1);
  ctx.fillRect(x, y + h, w, 1);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (let gx = 0; gx <= w; gx += 2) ctx.fillRect(x + gx, y, 1, h);
  for (let gy = 0; gy <= h; gy += 3) ctx.fillRect(x, y + gy, w, 1);
}
function rectOutline(x, y, w, h, t) {
  ctx.fillRect(x, y, w, t);
  ctx.fillRect(x, y + h - t, w, t);
  ctx.fillRect(x, y, t, h);
  ctx.fillRect(x + w - t, y, t, h);
}
function circleOutline(cx, cy, r, t) {
  const steps = 36;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), t, t);
  }
}
function drawShadow(x, y, r) {
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.7, r, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer(p) {
  const kit = p.teamKey === leftKey ? leftKitType : rightKitType;
  const team = teamData(p.teamKey, kit);
  const isGk = p.role === "GK";
  const shirt = isGk ? team.gk : team.shirt;
  const x = Math.round(p.x);
  const y = Math.round(p.y);

  if (p === controlled && state !== STATE.TITLE && !autoPlay) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 3, PLAYER_R + 1.6, (PLAYER_R + 1.6) * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    // little chevron above the active player
    ctx.fillStyle = "#ffe66b";
    ctx.fillRect(x, y - 8, 1, 1);
    ctx.fillRect(x - 1, y - 9, 3, 1);
  }

  ctx.fillStyle = shirt;
  ctx.fillRect(x - 3, y - 2, 6, 5);
  ctx.fillStyle = team.shorts;
  ctx.fillRect(x - 3, y + 3, 6, 2);
  ctx.fillStyle = team.skin;
  ctx.fillRect(x - 1, y - 4, 3, 3);
  const fl = len(p.faceX, p.faceY) || 1;
  ctx.fillStyle = "#22160c";
  ctx.fillRect(Math.round(x + (p.faceX / fl) * 2), Math.round(y - 3 + (p.faceY / fl) * 1), 1, 1);
}

function drawBall() {
  // Magnet attraction visuals: receiver ring pulse + ball trail.
  if (ball.passReceiver && ball.magnet > 0 && !ball.owner) {
    const rd = dist(ball, ball.passReceiver);
    if (rd <= ball.magnet) {
      // Receiver: pulsing ring that tightens as the ball gets close.
      const rx = Math.round(ball.passReceiver.x);
      const ry = Math.round(ball.passReceiver.y);
      const phase = (clock * 6) % 1; // 0-1 cycle at ~6Hz
      const r = Math.round(4 + phase * 3 + rd * 0.15);
      ctx.strokeStyle = `rgba(255,230,80,${0.55 - phase * 0.35})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(rx, ry, r, 0, Math.PI * 2);
      ctx.stroke();

      // Trail: fading dots along the recent ball path.
      for (let i = 0; i < ballTrail.length; i++) {
        const alpha = ((i + 1) / ballTrail.length) * 0.55;
        ctx.fillStyle = `rgba(255,230,80,${alpha})`;
        ctx.fillRect(Math.round(ballTrail[i].x), Math.round(ballTrail[i].y), 1, 1);
      }
    }
  }

  const x = Math.round(ball.x);
  const y = Math.round(ball.y);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - 1, y - 1, 3, 3);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x, y, 1, 1);
  ctx.fillStyle = "#d8d8d8";
  ctx.fillRect(x - 1, y - 1, 1, 1);
}

function drawHud() {
  const BAR_H = 27;

  // ----- Left: score (top-left corner only, no full-width bar) -----
  const lt = teamData(leftKey);
  const rt = teamData(rightKey);
  const scoreStr = `${scoreL}-${scoreR}`;
  let clockStr, clockColor;
  if (clock >= MATCH_SECONDS && stoppageTime > 0) {
    const extra = Math.max(1, Math.ceil((clock - MATCH_SECONDS) * MATCH_MINUTES / MATCH_SECONDS));
    clockStr = `90+${extra}'`;
    clockColor = "#ffaa44";
  } else {
    const mins = Math.floor(Math.min(1, clock / MATCH_SECONDS) * MATCH_MINUTES);
    clockStr = `${mins}'`;
    clockColor = "#bcd3ff";
  }
  const SC = 2, GAP = 4, KS = 1;
  const kitW = 10;
  const lW = textWidth(lt.abbr, SC);
  const sW = textWidth(scoreStr, SC);
  const rW = textWidth(rt.abbr, SC);
  const lx = 4, ly = 5;
  // Draw background only as wide as the score block
  const blockW = lx + kitW + 3 + lW + GAP + sW + GAP + rW + 3 + kitW + 8;
  ctx.fillStyle = "#040a14";
  ctx.fillRect(0, 0, blockW, BAR_H);
  drawKit(ctx, leftKey, lx + 5, ly + 4, KS, leftKitType);
  drawText(ctx, lt.abbr, lx + kitW + 3, ly, SC, "#ffffff");
  drawText(ctx, scoreStr, lx + kitW + 3 + lW + GAP, ly, SC, "#ffe66b");
  drawText(ctx, rt.abbr, lx + kitW + 3 + lW + GAP + sW + GAP, ly, SC, "#ffffff");
  drawKit(ctx, rightKey, lx + kitW + 3 + lW + GAP + sW + GAP + rW + 3 + 5, ly + 4, KS, rightKitType);
  const clkW = textWidth(clockStr, 1);
  const clkX = lx + kitW + 3 + lW + GAP + Math.floor((sW - clkW) / 2);
  drawText(ctx, clockStr, clkX, ly + 13, 1, clockColor);
}

// ---------------------------------------------------------------------------
// Pixel pause icon bar — top-right corner, visible during PLAYING state.
// Six buttons: pause/play · controls · restart · crowd · sfx · collapse
// collapse is always at the far-right edge; the other 5 sit to its left.
// ---------------------------------------------------------------------------
// Slightly smaller than the scoreboard (28px) — 20px fits the pixel-art icons cleanly
const SB_H = 20;
const PIB = { btnW: SB_H, btnH: SB_H, gap: 2, count: 5, margin: 2 };
// 5 game buttons + 1 collapse button
PIB.gameW = PIB.count * PIB.btnW + (PIB.count - 1) * PIB.gap; // 108
PIB.collapseX = VIEW_W - PIB.margin - PIB.btnW;                // always at right
PIB.x = PIB.collapseX - PIB.gap - PIB.gameW;                  // left edge of game buttons
PIB.y = PIB.margin + 4;

function pibRect(i) {
  return { x: PIB.x + i * (PIB.btnW + PIB.gap), y: PIB.y };
}

function pibBtn(bx, by, active, hover) {
  const W = PIB.btnW, H = PIB.btnH;
  ctx.fillStyle = active ? "#ffffff" : "#000000";
  ctx.fillRect(bx, by, W, H);
  ctx.fillStyle = active ? "#000000" : hover ? "#aaaaaa" : "#ffffff";
  ctx.fillRect(bx, by, W, 1);
  ctx.fillRect(bx, by + H - 1, W, 1);
  ctx.fillRect(bx, by, 1, H);
  ctx.fillRect(bx + W - 1, by, 1, H);
}

// Returns true if the click was consumed by the icon bar.
function pibHandleClick(cx, cy) {
  if (state !== STATE.PLAYING) return false;
  const by = PIB.y;
  // Collapse toggle — always active
  if (cx >= PIB.collapseX && cx < PIB.collapseX + PIB.btnW && cy >= by && cy < by + PIB.btnH) {
    pibCollapsed = !pibCollapsed;
    if (pibCollapsed) controlsOpen = false;
    return true;
  }
  if (pibCollapsed) return false;
  for (let i = 0; i < PIB.count; i++) {
    const r = pibRect(i);
    if (cx >= r.x && cx < r.x + PIB.btnW && cy >= r.y && cy < r.y + PIB.btnH) {
      if (i === 0) togglePause();
      else if (i === 1) controlsOpen = !controlsOpen;
      else if (i === 2) { paused = false; autoPlay = false; state = STATE.TITLE; }
      else if (i === 3) Sfx.setCrowdOff(!Sfx.crowdOff);
      else if (i === 4) Sfx.setSfxOff(!Sfx.sfxOff);
      return true;
    }
  }
  return false;
}

function drawPauseIconBar() {
  if (state !== STATE.PLAYING) return;
  const by = PIB.y;

  // Collapse / expand button — always visible at far right
  const hoverC = mouseActive && mouseX >= PIB.collapseX && mouseX < PIB.collapseX + PIB.btnW && mouseY >= by && mouseY < by + PIB.btnH;
  pibBtn(PIB.collapseX, by, false, hoverC);
  const chevCol = "#ffffff";
  if (pibCollapsed) pibDrawChevronRight(PIB.collapseX + 3, by + 3, chevCol);
  else pibDrawChevronLeft(PIB.collapseX + 3, by + 3, chevCol);

  if (pibCollapsed) return;

  for (let i = 0; i < PIB.count; i++) {
    const r = pibRect(i);
    const bx = r.x;
    const hover = mouseActive && mouseX >= bx && mouseX < bx + PIB.btnW && mouseY >= by && mouseY < by + PIB.btnH;
    const active = (i === 0 && paused) || (i === 1 && controlsOpen) || (i === 3 && Sfx.crowdOff) || (i === 4 && Sfx.sfxOff);
    pibBtn(bx, by, active, hover);
    const ic = active ? "#000000" : "#ffffff";
    // Center 14px icons in 20px button: 3px inset
    const ix = bx + 3, iy = by + 3;
    if (i === 0) { if (paused) pibDrawPlay(ix, iy, ic); else pibDrawPause(ix, iy, ic); }
    else if (i === 1) pibDrawDpad(ix, iy, ic);
    else if (i === 2) pibDrawRestart(ix, iy, ic);
    else if (i === 3) pibDrawVolume(ix, iy, ic);
    else if (i === 4) pibDrawSfx(ix, iy, ic);
  }
}

function pibDrawPause(bx, by, col) {
  ctx.fillStyle = col;
  ctx.fillRect(bx + 3, by + 3, 3, 8); // left bar
  ctx.fillRect(bx + 8, by + 3, 3, 8); // right bar
}

function pibDrawPlay(bx, by, col) {
  ctx.fillStyle = col;
  const ws = [1, 2, 3, 4, 5, 5, 4, 3, 2, 1];
  for (let r = 0; r < 10; r++) ctx.fillRect(bx + 3, by + 2 + r, ws[r], 1);
}

function pibDrawDpad(bx, by, col) {
  ctx.fillStyle = col;
  ctx.fillRect(bx + 5, by + 1, 4, 12); // vertical arm
  ctx.fillRect(bx + 1, by + 5, 12, 4); // horizontal arm
}

function pibDrawRestart(bx, by, col) {
  ctx.fillStyle = col;
  const pts = [
    [11,7],[10,9],[10,10],[9,10],[8,11],[7,11],[6,11],
    [5,10],[4,10],[4,9],[3,8],[3,7],[3,6],[4,5],[4,4],
    [5,4],[6,3],[7,3],[8,3],[9,4],[10,4],
  ];
  for (const [px, py] of pts) ctx.fillRect(bx + px, by + py, 1, 1);
  ctx.fillRect(bx + 10, by + 3, 2, 1); // horizontal bar
  ctx.fillRect(bx + 11, by + 4, 1, 2); // drop down
}

function pibDrawVolume(bx, by, col) {
  ctx.fillStyle = col;
  ctx.fillRect(bx + 1, by + 5, 3, 4);  // speaker body
  ctx.fillRect(bx + 4, by + 5, 1, 4);
  ctx.fillRect(bx + 5, by + 4, 1, 6);
  ctx.fillRect(bx + 6, by + 3, 1, 8);
  if (Sfx.crowdOff) {
    ctx.fillStyle = col;
    for (let k = 0; k < 4; k++) {
      ctx.fillRect(bx + 8 + k, by + 3 + k, 1, 1);
      ctx.fillRect(bx + 11 - k, by + 3 + k, 1, 1);
    }
  } else {
    ctx.fillRect(bx + 8, by + 5, 1, 4);
    ctx.fillRect(bx + 10, by + 3, 1, 8);
  }
}

function pibDrawSfx(bx, by, col) {
  ctx.fillStyle = col;
  // Musical note: head (bottom-left) + stem (right of head, going up) + flag
  ctx.fillRect(bx + 1, by + 9, 5, 3);   // note head body
  ctx.fillRect(bx + 2, by + 8, 3, 1);   // head top taper
  ctx.fillRect(bx + 5, by + 1, 1, 9);   // stem
  ctx.fillRect(bx + 5, by + 1, 4, 1);   // flag horizontal
  ctx.fillRect(bx + 8, by + 1, 1, 4);   // flag drop
  if (Sfx.sfxOff) {
    // X cross on the right side
    for (let k = 0; k < 5; k++) {
      ctx.fillRect(bx + 9 + k, by + 2 + k, 1, 1);
      ctx.fillRect(bx + 13 - k, by + 2 + k, 1, 1);
    }
  }
}

function pibDrawChevronLeft(bx, by, col) {
  ctx.fillStyle = col;
  for (let r = 0; r < 5; r++) {
    ctx.fillRect(bx + 8 - r, by + 3 + r, 1, 1);
    if (r > 0) ctx.fillRect(bx + 8 - r, by + 11 - r, 1, 1);
  }
}

function pibDrawChevronRight(bx, by, col) {
  ctx.fillStyle = col;
  for (let r = 0; r < 5; r++) {
    ctx.fillRect(bx + 5 + r, by + 3 + r, 1, 1);
    if (r > 0) ctx.fillRect(bx + 5 + r, by + 11 - r, 1, 1);
  }
}

// Controls reference panel (drawn in top-right when controlsOpen).
function drawControlsPanel() {
  const panW = 172, panX = VIEW_W - PIB.margin - panW, panY = PIB.y + PIB.btnH + 3;
  const rows = [
    ["MOVE", "WASD / ARROWS"],
    ["AIM", "MOUSE"],
    ["KICK / TACKLE", "HOLD LMB"],
    ["SWITCH", "E"],
    ["SPRINT", "SHIFT"],
    ["PAUSE", "P / ESC"],
    ["SUBS", "B"],
  ];
  const panH = 14 + rows.length * 12 + 5;

  ctx.fillStyle = "rgba(5,10,22,0.97)";
  ctx.fillRect(panX, panY, panW, panH);

  // Border
  ctx.fillStyle = "#1e3254";
  ctx.fillRect(panX, panY, panW, 1);
  ctx.fillRect(panX, panY + panH - 1, panW, 1);
  ctx.fillRect(panX, panY, 1, panH);
  ctx.fillRect(panX + panW - 1, panY, 1, panH);

  // Header bar
  ctx.fillStyle = "rgba(12,24,50,1)";
  ctx.fillRect(panX + 1, panY + 1, panW - 2, 12);
  drawTextCentered(ctx, "CONTROLS", panX + panW / 2, panY + 3, 1, "#ffe66b");

  for (let i = 0; i < rows.length; i++) {
    const ry = panY + 16 + i * 12;
    drawText(ctx, rows[i][0], panX + 6, ry, 1, "#6a8ab8");
    drawText(ctx, rows[i][1], panX + 56, ry, 1, "#c8dcf8");
  }
}

function drawOverlays() {
  if (state === STATE.WC) {
    WC.render(ctx, blinkT);
    return;
  }
  if (state === STATE.TITLE) {
    dim(0.55);
    drawTextCentered(ctx, "WORLD CUP JAM", VIEW_W / 2, 88, 6, "#ffe66b");
    drawTextCentered(
      ctx,
      FEATURE.teamSelect ? "QUICK PLAY  OR  WORLD CUP" : "BRAZIL  VS  ARGENTINA",
      VIEW_W / 2,
      136,
      2,
      "#ffffff"
    );
    const pbx = VIEW_W / 2 - 120, pby = 178, pbw = 240, pbh = 56;
    const pbHover = mouseActive && mouseX >= pbx && mouseX <= pbx + pbw && mouseY >= pby && mouseY <= pby + pbh;
    ctx.fillStyle = pbHover ? "#1e4a28" : "#112a18";
    ctx.fillRect(pbx, pby, pbw, pbh);
    ctx.strokeStyle = pbHover ? "#ffffff" : "#9fe6b0";
    ctx.lineWidth = 2;
    ctx.strokeRect(pbx + 1, pby + 1, pbw - 2, pbh - 2);
    drawTextCentered(ctx, "PLAY", VIEW_W / 2, pby + Math.round((pbh - 15) / 2), 3, pbHover ? "#ffffff" : "#9fe6b0");
    return;
  }
  if (state === STATE.TEAM_SELECT) {
    drawTeamSelect();
    return;
  }
  if (state === STATE.SQUAD) {
    drawSquad();
    return;
  }
  if (state === STATE.HALFTIME) {
    dim(0.65);
    drawTextCentered(ctx, "HALF TIME", VIEW_W / 2, 96, 6, "#ffffff");
    drawTextCentered(ctx, `${scoreL} - ${scoreR}`, VIEW_W / 2, 148, 6, "#ffe66b");
    blink(() => drawTextCentered(ctx, "PRESS ENTER TO CONTINUE", VIEW_W / 2, 204, 2, "#9fe6b0"));
    return;
  }
  if (state === STATE.KICKOFF) {
    blink(() => drawTextCentered(ctx, "KICK OFF", VIEW_W / 2, VIEW_H / 2 - 4, 3, "#ffffff"));
    if (autoPlay) {
      const cx = VIEW_W / 2;
      const my = VIEW_H / 2 + 52;
      const lt = teamData(leftKey);
      const rt = teamData(rightKey);
      drawKit(ctx, leftKey, cx - 140, my, 3, leftKitType);
      drawTextCentered(ctx, lt.name, cx - 90, my - 14, 1, "#eaf0ff");
      drawTextCentered(ctx, "VS", cx, my - 8, 2, "#ffe66b");
      drawKit(ctx, rightKey, cx + 140, my, 3, rightKitType);
      drawTextCentered(ctx, rt.name, cx + 90, my - 14, 1, "#eaf0ff");
    }
  }
  if (state === STATE.GOAL) {
    dim(0.35);
    const flash = Math.floor(blinkT * 8) % 2 === 0;
    drawTextCentered(ctx, goalText, VIEW_W / 2, VIEW_H / 2 - 8, 4, flash ? "#ffe66b" : "#ff7b7b");
  }
  if (state === STATE.FULLTIME) {
    dim(0.6);
    drawTextCentered(ctx, "FULL TIME", VIEW_W / 2, 96, 6, "#ffffff");
    drawTextCentered(ctx, `${scoreL} - ${scoreR}`, VIEW_W / 2, 144, 6, "#ffe66b");
    if (autoPlay) {
      const cx = VIEW_W / 2;
      const ky = 168;
      drawKit(ctx, leftKey, cx - 190, ky, 3, leftKitType);
      drawTextCentered(ctx, teamData(leftKey).name, cx - 140, 148, 1, "#eaf0ff");
      drawKit(ctx, rightKey, cx + 190, ky, 3, rightKitType);
      drawTextCentered(ctx, teamData(rightKey).name, cx + 140, 148, 1, "#eaf0ff");
    }
    drawTextCentered(ctx, winnerText, VIEW_W / 2, 196, 2, "#9fe6b0");
    if (autoPlay) {
      const secs = Math.ceil(Math.max(stateTimer, 0));
      blink(() => drawTextCentered(ctx, `NEXT MATCH IN ${secs}...  ENTER SKIP  ESC MENU`, VIEW_W / 2, 232, 1, "#9fe6b0"));
    } else if (inTournament) {
      blink(() => drawTextCentered(ctx, "ENTER  BACK TO WORLD CUP", VIEW_W / 2, 226, 2, "#9fe6b0"));
    } else if (FEATURE.teamSelect) {
      blink(() =>
        drawTextCentered(ctx, "ENTER  NEW GAME  (PICK 2 NEW TEAMS)", VIEW_W / 2, 220, 2, "#9fe6b0")
      );
      drawTextCentered(ctx, "R  REMATCH SAME TEAMS", VIEW_W / 2, 240, 1, "#bcd3ff");
    } else {
      blink(() => drawTextCentered(ctx, "ENTER  NEW GAME      R  REMATCH", VIEW_W / 2, 234, 1, "#bcd3ff"));
    }
  }

  if (charge > 0 && controlled) {
    const t = charge / CHARGE_TIME;
    const bx = controlled.x - 6;
    const by = controlled.y - 11;
    const barW = 12;
    const stealMode = ball.owner && ball.owner !== controlled &&
      ball.owner.teamKey !== controlled.teamKey &&
      len(ball.owner.x - controlled.x, ball.owner.y - controlled.y) < STEAL_PROMPT_RANGE;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx - 1, by - 1, barW + 2, 4);
    if (stealMode) {
      // Defend mode: dark base bar + gold target zone + white cursor
      ctx.fillStyle = "#2a3a5a";
      ctx.fillRect(bx, by, barW, 2);
      const hw = stealGoldHalfWidth(controlled, ball.owner);
      const golL = Math.round(barW * clamp(STEAL_GOLD_CENTER - hw, 0, 1));
      const golR = Math.round(barW * clamp(STEAL_GOLD_CENTER + hw, 0, 1));
      ctx.fillStyle = "#ffd23b";
      ctx.fillRect(bx + golL, by, Math.max(1, golR - golL), 2);
      const cx = clamp(Math.round(barW * t), 0, barW - 1);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(bx + cx, by, 1, 2);
    } else {
      // Attack mode: color-coded power fill
      ctx.fillStyle = t < 0.6 ? "#7bff8a" : t < 0.85 ? "#ffe66b" : "#ff6b6b";
      ctx.fillRect(bx, by, Math.round(barW * t), 2);
    }
  }

  if (unluckyFlash.t > 0 && state === STATE.PLAYING && !paused) {
    const progress = 1 - unluckyFlash.t / UNLUCKY_DURATION;
    const alpha = clamp(unluckyFlash.t / 0.28, 0, 1);
    const fy = unluckyFlash.y - 10 - progress * 18;
    ctx.globalAlpha = alpha;
    drawTextCentered(ctx, "CLOSE!", unluckyFlash.x, fy, 2, "#ff8c42");
    ctx.globalAlpha = 1;
  }

  if (setpieceTimer > 0 && state === STATE.PLAYING && !paused) {
    drawTextCentered(ctx, setpieceLabel, VIEW_W / 2, 30, 2, "#ffe66b");
  }

  // In-match substitutions hint (squad matches only).
  if (state === STATE.PLAYING && !paused && !subOpen && FEATURE.teamSelect && hasSquads()) {
    const left = subsUsedL < MAX_SUBS ? `B  SUBS (${MAX_SUBS - subsUsedL})` : "NO SUBS LEFT";
    drawText(ctx, left, 6, VIEW_H - 10, 1, "rgba(205,217,240,0.55)");
  }
}

function dim(a) {
  ctx.fillStyle = `rgba(4,8,18,${a})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}
let blinkT = 0;
function blink(fn) {
  if (Math.floor(blinkT * 2) % 2 === 0) fn();
}

// ---------------------------------------------------------------------------
// Team select / squad / substitutions  (only reachable when FEATURE.teamSelect)
// ---------------------------------------------------------------------------

// A "squad match" (team-select flow) enables subs + team OVR; the classic
// flag-off BRA-vs-ARG game does not.
function hasSquads() {
  return isSquadMatch;
}

// Colour a rating / a position label by quality / line so the board reads fast.
function ovrColor(o) {
  return o >= 85 ? "#7cff8a" : o >= 80 ? "#bfe66b" : o >= 76 ? "#ffe66b" : "#d2a24a";
}
function lineColor(line) {
  return line === "GK"
    ? "#e0a91f"
    : line === "DEF"
    ? "#7fbfe6"
    : line === "MID"
    ? "#9fe6b0"
    : "#ff9b6b";
}
function eligibleBench(bench, line) {
  return bench.filter((b) => b.line === line);
}

function enterTeamSelect() {
  selStage = "home";
  gridCursor = Math.max(0, NATION_KEYS.indexOf("BRA"));
  pickedHome = null;
  pickedAway = null;
  teamSearchQuery = "";
  teamSearchFocused = false;
  state = STATE.TEAM_SELECT;
  ensureCursorVisible();
}

// --- Team grid geometry: 4 columns, vertically scrolling (64 teams). ---
let gridScroll = 0; // index of the top visible row
const GRID = { cols: 4, vis: 3, cw: 132, ch: 70, gx: 12, gy: 10, y0: 96, x0: 0 };
GRID.x0 = Math.round((VIEW_W - (GRID.cols * GRID.cw + (GRID.cols - 1) * GRID.gx)) / 2);
function getFilteredKeys() {
  if (!teamSearchQuery) return NATION_KEYS;
  const q = teamSearchQuery.toLowerCase();
  return NATION_KEYS.filter(k => {
    const t = teamData(k);
    return k.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
  });
}
const gridRows = () => Math.ceil(getFilteredKeys().length / GRID.cols);
function gridCellRect(i) {
  const col = i % GRID.cols;
  const row = ((i / GRID.cols) | 0) - gridScroll;
  return {
    x: GRID.x0 + col * (GRID.cw + GRID.gx),
    y: GRID.y0 + row * (GRID.ch + GRID.gy),
    w: GRID.cw,
    h: GRID.ch,
    visible: row >= 0 && row < GRID.vis,
  };
}
function ensureCursorVisible() {
  const row = (gridCursor / GRID.cols) | 0;
  if (row < gridScroll) gridScroll = row;
  else if (row >= gridScroll + GRID.vis) gridScroll = row - GRID.vis + 1;
  gridScroll = clamp(gridScroll, 0, Math.max(0, gridRows() - GRID.vis));
}
function gridHit(mx, my) {
  const fk = getFilteredKeys();
  for (let i = 0; i < fk.length; i++) {
    const r = gridCellRect(i);
    if (!r.visible) continue;
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return i;
  }
  return -1;
}

function colorDist(c1, c2) {
  const parse = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const [r1, g1, b1] = parse(c1);
  const [r2, g2, b2] = parse(c2);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function kitAutoRight(lKey, lKit, rKey) {
  const lShirt = lKit === "away" ? NATIONS[lKey].away.shirt : NATIONS[lKey].shirt;
  return colorDist(lShirt, NATIONS[rKey].shirt) < 80 ? "away" : "home";
}

function updateTeamSelect() {
  if (selStage === "kit") {
    if (kitInputDone) return;
    kitInputDone = true;
    if (keyPressed("back")) {
      selStage = "away";
      pickedAway = null;
      leftKitType = "home";
      rightKitType = "home";
      return;
    }
    if (pressed.has("a") || pressed.has("d")) {
      leftKitType = leftKitType === "home" ? "away" : "home";
    }
    if (pressed.has("arrowleft") || pressed.has("arrowright")) {
      rightKitType = rightKitType === "home" ? "away" : "home";
    }
    if (clickPending) {
      const KIT_Y = 185, KS = 5;
      const HOME_X = 110, AWAY_X = 210, OPP_HOME_X = 430, OPP_AWAY_X = 530;
      // Clicking a kit that's already selected, or the PLAY button, starts the match.
      if (clickY > KIT_Y - KS * 4 - 10 && clickY < KIT_Y + KS * 7) {
        if (Math.abs(clickX - HOME_X) < KS * 6) {
          if (leftKitType === "home") { setupMatch(pickedHome, pickedAway, true, leftKitType, rightKitType); return; }
          leftKitType = "home";
        } else if (Math.abs(clickX - AWAY_X) < KS * 6) {
          if (leftKitType === "away") { setupMatch(pickedHome, pickedAway, true, leftKitType, rightKitType); return; }
          leftKitType = "away";
        } else if (Math.abs(clickX - OPP_HOME_X) < KS * 6) {
          if (rightKitType === "home") { setupMatch(pickedHome, pickedAway, true, leftKitType, rightKitType); return; }
          rightKitType = "home";
        } else if (Math.abs(clickX - OPP_AWAY_X) < KS * 6) {
          if (rightKitType === "away") { setupMatch(pickedHome, pickedAway, true, leftKitType, rightKitType); return; }
          rightKitType = "away";
        }
      } else {
        const kpby = VIEW_H - 48;
        if (clickX >= VIEW_W / 2 - 90 && clickX <= VIEW_W / 2 + 90 && clickY >= kpby && clickY <= kpby + 28) {
          setupMatch(pickedHome, pickedAway, true, leftKitType, rightKitType);
          return;
        }
      }
    }
    if (keyPressed("start")) {
      setupMatch(pickedHome, pickedAway, true, leftKitType, rightKitType);
    }
    return;
  }

  // Search bar click detection
  const sbX = GRID.x0, sbY = 76, sbW = GRID.cols * (GRID.cw + GRID.gx) - GRID.gx, sbH = 16;
  const sbClearX = sbX + sbW - 14;
  if (clickPending && clickY >= sbY && clickY <= sbY + sbH && clickX >= sbX && clickX <= sbX + sbW) {
    if (teamSearchQuery && clickX >= sbClearX) {
      teamSearchQuery = "";
      gridCursor = 0;
      gridScroll = 0;
    }
    teamSearchFocused = true;
    clickPending = false;
  } else if (clickPending) {
    teamSearchFocused = false;
  }

  // Typed characters go to search when search bar is focused
  if (teamSearchFocused) {
    const prevLen = teamSearchQuery.length;
    for (const k of pressed) {
      if (k.length === 1 && ((k >= "a" && k <= "z") || (k >= "0" && k <= "9"))) {
        teamSearchQuery += k.toUpperCase();
        pressed.delete(k);
      }
    }
    if (pressed.has("backspace") && teamSearchQuery.length > 0) {
      teamSearchQuery = teamSearchQuery.slice(0, -1);
      pressed.delete("backspace");
    } else if (pressed.has("escape") && teamSearchQuery) {
      teamSearchQuery = "";
      pressed.delete("escape");
    }
    if (teamSearchQuery.length !== prevLen) {
      gridCursor = 0;
      gridScroll = 0;
    }
  }

  const cols = GRID.cols;
  const filteredKeys = getFilteredKeys();
  const n = filteredKeys.length;
  // Keyboard nav moves the cursor and re-centres the scroll on it. The wheel
  // (handled in the listener above) scrolls the view freely without touching
  // the cursor, so only re-centre when a nav key was actually pressed.
  let navmoved = false;
  if (keyPressed("right")) { gridCursor = Math.min(n - 1, gridCursor + 1); navmoved = true; }
  if (keyPressed("left")) { gridCursor = Math.max(0, gridCursor - 1); navmoved = true; }
  if (keyPressed("down")) { gridCursor = Math.min(n - 1, gridCursor + cols); navmoved = true; }
  if (keyPressed("up")) { gridCursor = Math.max(0, gridCursor - cols); navmoved = true; }
  if (mouseActive && mouseMoved) {
    const h = gridHit(mouseX, mouseY);
    if (h >= 0) gridCursor = h;
  }
  if (navmoved) ensureCursorVisible();

  if (keyPressed("back")) {
    if (selStage === "away") {
      selStage = "home";
      pickedAway = null;
    } else {
      state = STATE.TITLE;
    }
    return;
  }

  let confirm = keyPressed("start");
  if (clickPending) {
    const h = gridHit(clickX, clickY);
    if (h >= 0) {
      gridCursor = h;
      confirm = true;
      teamSearchFocused = false;
    }
  }
  if (!confirm) return;

  const key = filteredKeys[gridCursor];
  if (!key) return;
  if (selStage === "home") {
    pickedHome = key;
    selStage = "away";
    // nudge the cursor off your own team for the opponent pick
    if (key === pickedHome) {
      const next = filteredKeys.findIndex((k) => k !== pickedHome);
      if (next >= 0) gridCursor = next;
    }
    ensureCursorVisible();
    Sfx.pass();
  } else {
    if (key === pickedHome) {
      Sfx.ooh();
      return; // can't play yourself
    }
    pickedAway = key;
    leftKitType = "home";
    rightKitType = kitAutoRight(pickedHome, "home", key);
    selStage = "kit";
    pressed.delete("enter"); // don't let this Enter bleed into kit-stage confirm
    Sfx.pass();
  }
}

function drawKitSelect() {
  const KS = 5, KIT_Y = 185, HOME_X = 110, AWAY_X = 210, OPP_HOME_X = 430, OPP_AWAY_X = 530;
  dim(0.74);
  drawTextCentered(ctx, "WORLD CUP JAM", VIEW_W / 2, 14, 3, "#ffe66b");
  drawTextCentered(ctx, "KIT SELECT", VIEW_W / 2, 46, 2, "#ffffff");

  // Divider
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(VIEW_W / 2 - 1, 70, 2, VIEW_H - 96);

  const boxW = KS * 12, boxH = KS * 11;
  const boxTop = KIT_Y - KS * 4 - 4;

  // --- Your team (left half) ---
  const lTeam = teamData(pickedHome);
  drawTextCentered(ctx, "YOUR TEAM", 160, 78, 1, "#9fe6b0");
  drawTextCentered(ctx, lTeam.name, 160, 94, 2, "#ffffff");

  // Home kit option
  ctx.strokeStyle = leftKitType === "home" ? "#ffe66b" : "#27406a";
  ctx.lineWidth = leftKitType === "home" ? 2 : 1;
  ctx.strokeRect(HOME_X - boxW / 2, boxTop, boxW, boxH);
  drawKit(ctx, pickedHome, HOME_X, KIT_Y, KS, "home");
  drawTextCentered(ctx, "HOME", HOME_X, KIT_Y + KS * 7, 1, leftKitType === "home" ? "#ffe66b" : "#6a84b0");

  // Away kit option
  ctx.strokeStyle = leftKitType === "away" ? "#ffe66b" : "#27406a";
  ctx.lineWidth = leftKitType === "away" ? 2 : 1;
  ctx.strokeRect(AWAY_X - boxW / 2, boxTop, boxW, boxH);
  drawKit(ctx, pickedHome, AWAY_X, KIT_Y, KS, "away");
  drawTextCentered(ctx, "AWAY", AWAY_X, KIT_Y + KS * 7, 1, leftKitType === "away" ? "#ffe66b" : "#6a84b0");

  blink(() => drawTextCentered(ctx, "A D  TOGGLE", 160, KIT_Y + KS * 9, 1, "#bcd3ff"));

  // --- Opponent (right half, manual) ---
  const rTeam = teamData(pickedAway);
  drawTextCentered(ctx, "OPPONENT", 480, 78, 1, "#f0a070");
  drawTextCentered(ctx, rTeam.name, 480, 94, 2, "#ffffff");

  // Opponent home kit option
  ctx.strokeStyle = rightKitType === "home" ? "#f0a070" : "#6a3020";
  ctx.lineWidth = rightKitType === "home" ? 2 : 1;
  ctx.strokeRect(OPP_HOME_X - boxW / 2, boxTop, boxW, boxH);
  drawKit(ctx, pickedAway, OPP_HOME_X, KIT_Y, KS, "home");
  drawTextCentered(ctx, "HOME", OPP_HOME_X, KIT_Y + KS * 7, 1, rightKitType === "home" ? "#f0a070" : "#6a7090");

  // Opponent away kit option
  ctx.strokeStyle = rightKitType === "away" ? "#f0a070" : "#6a3020";
  ctx.lineWidth = rightKitType === "away" ? 2 : 1;
  ctx.strokeRect(OPP_AWAY_X - boxW / 2, boxTop, boxW, boxH);
  drawKit(ctx, pickedAway, OPP_AWAY_X, KIT_Y, KS, "away");
  drawTextCentered(ctx, "AWAY", OPP_AWAY_X, KIT_Y + KS * 7, 1, rightKitType === "away" ? "#f0a070" : "#6a7090");

  blink(() => drawTextCentered(ctx, "← →  TOGGLE", 480, KIT_Y + KS * 9, 1, "#f0b080"));

  const kpbx = VIEW_W / 2 - 90, kpby = VIEW_H - 48, kpbw = 180, kpbh = 28;
  ctx.fillStyle = "#0e1e36";
  ctx.fillRect(kpbx, kpby, kpbw, kpbh);
  ctx.strokeStyle = "#ffe66b";
  ctx.lineWidth = 2;
  ctx.strokeRect(kpbx + 1, kpby + 1, kpbw - 2, kpbh - 2);
  drawTextCentered(ctx, "PLAY", VIEW_W / 2, kpby + 8, 2, "#ffe66b");
  drawTextCentered(ctx, "ESC BACK", VIEW_W / 2, VIEW_H - 12, 1, "#6a84b0");
}

function drawTeamSelect() {
  if (selStage === "kit") { drawKitSelect(); return; }
  dim(0.74);
  drawTextCentered(ctx, "WORLD CUP JAM", VIEW_W / 2, 14, 3, "#ffe66b");
  drawTextCentered(
    ctx,
    selStage === "home" ? "SELECT YOUR TEAM" : "SELECT OPPONENT",
    VIEW_W / 2,
    46,
    2,
    "#ffffff"
  );
  if (selStage === "away" && pickedHome) {
    drawTextCentered(ctx, "YOU  " + teamData(pickedHome).name, VIEW_W / 2, 66, 1, "#9fe6b0");
  }

  // Search bar
  const sbX = GRID.x0, sbY = 76, sbW = GRID.cols * (GRID.cw + GRID.gx) - GRID.gx, sbH = 16;
  ctx.fillStyle = teamSearchFocused ? "rgba(15,28,54,0.97)" : "rgba(11,20,38,0.88)";
  ctx.fillRect(sbX, sbY, sbW, sbH);
  ctx.strokeStyle = teamSearchFocused ? "#ffe66b" : "#27406a";
  ctx.lineWidth = 1;
  ctx.strokeRect(sbX, sbY, sbW, sbH);
  // Magnifying glass icon
  ctx.strokeStyle = teamSearchFocused ? "#ffe66b" : "#6a84b0";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(sbX + 9, sbY + 8, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sbX + 12, sbY + 11);
  ctx.lineTo(sbX + 15, sbY + 14);
  ctx.stroke();
  // Search text or placeholder
  const showCursor = teamSearchFocused && Math.floor(blinkT * 2) % 2 === 0;
  if (teamSearchQuery) {
    drawText(ctx, teamSearchQuery + (showCursor ? "_" : ""), sbX + 20, sbY + 4, 1, "#eaf0ff");
  } else {
    drawText(ctx, teamSearchFocused ? (showCursor ? "_" : "") : "SEARCH...", sbX + 20, sbY + 4, 1, teamSearchFocused ? "#eaf0ff" : "#3a5070");
  }
  // Clear (×) button when there's a query
  if (teamSearchQuery) {
    drawText(ctx, "X", sbX + sbW - 12, sbY + 4, 1, "#6a84b0");
  }

  const filteredKeys = getFilteredKeys();
  if (filteredKeys.length === 0) {
    drawTextCentered(ctx, "NO RESULTS", VIEW_W / 2, GRID.y0 + 28, 2, "#6a84b0");
  }
  for (let i = 0; i < filteredKeys.length; i++) {
    const r = gridCellRect(i);
    if (!r.visible) continue;
    const key = filteredKeys[i];
    const t = teamData(key);
    const isYou = selStage === "away" && key === pickedHome;
    const sel = i === gridCursor;
    ctx.fillStyle = isYou ? "rgba(18,42,30,0.92)" : "rgba(11,20,38,0.92)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = sel ? "#ffe66b" : "#27406a";
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    // Flag (nation) on the left, kit (uniform) on the right, team OVR below.
    t.drawFlag(ctx, key, r.x + 12, r.y + 10, 40, 26);
    drawKit(ctx, key, r.x + r.w - 26, r.y + 23, 1.5);
    drawTextCentered(ctx, t.name, r.x + r.w / 2, r.y + 44, 1, isYou ? "#7cff8a" : sel ? "#ffe66b" : "#eaf0ff");
    if (isYou) drawTextCentered(ctx, "YOUR TEAM", r.x + r.w / 2, r.y + 56, 1, "#7cff8a");
    else drawTextCentered(ctx, "OVR " + teamOvr(key), r.x + r.w / 2, r.y + 56, 1, ovrColor(teamOvr(key)));
  }

  // Scrollbar when there are more rows than fit.
  const rows = gridRows();
  if (rows > GRID.vis) {
    const trackX = GRID.x0 + GRID.cols * (GRID.cw + GRID.gx) - GRID.gx + 5;
    const trackY = GRID.y0;
    const trackH = GRID.vis * (GRID.ch + GRID.gy) - GRID.gy;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(trackX, trackY, 3, trackH);
    const thumbH = Math.max(12, (trackH * GRID.vis) / rows);
    const maxScroll = rows - GRID.vis;
    const thumbY = trackY + (maxScroll ? (gridScroll / maxScroll) * (trackH - thumbH) : 0);
    ctx.fillStyle = "#ffe66b";
    ctx.fillRect(trackX, thumbY, 3, thumbH);
  }

  blink(() =>
    drawTextCentered(
      ctx,
      selStage === "home" ? "ARROWS MOVE      ENTER / CLICK CHOOSE" : "ENTER / CLICK OPPONENT      ESC BACK",
      VIEW_W / 2,
      VIEW_H - 12,
      1,
      "#bcd3ff"
    )
  );
}

// --- Squad-board geometry (XI list left, bench right) ---
const SQ_X = 48, SQ_W = 286, SQ_Y = 92, SQ_RH = 15;
const BN_X = 356, BN_W = 236, BN_Y = 92, BN_RH = 15;
function squadRowY(i, closeIdx) {
  return SQ_Y + i * SQ_RH + (i === closeIdx ? 14 : 0); // RESUME row sits a touch lower
}
function squadRowHit(mx, my, count, closeIdx) {
  if (mx < SQ_X - 4 || mx > SQ_X + SQ_W) return -1;
  for (let i = 0; i < count; i++) {
    const y = squadRowY(i, closeIdx);
    if (my >= y - 3 && my <= y + SQ_RH - 4) return i;
  }
  return -1;
}
function benchRowHit(mx, my, count) {
  if (mx < BN_X - 4 || mx > BN_X + BN_W) return -1;
  for (let i = 0; i < count; i++) {
    const y = BN_Y + i * BN_RH;
    if (my >= y - 3 && my <= y + BN_RH - 4) return i;
  }
  return -1;
}

function initSquadWork() {
  const sq = NATIONS[pickedHome].squad;
  squadStarters = sq.starters.map((p) => ({ ...p }));
  squadBench = sq.bench.map((p) => ({ ...p }));
  squadSel = 0;
  squadPickBench = -1;
}

function swapWorkingStarter(starterIdx, benchPlayer) {
  const bi = squadBench.indexOf(benchPlayer);
  if (bi < 0) return;
  const out = squadStarters[starterIdx];
  squadStarters[starterIdx] = benchPlayer; // bench player joins the XI in this slot
  squadBench[bi] = out; // displaced starter drops to the bench
  Sfx.pass();
}

function startSquadMatch() {
  const away = NATIONS[pickedAway].squad;
  setupMatch(
    pickedHome,
    pickedAway,
    squadStarters,
    away.starters.map((p) => ({ ...p })),
    squadBench,
    away.bench.map((p) => ({ ...p }))
  );
  Sfx.whistle();
}

function updateSquad() {
  if (squadPickBench < 0) {
    if (keyPressed("down")) squadSel = (squadSel + 1) % 12;
    if (keyPressed("up")) squadSel = (squadSel + 11) % 12;
    if (mouseActive) {
      const row = squadRowHit(mouseX, mouseY);
      if (row >= 0) squadSel = row;
    }
    if (keyPressed("back")) {
      selStage = "away";
      state = STATE.TEAM_SELECT;
      return;
    }
    let confirm = keyPressed("start");
    if (clickPending) {
      const c = squadRowHit(clickX, clickY);
      if (c >= 0) {
        squadSel = c;
        confirm = true;
      }
    }
    if (confirm) {
      if (squadSel === 11) startSquadMatch();
      else if (eligibleBench(squadBench, squadStarters[squadSel].line).length) squadPickBench = 0;
      else Sfx.ooh();
    }
  } else {
    const elig = eligibleBench(squadBench, squadStarters[squadSel].line);
    if (!elig.length) {
      squadPickBench = -1;
      return;
    }
    if (keyPressed("down")) squadPickBench = (squadPickBench + 1) % elig.length;
    if (keyPressed("up")) squadPickBench = (squadPickBench + elig.length - 1) % elig.length;
    if (mouseActive && mouseMoved) {
      const r = benchRowHit(mouseX, mouseY, elig.length);
      if (r >= 0) squadPickBench = r;
    }
    if (keyPressed("back")) {
      squadPickBench = -1;
      return;
    }
    let confirm = keyPressed("start");
    if (clickPending) {
      const c = benchRowHit(clickX, clickY, elig.length);
      if (c >= 0) {
        squadPickBench = c;
        confirm = true;
      }
    }
    if (confirm) {
      swapWorkingStarter(squadSel, elig[squadPickBench]);
      squadPickBench = -1;
    }
  }
}

function drawSquad() {
  dim(0.8);
  const t = teamData(pickedHome);
  drawTextCentered(ctx, t.name + "   OVR " + teamOvr(pickedHome), VIEW_W / 2, 18, 2, "#ffe66b");
  drawTextCentered(ctx, "YOUR STARTING XI", VIEW_W / 2, 44, 1, "#9fb6e0");
  drawText(ctx, "VS  " + teamData(pickedAway).name + "  OVR " + teamOvr(pickedAway), SQ_X, 60, 1, "#bcd3ff");

  drawText(ctx, "POS", SQ_X, SQ_Y - 14, 1, "#5f7099");
  drawText(ctx, "PLAYER", SQ_X + 36, SQ_Y - 14, 1, "#5f7099");
  drawText(ctx, "OVR", SQ_X + SQ_W - 22, SQ_Y - 14, 1, "#5f7099");

  for (let i = 0; i < 11; i++) {
    const p = squadStarters[i];
    const y = squadRowY(i);
    const sel = squadPickBench < 0 && i === squadSel;
    if (sel) {
      ctx.fillStyle = "rgba(255,230,107,0.14)";
      ctx.fillRect(SQ_X - 4, y - 3, SQ_W + 8, SQ_RH - 1);
    }
    drawText(ctx, p.pos, SQ_X, y, 1, lineColor(p.line));
    drawText(ctx, p.name, SQ_X + 36, y, 1, sel ? "#ffe66b" : "#eaf0ff");
    drawText(ctx, "" + p.ovr, SQ_X + SQ_W - 22, y, 1, ovrColor(p.ovr));
  }
  // START row
  const sy = squadRowY(11);
  const startSel = squadPickBench < 0 && squadSel === 11;
  if (startSel) {
    ctx.fillStyle = "rgba(124,255,138,0.2)";
    ctx.fillRect(SQ_X - 4, sy - 3, SQ_W + 8, SQ_RH + 1);
  }
  drawText(ctx, "START MATCH", SQ_X, sy, 2, startSel ? "#aaffb8" : "#7bdc8a");

  // Bench panel
  drawText(ctx, "BENCH", BN_X, SQ_Y - 14, 1, "#5f7099");
  if (squadPickBench < 0) {
    for (let i = 0; i < squadBench.length; i++) {
      const b = squadBench[i];
      const y = BN_Y + i * BN_RH;
      drawText(ctx, b.pos, BN_X, y, 1, lineColor(b.line));
      drawText(ctx, b.name, BN_X + 36, y, 1, "#aeb9d6");
      drawText(ctx, "" + b.ovr, BN_X + BN_W - 22, y, 1, ovrColor(b.ovr));
    }
    drawTextCentered(ctx, "UP/DOWN  ENTER SWAP / START  ESC BACK", VIEW_W / 2, VIEW_H - 14, 1, "#7e8db3");
  } else {
    const star = squadStarters[squadSel];
    const elig = eligibleBench(squadBench, star.line);
    drawText(ctx, "ON FOR  " + star.name + "  (" + star.line + ")", BN_X, SQ_Y - 28, 1, "#9fe6b0");
    for (let i = 0; i < elig.length; i++) {
      const b = elig[i];
      const y = BN_Y + i * BN_RH;
      const sel = i === squadPickBench;
      if (sel) {
        ctx.fillStyle = "rgba(255,230,107,0.14)";
        ctx.fillRect(BN_X - 4, y - 3, BN_W + 8, BN_RH - 1);
      }
      drawText(ctx, b.pos, BN_X, y, 1, lineColor(b.line));
      drawText(ctx, b.name, BN_X + 36, y, 1, sel ? "#ffe66b" : "#aeb9d6");
      drawText(ctx, "" + b.ovr, BN_X + BN_W - 22, y, 1, ovrColor(b.ovr));
    }
    drawTextCentered(ctx, "ENTER CONFIRM SWAP   ESC CANCEL", VIEW_W / 2, VIEW_H - 14, 1, "#7e8db3");
  }
}

// --- In-match substitutions board (operates on the live left team + bench) ---
function doLiveSub(idx, inData) {
  const bi = benchL.indexOf(inData);
  if (bi < 0 || subsUsedL >= MAX_SUBS) return;
  const onP = left[idx];
  // Players are generic + share the team OVR, so a sub just swaps the shirt
  // number/label; ability is unchanged.
  const outData = { line: onP.slot.role, pos: onP.pos, num: onP.num, ovr: onP.ovr };
  onP.pos = inData.pos;
  onP.num = inData.num;
  benchL[bi] = outData;
  subsUsedL++;
  Sfx.whistle();
}

function updateSubMenu() {
  const N = left.length; // on-pitch count (7-a-side, 11, ...)
  const rows = N + 1; // + RESUME
  if (squadSel > N) squadSel = N;
  if (squadPickBench < 0) {
    if (keyPressed("down")) squadSel = (squadSel + 1) % rows;
    if (keyPressed("up")) squadSel = (squadSel + rows - 1) % rows;
    if (mouseActive && mouseMoved) {
      const row = squadRowHit(mouseX, mouseY, rows, N);
      if (row >= 0) squadSel = row;
    }
    if (keyPressed("back") || keyPressed("subs")) {
      subOpen = false;
      return;
    }
    let confirm = keyPressed("start");
    if (clickPending) {
      const c = squadRowHit(clickX, clickY, rows, N);
      if (c >= 0) {
        squadSel = c;
        confirm = true;
      }
    }
    if (confirm) {
      if (squadSel === N) {
        subOpen = false;
        return;
      }
      if (subsUsedL >= MAX_SUBS) {
        Sfx.ooh();
        return;
      }
      if (eligibleBench(benchL, left[squadSel].slot.role).length) squadPickBench = 0;
      else Sfx.ooh();
    }
  } else {
    const elig = eligibleBench(benchL, left[squadSel].slot.role);
    if (!elig.length) {
      squadPickBench = -1;
      return;
    }
    if (keyPressed("down")) squadPickBench = (squadPickBench + 1) % elig.length;
    if (keyPressed("up")) squadPickBench = (squadPickBench + elig.length - 1) % elig.length;
    if (mouseActive && mouseMoved) {
      const r = benchRowHit(mouseX, mouseY, elig.length);
      if (r >= 0) squadPickBench = r;
    }
    if (keyPressed("back")) {
      squadPickBench = -1;
      return;
    }
    let confirm = keyPressed("start");
    if (clickPending) {
      const c = benchRowHit(clickX, clickY, elig.length);
      if (c >= 0) {
        squadPickBench = c;
        confirm = true;
      }
    }
    if (confirm) {
      doLiveSub(squadSel, elig[squadPickBench]);
      squadPickBench = -1;
    }
  }
}

function drawSubMenu() {
  dim(0.82);
  const N = left.length;
  drawTextCentered(ctx, "SUBSTITUTIONS", VIEW_W / 2, 18, 2, "#ffe66b");
  drawTextCentered(ctx, "SUBS LEFT  " + (MAX_SUBS - subsUsedL), VIEW_W / 2, 44, 1, "#9fb6e0");

  drawText(ctx, "ON PITCH", SQ_X, SQ_Y - 14, 1, "#5f7099");
  for (let i = 0; i < N; i++) {
    const p = left[i];
    const y = squadRowY(i, N);
    const sel = squadPickBench < 0 && i === squadSel;
    if (sel) {
      ctx.fillStyle = "rgba(255,230,107,0.14)";
      ctx.fillRect(SQ_X - 4, y - 3, SQ_W + 8, SQ_RH - 1);
    }
    drawText(ctx, p.pos, SQ_X, y, 1, lineColor(p.slot.role));
    drawText(ctx, "#" + p.num, SQ_X + 40, y, 1, sel ? "#ffe66b" : "#eaf0ff");
  }
  const sy = squadRowY(N, N);
  const closeSel = squadPickBench < 0 && squadSel === N;
  if (closeSel) {
    ctx.fillStyle = "rgba(124,255,138,0.2)";
    ctx.fillRect(SQ_X - 4, sy - 3, SQ_W + 8, SQ_RH + 1);
  }
  drawText(ctx, "RESUME MATCH", SQ_X, sy, 2, closeSel ? "#aaffb8" : "#7bdc8a");

  drawText(ctx, "BENCH", BN_X, SQ_Y - 14, 1, "#5f7099");
  if (squadPickBench < 0) {
    for (let i = 0; i < benchL.length; i++) {
      const b = benchL[i];
      const y = BN_Y + i * BN_RH;
      drawText(ctx, b.pos, BN_X, y, 1, lineColor(b.line));
      drawText(ctx, "#" + b.num, BN_X + 40, y, 1, "#aeb9d6");
    }
    drawTextCentered(ctx, "ENTER SWAP      B / ESC RESUME", VIEW_W / 2, VIEW_H - 14, 1, "#7e8db3");
  } else {
    const onP = left[squadSel];
    const elig = eligibleBench(benchL, onP.slot.role);
    drawText(ctx, "ON FOR  " + onP.pos + " #" + onP.num, BN_X, SQ_Y - 28, 1, "#9fe6b0");
    for (let i = 0; i < elig.length; i++) {
      const b = elig[i];
      const y = BN_Y + i * BN_RH;
      const sel = i === squadPickBench;
      if (sel) {
        ctx.fillStyle = "rgba(255,230,107,0.14)";
        ctx.fillRect(BN_X - 4, y - 3, BN_W + 8, BN_RH - 1);
      }
      drawText(ctx, b.pos, BN_X, y, 1, lineColor(b.line));
      drawText(ctx, "#" + b.num, BN_X + 40, y, 1, sel ? "#ffe66b" : "#aeb9d6");
    }
    drawTextCentered(ctx, "ENTER CONFIRM      ESC CANCEL", VIEW_W / 2, VIEW_H - 14, 1, "#7e8db3");
  }
}

// ---------------------------------------------------------------------------
// Loop (fixed timestep)
// ---------------------------------------------------------------------------
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
let rafId = null;
let fallbackId = null;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  acc += dt;
  blinkT += dt;
  while (acc >= STEP) {
    update(STEP);
    acc -= STEP;
  }
  render();
}

function rafLoop(now) {
  frame(now);
  rafId = requestAnimationFrame(rafLoop);
}

// Keep the loop alive in background/hidden tabs (e.g. embedded iframes).
function startFallback() {
  if (fallbackId) return;
  fallbackId = setInterval(() => frame(performance.now()), 1000 / 60);
}
function stopFallback() {
  if (!fallbackId) return;
  clearInterval(fallbackId);
  fallbackId = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
    rafId = null;
    startFallback();
  } else {
    stopFallback();
    last = performance.now();
    rafId = requestAnimationFrame(rafLoop);
  }
});

setupMatch();
state = STATE.TITLE;
if (document.hidden) {
  startFallback();
} else {
  rafId = requestAnimationFrame(rafLoop);
}

// Debug / verification hook (game advances via rAF, which browsers throttle in
// background tabs — drive it deterministically with tick()).
window.__wcj = {
  get state() {
    return state;
  },
  get tension() {
    return Math.round(audioTension() * 100) / 100;
  },
  get score() {
    return [scoreL, scoreR];
  },
  get clock() {
    return clock;
  },
  get ball() {
    return {
      x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy,
      owner: !!ball.owner, grace: +ball.graceTimer.toFixed(2),
      passTeam: ball.passTeam, passShield: ball.passShield,
    };
  },
  get owner() {
    return ball.owner ? ball.owner.teamKey + ":" + ball.owner.role : null;
  },
  get controlled() {
    return controlled ? { x: controlled.x, y: controlled.y, role: controlled.role } : null;
  },
  get charge() {
    return charge;
  },
  get keys() {
    return [...keys];
  },
  positions() {
    return players.map((p) => ({ t: p.teamKey, r: p.role, x: Math.round(p.x), y: Math.round(p.y) }));
  },
  start() {
    setupMatch(); // force a clean match (used by tests)
  },
  skipKickoff() {
    if (state === STATE.KICKOFF) {
      stateTimer = 0;
      state = STATE.PLAYING;
    }
  },
  tick(n = 60) {
    for (let i = 0; i < n; i++) update(STEP);
    render();
  },
  setFreeze(v) {
    freezeAI = !!v;
  },
  setTactics(v) {
    tacticsOn = !!v;
    return tacticsOn;
  },
  get paused() {
    return paused;
  },
  togglePause,
  setMouse(x, y, shoot = false) {
    mouseX = x;
    mouseY = y;
    mouseActive = true;
    mouseShoot = shoot;
  },
  placeBall(x, y, vx = 0, vy = 0) {
    ball.x = x;
    ball.y = y;
    ball.vx = vx;
    ball.vy = vy;
    ball.owner = null;
    ball.freeTimer = 0;
  },
  // Test helper: move the first player matching team/role and optionally hand
  // them the ball at their feet (used to reproduce specific game states).
  setPlayer(teamKey, role, x, y, makeOwner = false) {
    const team = teamKey === leftKey ? left : right;
    const p = team.find((q) => q.role === role) || team[0];
    p.x = x;
    p.y = y;
    p.vx = p.vy = p.dvx = p.dvy = 0;
    if (makeOwner) {
      ball.x = x + p.dir * DRIBBLE_OFFSET;
      ball.y = y;
      ball.vx = ball.vy = 0;
      ball.owner = p;
      ball.freeTimer = 0;
    }
    return { x: p.x, y: p.y, dir: p.dir };
  },
  // --- Team-select feature: verification helpers (flag stays off by default) ---
  get feature() {
    return FEATURE.teamSelect;
  },
  setFeature(v) {
    FEATURE.teamSelect = !!v;
    return FEATURE.teamSelect;
  },
  enterSelect() {
    enterTeamSelect();
  },
  get teams() {
    return {
      left: leftKey,
      right: rightKey,
      lOvr: hasSquads() ? teamOvr(leftKey) : null,
      rOvr: hasSquads() ? teamOvr(rightKey) : null,
      subsLeft: hasSquads() ? MAX_SUBS - subsUsedL : null,
    };
  },
  // Jump straight into a squad match (used by tests / quick verification).
  quickMatch(homeKey = "FRA", awayKey = "BRA") {
    setupMatch(homeKey, awayKey, true);
  },
  get teamCount() {
    return NATION_KEYS.length;
  },
  roster(side = "L") {
    const team = side === "L" ? left : right;
    return team.map((p) => ({ pos: p.pos, num: p.num, ovr: p.ovr, role: p.role }));
  },
  bench(side = "L") {
    return (side === "L" ? benchL : benchR).map((b) => ({ pos: b.pos, num: b.num, line: b.line }));
  },
  get crowdOff() { return Sfx.crowdOff; },
  setCrowdOff(v) { Sfx.setCrowdOff(v); },
  // --- World Cup tournament mode (verification) ---
  get wc() {
    return WC;
  },
  wcEnter() {
    WC.enter();
    state = STATE.WC;
  },
  // Jump straight to the hub of a tournament you're playing as `key`.
  wcStart(key = "BRA") {
    WC.devStartTournament(key);
    state = STATE.WC;
    return WC.snapshot();
  },
  get wcState() {
    return WC.snapshot();
  },
  get inTournament() {
    return inTournament;
  },
};
