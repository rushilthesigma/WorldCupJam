// ---------------------------------------------------------------------------
// World Cup tournament engine (pure logic — no rendering, no DOM).
//
// A 48-team World Cup in the 2026 format:
//   * 12 groups of 4, drawn from four OVR-seeded pots (a realistic random draw).
//   * Group stage = 3 matchdays; every team plays once per matchday.
//   * Top 2 of each group (24) + the 8 best third-placed teams advance to a
//     32-team single-elimination bracket: R32 -> R16 -> QF -> SF -> FINAL.
//   * Knockout ties can't be drawn — a level score is settled on penalties.
//
// The human plays exactly ONE match per matchweek (their own fixture); every
// other game that week is simulated here from the two teams' OVR. main.js feeds
// the human's real scoreline back in via recordPlayerMatch(); everything else
// is simMatch().
// ---------------------------------------------------------------------------
import { NATIONS, WC_KEYS } from "./nations.js";

export const GROUP_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

const ovr = (k) => NATIONS[k].ovr;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Knuth Poisson sampler — goal counts come from a Poisson distribution whose
// mean is set by each side's attacking strength.
function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

// Penalty shootout — best-of-5 then sudden death, conversion chance nudged by
// OVR. Returns [aGoals, bGoals], always decisive.
export function penShootout(aKey, bKey) {
  const shot = (q) => Math.random() < 0.6 + (q - 75) * 0.006;
  const qa = ovr(aKey);
  const qb = ovr(bKey);
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < 5; i++) {
    if (shot(qa)) sa++;
    if (shot(qb)) sb++;
  }
  while (sa === sb) {
    sa += shot(qa) ? 1 : 0;
    sb += shot(qb) ? 1 : 0;
  }
  return [sa, sb];
}

// Simulate one CPU-vs-CPU match. Expected goals swing with the OVR gap, but
// each team also gets an independent random form factor so upsets are possible.
export function simMatch(aKey, bKey, knockout = false) {
  const gap = ovr(aKey) - ovr(bKey);
  const la = clamp(1.4 + gap * 0.06 + (Math.random() - 0.5) * 0.52, 0.2, 4.5);
  const lb = clamp(1.4 - gap * 0.06 + (Math.random() - 0.5) * 0.52, 0.2, 4.5);
  const a = poisson(la);
  const b = poisson(lb);
  const r = { a, b, pens: null, winner: null };
  if (knockout) {
    if (a === b) {
      const pens = penShootout(aKey, bKey);
      r.pens = pens;
      r.winner = pens[0] > pens[1] ? aKey : bKey;
    } else {
      r.winner = a > b ? aKey : bKey;
    }
  }
  return r;
}

// Round-robin schedule for a 4-team group: indices into group.teams, one match
// per team per matchday, all six pairings used across the three matchdays.
const RR = [
  [[0, 1], [2, 3]],
  [[0, 2], [3, 1]],
  [[0, 3], [1, 2]],
];

// ---------------------------------------------------------------------------
// Actual 2026 FIFA World Cup groups (draw held 5 Dec 2025, Washington D.C.)
// ---------------------------------------------------------------------------
const GROUPS_2026 = [
  ["A", ["MEX", "RSA", "KOR", "CZE"]],
  ["B", ["CAN", "BIH", "QAT", "SUI"]],
  ["C", ["BRA", "MAR", "HAI", "SCO"]],
  ["D", ["USA", "PAR", "AUS", "TUR"]],
  ["E", ["GER", "CUW", "CIV", "ECU"]],
  ["F", ["NED", "JPN", "SWE", "TUN"]],
  ["G", ["BEL", "EGY", "IRN", "NZL"]],
  ["H", ["ESP", "CPV", "KSA", "URU"]],
  ["I", ["FRA", "SEN", "IRQ", "NOR"]],
  ["J", ["ARG", "ALG", "AUT", "JOR"]],
  ["K", ["POR", "COD", "UZB", "COL"]],
  ["L", ["ENG", "CRO", "GHA", "PAN"]],
];

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------
export function createTournament(youKey, subMap = {}) {
  const sub = (k) => subMap[k] !== undefined ? subMap[k] : k;
  const groups = GROUPS_2026.map(([name, teams]) => ({
    name,
    teams: teams.map(sub),
    rows: teams.map((k) => ({ key: sub(k), pld: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 })),
    results: [],
  }));

  return {
    youKey,
    groups,
    stage: "group",
    matchday: 0,
    ko: null,
    koRound: 0,
    youAlive: true,
    youOut: null,
    champion: null,
  };
}

const rowOf = (g, key) => g.rows.find((r) => r.key === key);
export const groupOfTeam = (t, key) => t.groups.find((g) => g.teams.includes(key));

// Head-to-head comparison between two teams using group results (FIFA criteria
// 4-6). Returns positive if y beats x in H2H, negative if x beats y, 0 if even.
function h2hCompare(xKey, yKey, results) {
  let xp = 0, yp = 0, xgd = 0, ygd = 0, xgf = 0, ygf = 0;
  for (const r of results) {
    let xs, ys;
    if (r.a === xKey && r.b === yKey) { xs = r.sa; ys = r.sb; }
    else if (r.a === yKey && r.b === xKey) { xs = r.sb; ys = r.sa; }
    else continue;
    xgf += xs; ygf += ys; xgd += xs - ys; ygd += ys - xs;
    if (xs > ys) xp += 3; else if (ys > xs) yp += 3; else { xp++; yp++; }
  }
  return yp - xp || ygd - xgd || ygf - xgf;
}

// Sort standings rows by FIFA tiebreaker order:
//   pts → GD → GF → H2H pts → H2H GD → H2H GF → wins → OVR (proxy for FIFA ranking)
// Pass group results to enable H2H (within-group only; cross-group calls omit it).
function rankRows(rows, results) {
  return [...rows].sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    if (y.gd !== x.gd) return y.gd - x.gd;
    if (y.gf !== x.gf) return y.gf - x.gf;
    if (results) {
      const h = h2hCompare(x.key, y.key, results);
      if (h !== 0) return h;
    }
    if (y.w !== x.w) return y.w - x.w;
    return ovr(y.key) - ovr(x.key);
  });
}
export const sortedGroup = (g) => rankRows(g.rows, g.results);

// Returns a Set of the 8 third-placed team keys currently in qualifying position.
// Used to decide whether to show the amber advancement bar on a 3rd-place row.
export function bestThirdsKeys(t) {
  const thirds = t.groups.map(g => sortedGroup(g)[2]).filter(Boolean);
  return new Set(rankRows(thirds).slice(0, 8).map(r => r.key));
}

function applyGroupResult(g, ai, bi, sa, sb, md) {
  const ra = rowOf(g, g.teams[ai]);
  const rb = rowOf(g, g.teams[bi]);
  ra.pld++;
  rb.pld++;
  ra.gf += sa;
  ra.ga += sb;
  rb.gf += sb;
  rb.ga += sa;
  if (sa > sb) {
    ra.w++;
    rb.l++;
    ra.pts += 3;
  } else if (sb > sa) {
    rb.w++;
    ra.l++;
    rb.pts += 3;
  } else {
    ra.d++;
    rb.d++;
    ra.pts++;
    rb.pts++;
  }
  ra.gd = ra.gf - ra.ga;
  rb.gd = rb.gf - rb.ga;
  g.results.push({ md, a: g.teams[ai], b: g.teams[bi], sa, sb });
}

// ---------------------------------------------------------------------------
// "Your" fixture this matchweek
// ---------------------------------------------------------------------------
export function playerFixture(t) {
  if (t.stage === "group") {
    const g = groupOfTeam(t, t.youKey);
    const idx = g.teams.indexOf(t.youKey);
    for (const [i, j] of RR[t.matchday]) {
      if (i === idx) return { kind: "group", group: g, a: g.teams[i], b: g.teams[j], youIsA: true };
      if (j === idx) return { kind: "group", group: g, a: g.teams[i], b: g.teams[j], youIsA: false };
    }
    return null;
  }
  if (t.stage === "ko") {
    const round = t.ko.rounds[t.koRound];
    const tie = round.ties.find((x) => x && !x.winner && (x.a === t.youKey || x.b === t.youKey));
    if (!tie) return null;
    return { kind: "ko", tie, a: tie.a, b: tie.b, youIsA: tie.a === t.youKey, round };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recording the human's match + simulating the rest of the matchweek
// ---------------------------------------------------------------------------
// youScore / oppScore are from the live match. pens (optional) is
// [youPens, oppPens] for a drawn knockout tie.
export function recordPlayerMatch(t, youScore, oppScore, pens) {
  const f = playerFixture(t);
  if (!f) return;
  if (f.kind === "group") {
    const g = f.group;
    const ai = g.teams.indexOf(f.a);
    const bi = g.teams.indexOf(f.b);
    const sa = f.youIsA ? youScore : oppScore;
    const sb = f.youIsA ? oppScore : youScore;
    applyGroupResult(g, ai, bi, sa, sb, t.matchday);
    simRestOfGroupMatchday(t, g, f.a, f.b);
  } else {
    const tie = f.tie;
    tie.sa = f.youIsA ? youScore : oppScore;
    tie.sb = f.youIsA ? oppScore : youScore;
    tie.played = true;
    if (tie.sa === tie.sb) {
      const yp = pens ? pens[0] : 0;
      const op = pens ? pens[1] : 1;
      tie.pens = f.youIsA ? [yp, op] : [op, yp];
      tie.winner = tie.pens[0] > tie.pens[1] ? tie.a : tie.b;
    } else {
      tie.winner = tie.sa > tie.sb ? tie.a : tie.b;
    }
    simRestOfKoRound(t, tie);
  }
}

function simRestOfGroupMatchday(t, playerGroup, playedA, playedB) {
  const md = t.matchday;
  for (const g of t.groups) {
    for (const [i, j] of RR[md]) {
      const a = g.teams[i];
      const b = g.teams[j];
      if (g === playerGroup && a === playedA && b === playedB) continue; // already applied
      if (g.results.some((r) => r.md === md && r.a === a && r.b === b)) continue;
      const r = simMatch(a, b, false);
      applyGroupResult(g, i, j, r.a, r.b, md);
    }
  }
}

function simRestOfKoRound(t, playerTie) {
  const round = t.ko.rounds[t.koRound];
  for (const tie of round.ties) {
    if (!tie || tie === playerTie || tie.winner) continue;
    const r = simMatch(tie.a, tie.b, true);
    tie.sa = r.a;
    tie.sb = r.b;
    tie.pens = r.pens;
    tie.winner = r.winner;
    tie.played = true;
  }
}

// Snapshot of the matchweek the human just played, for the results screen.
// Call AFTER recordPlayerMatch but BEFORE advanceMatchweek.
export function matchweekResults(t) {
  if (t.stage === "group") {
    const md = t.matchday;
    return {
      stage: "group",
      label: "MATCHDAY " + (md + 1) + " RESULTS",
      groups: t.groups.map((g) => ({
        name: g.name,
        yours: g === groupOfTeam(t, t.youKey),
        matches: g.results.filter((r) => r.md === md),
      })),
    };
  }
  const round = t.ko.rounds[t.koRound];
  return {
    stage: "ko",
    label: round.name + " RESULTS",
    ties: round.ties.filter(Boolean).map((x) => ({ ...x })),
  };
}

// ---------------------------------------------------------------------------
// Advancing to the next matchweek
// ---------------------------------------------------------------------------
export function advanceMatchweek(t) {
  if (t.stage === "group") {
    t.matchday++;
    if (t.matchday > 2) concludeGroupStage(t);
  } else if (t.stage === "ko") {
    resolveKoRound(t);
  }
  updateAlive(t);
}

function concludeGroupStage(t) {
  t.stage = "ko";
  const winners = [];
  const runners = [];
  const thirds = [];
  const groupOf = {};
  for (const g of t.groups) {
    const s = sortedGroup(g);
    g.standing = s;
    for (const r of s) groupOf[r.key] = g.name;
    winners.push(s[0]);
    runners.push(s[1]);
    thirds.push(s[2]);
  }
  const bestThirds = rankRows(thirds).slice(0, 8);
  // Seed 1..32: every winner outranks every runner-up outranks every qualifying
  // third; within a tier, by group-stage record.
  const seeds = [...rankRows(winners), ...rankRows(runners), ...rankRows(bestThirds)].map((r) => r.key);
  t.ko = buildBracket(seeds, groupOf);
  t.koRound = 0;
}

const makeTie = (a, b) => ({ a, b, sa: null, sb: null, pens: null, winner: null, played: false });

// Standard single-elimination seeding order: top seed and second seed can only
// meet in the final.
function bracketOrder(n) {
  let order = [1, 2];
  while (order.length < n) {
    const m = order.length * 2 + 1;
    const next = [];
    for (const s of order) {
      next.push(s);
      next.push(m - s);
    }
    order = next;
  }
  return order;
}

function buildBracket(seeds, groupOf) {
  const order = bracketOrder(32).map((s) => seeds[s - 1]);
  deClash(order, groupOf);
  const r32 = [];
  for (let i = 0; i < order.length; i += 2) r32.push(makeTie(order[i], order[i + 1]));
  return {
    rounds: [
      { name: "ROUND OF 32", short: "R32", ties: r32 },
      { name: "ROUND OF 16", short: "R16", ties: emptyTies(8) },
      { name: "QUARTER-FINALS", short: "QF", ties: emptyTies(4) },
      { name: "SEMI-FINALS", short: "SF", ties: emptyTies(2) },
      { name: "FINAL", short: "FIN", ties: emptyTies(1) },
    ],
    champion: null,
  };
}

const emptyTies = (n) => Array.from({ length: n }, () => null);

// Best-effort: avoid two same-group teams meeting in the very first round by
// swapping the lower half of a clashing tie with another tie's lower half.
function deClash(order, groupOf) {
  for (let i = 0; i < order.length; i += 2) {
    if (groupOf[order[i]] !== groupOf[order[i + 1]]) continue;
    for (let j = 0; j < order.length; j += 2) {
      if (j === i) continue;
      const a = order[i];
      const b = order[j + 1];
      const c = order[j];
      const d = order[i + 1];
      if (groupOf[a] !== groupOf[b] && groupOf[c] !== groupOf[d]) {
        [order[i + 1], order[j + 1]] = [order[j + 1], order[i + 1]];
        break;
      }
    }
  }
}

function resolveKoRound(t) {
  const cur = t.ko.rounds[t.koRound];
  const next = t.ko.rounds[t.koRound + 1];
  if (!next) {
    const f = cur.ties[0];
    t.ko.champion = f.winner;
    t.champion = f.winner;
    t.stage = "done";
    return;
  }
  for (let i = 0; i < next.ties.length; i++) {
    next.ties[i] = makeTie(cur.ties[2 * i].winner, cur.ties[2 * i + 1].winner);
  }
  t.koRound++;
}

function updateAlive(t) {
  if (t.stage === "group") {
    t.youAlive = true;
    return;
  }
  if (t.stage === "done") {
    t.youAlive = t.champion === t.youKey;
    return;
  }
  const round = t.ko.rounds[t.koRound];
  const alive = round.ties.some((x) => x && (x.a === t.youKey || x.b === t.youKey));
  if (!alive && t.youAlive) {
    // Just got knocked out — remember the round it happened in for the recap.
    const prev = t.ko.rounds[t.koRound - 1];
    t.youOut = prev ? prev.name : "GROUP STAGE";
  }
  t.youAlive = alive;
}

// Mark group-stage elimination (called once when the bracket is built and the
// human didn't make the 32).
export function checkGroupElimination(t) {
  if (t.stage !== "ko" || t.koRound !== 0) return;
  const inBracket = t.ko.rounds[0].ties.some((x) => x && (x.a === t.youKey || x.b === t.youKey));
  if (!inBracket) {
    t.youAlive = false;
    if (!t.youOut) t.youOut = "GROUP STAGE";
  }
}

// Auto-play every remaining match to a champion (used once the human is out).
export function simToEnd(t) {
  while (t.stage === "group") {
    for (const g of t.groups) {
      for (const [i, j] of RR[t.matchday]) {
        const a = g.teams[i];
        const b = g.teams[j];
        if (g.results.some((r) => r.md === t.matchday && r.a === a && r.b === b)) continue;
        const r = simMatch(a, b, false);
        applyGroupResult(g, i, j, r.a, r.b, t.matchday);
      }
    }
    t.matchday++;
    if (t.matchday > 2) concludeGroupStage(t);
  }
  while (t.stage === "ko") {
    const round = t.ko.rounds[t.koRound];
    for (const tie of round.ties) {
      if (!tie || tie.winner) continue;
      const r = simMatch(tie.a, tie.b, true);
      tie.sa = r.a;
      tie.sb = r.b;
      tie.pens = r.pens;
      tie.winner = r.winner;
      tie.played = true;
    }
    resolveKoRound(t);
  }
}

// Human-readable stage label for the hub header.
export function stageLabel(t) {
  if (t.stage === "group") return "GROUP STAGE - MATCHDAY " + (t.matchday + 1);
  if (t.stage === "done") return "TOURNAMENT COMPLETE";
  return t.ko.rounds[t.koRound].name;
}
