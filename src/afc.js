// ---------------------------------------------------------------------------
// AFC (Asian) 2026 World Cup qualification engine — pure logic, no rendering.
//
// Real 2026 AFC format (8 direct World Cup berths + 1 inter-confederation
// play-off berth). All facts verified against the AFC qualification record:
//
//   Round 1 — the 20 lowest-ranked AFC entrants, 10 two-legged home-and-away
//             knockout ties. The 10 winners join Round 2.
//   Round 2 — 36 teams (26 direct entrants + 10 R1 winners) in 9 groups of 4,
//             double round-robin (home & away). Top 2 of each group (18) advance.
//   Round 3 — 18 teams in 3 groups of 6, double round-robin. Top 2 of each group
//             (6) QUALIFY directly for the World Cup; 3rd & 4th (6) drop to R4.
//   Round 4 — 6 teams in 2 groups of 3, single round-robin (centralised). Each
//             group winner (2) QUALIFIES directly; the 2 runners-up drop to R5.
//   Round 5 — the 2 runners-up meet over two legs. The winner takes the AFC's
//             inter-confederation play-off berth.
//   ICP path — the AFC team is the SEED in its play-off path: it sits out the
//             play-in (Bolivia v Suriname) and plays the winner in a one-off
//             final. Win it and you take the 9th Asian World Cup berth.
//
// The human plays exactly ONE match per matchweek (their own fixture); every
// other game that week is simulated from team OVR using tournament.js maths.
// ---------------------------------------------------------------------------
import { NATIONS } from "./nations.js";
import { simMatch, penShootout } from "./tournament.js";
import { AFC_DIRECT, AFC_ROUND1, AFC_ICP } from "./afcData.js";

const ovr = (k) => NATIONS[k].ovr;
const rank = (k) => NATIONS[k].fifaRank || 999;
const abbr = (k) => NATIONS[k].abbr;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Round-robin scheduling (circle method). Returns an array of matchdays; each
// matchday is an array of [homeIdx, awayIdx] pairs into the team list. `double`
// appends the reverse fixtures (home/away swapped). Odd counts get a bye (a team
// that simply doesn't appear in a matchday).
// ---------------------------------------------------------------------------
function roundRobin(n, double) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(i);
  if (arr.length % 2 === 1) arr.push(-1);
  const m = arr.length;
  const rounds = [];
  // Even home/away split: give each match to whichever side has hosted least so
  // far (tie-break: whoever has travelled more). The plain circle method handed
  // the last seed every single game away — which is why a road campaign always
  // felt like it was played away from home.
  const home = new Array(n).fill(0);
  const away = new Array(n).fill(0);
  for (let r = 0; r < m - 1; r++) {
    const day = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i];
      const b = arr[m - 1 - i];
      if (a === -1 || b === -1) continue;
      let h;
      if (home[a] !== home[b]) h = home[a] < home[b] ? a : b;
      else if (away[a] !== away[b]) h = away[a] > away[b] ? a : b;
      else h = r % 2 === 0 ? a : b;
      const w = h === a ? b : a;
      home[h]++; away[w]++;
      day.push([h, w]);
    }
    rounds.push(day);
    arr.splice(1, 0, arr.pop()); // rotate, fixing the first slot
  }
  return double ? rounds.concat(rounds.map((d) => d.map(([a, b]) => [b, a]))) : rounds;
}

// Seeded pot draw: sort by FIFA rank, split into `groups` pots, one team from
// each pot per group (random within a pot). Returns balanced groups of keys.
function potDraw(teamKeys, groups) {
  const sorted = [...teamKeys].sort((a, b) => rank(a) - rank(b));
  const pots = Math.ceil(sorted.length / groups);
  const buckets = Array.from({ length: groups }, () => []);
  for (let p = 0; p < pots; p++) {
    const pot = shuffle(sorted.slice(p * groups, p * groups + groups));
    for (let g = 0; g < pot.length; g++) buckets[g].push(pot[g]);
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
function makeGroup(name, teamKeys, double) {
  return {
    name,
    teams: teamKeys,
    rows: teamKeys.map((k) => ({ key: k, pld: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 })),
    schedule: roundRobin(teamKeys.length, double),
    results: [],
  };
}

const rowOf = (g, key) => g.rows.find((r) => r.key === key);

function applyGroupResult(g, aKey, bKey, sa, sb, md) {
  const ra = rowOf(g, aKey), rb = rowOf(g, bKey);
  ra.pld++; rb.pld++;
  ra.gf += sa; ra.ga += sb; rb.gf += sb; rb.ga += sa;
  if (sa > sb) { ra.w++; rb.l++; ra.pts += 3; }
  else if (sb > sa) { rb.w++; ra.l++; rb.pts += 3; }
  else { ra.d++; rb.d++; ra.pts++; rb.pts++; }
  ra.gd = ra.gf - ra.ga; rb.gd = rb.gf - rb.ga;
  g.results.push({ md, a: aKey, b: bKey, sa, sb });
}

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

export function sortedGroup(g) {
  return [...g.rows].sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    if (y.gd !== x.gd) return y.gd - x.gd;
    if (y.gf !== x.gf) return y.gf - x.gf;
    const h = h2hCompare(x.key, y.key, g.results);
    if (h !== 0) return h;
    if (y.w !== x.w) return y.w - x.w;
    return rank(x.key) - rank(y.key);
  });
}

// ---------------------------------------------------------------------------
// Two-legged knockout ties (Round 1 + Round 5)
// ---------------------------------------------------------------------------
function makeTie(aKey, bKey) {
  return { a: aKey, b: bKey, legs: [null, null], agg: [0, 0], pens: null, winner: null, played: false };
}

// Record one leg's score (oriented to the tie's a/b), no resolution.
function setTieLeg(tie, leg, saAB, sbAB) {
  tie.legs[leg] = { sa: saAB, sb: sbAB };
  tie.agg[0] += saAB; tie.agg[1] += sbAB;
}

// Decide the winner after both legs. `pens` (optional, [aPens,bPens]) settles a
// level aggregate; if omitted, a shootout is simulated.
function resolveTie(tie, pens) {
  if (tie.agg[0] === tie.agg[1]) {
    tie.pens = pens || penShootout(tie.a, tie.b);
    tie.winner = tie.pens[0] > tie.pens[1] ? tie.a : tie.b;
  } else {
    tie.winner = tie.agg[0] > tie.agg[1] ? tie.a : tie.b;
  }
  tie.played = true;
}

// Single match (ICP). Always decisive.
function makeMatch(aKey, bKey, label) {
  return { a: aKey, b: bKey, sa: null, sb: null, pens: null, winner: null, played: false, label };
}

function applyMatch(m, sa, sb, pens) {
  m.sa = sa; m.sb = sb;
  if (sa === sb) {
    m.pens = pens || penShootout(m.a, m.b);
    m.winner = m.pens[0] > m.pens[1] ? m.a : m.b;
  } else {
    m.winner = sa > sb ? m.a : m.b;
  }
  m.played = true;
}

// ---------------------------------------------------------------------------
// Creation — Round 1 + Round 2. Round 1 is pre-simulated unless the human is in
// it. Later rounds are built as each round concludes.
// ---------------------------------------------------------------------------
export function createAfcQualification(youKey) {
  const q = {
    youKey,
    confed: "AFC",
    stage: null,
    matchday: 0,
    r1: null, r2: null, r3: null, r4: null, r5: null, icp: null,
    qualifiedDirect: [],
    icpReps: [],     // the team(s) sent to the inter-confederation play-off
    icpWinnerKey: null,
    youStatus: "alive",
    youOut: null,
    _prevStageLabel: "QUALIFYING",
  };

  // Round 1 draw: two pots (10 higher, 10 lower) by FIFA rank, paired across.
  const sorted = [...AFC_ROUND1].sort((a, b) => rank(a) - rank(b));
  const half = Math.floor(sorted.length / 2);
  const pot1 = shuffle(sorted.slice(0, half));
  const pot2 = shuffle(sorted.slice(half, half * 2));
  const ties = [];
  for (let i = 0; i < pot1.length; i++) ties.push(makeTie(pot1[i], pot2[i]));
  const byes = sorted.slice(half * 2); // any leftover (none for an even 20)
  q.r1 = { ties, byes, matchdays: 2 };

  if (AFC_ROUND1.includes(youKey)) {
    q.stage = "r1";
  } else {
    simWholeR1(q);
    buildRound2(q);
    q.stage = "r2";
  }
  return q;
}

const r1Winners = (q) => [...q.r1.byes, ...q.r1.ties.map((t) => t.winner)];

function simWholeR1(q) {
  for (const tie of q.r1.ties) {
    if (tie.winner) continue;
    if (!tie.legs[0]) { const r = simMatch(tie.a, tie.b, false); setTieLeg(tie, 0, r.a, r.b); }
    if (!tie.legs[1]) { const r = simMatch(tie.b, tie.a, false); setTieLeg(tie, 1, r.b, r.a); }
    resolveTie(tie);
  }
}

function buildRound2(q) {
  const buckets = potDraw([...AFC_DIRECT, ...r1Winners(q)], 9);
  q.r2 = { groups: buckets.map((tk, i) => makeGroup(String.fromCharCode(65 + i), tk, true)) };
}

function buildRound3(q) {
  const advancers = [];
  for (const g of q.r2.groups) { const s = sortedGroup(g); advancers.push(s[0].key, s[1].key); }
  const buckets = potDraw(advancers, 3);
  q.r3 = { groups: buckets.map((tk, i) => makeGroup(String.fromCharCode(65 + i), tk, true)) };
}

function buildRound4(q) {
  const drops = [];
  for (const g of q.r3.groups) {
    const s = sortedGroup(g);
    q.qualifiedDirect.push(s[0].key, s[1].key);
    drops.push(s[2].key, s[3].key);
  }
  const buckets = potDraw(drops, 2);
  q.r4 = { groups: buckets.map((tk, i) => makeGroup(String.fromCharCode(65 + i), tk, false)) };
}

function buildRound5(q) {
  const runners = [];
  for (const g of q.r4.groups) { const s = sortedGroup(g); q.qualifiedDirect.push(s[0].key); runners.push(s[1].key); }
  q.r5 = { tie: makeTie(runners[0], runners[1]), matchdays: 2 };
}

// Inter-confederation play-off path. AFC team is the seed: it sits out the
// play-in and plays the winner in the path final.
function buildIcp(q, afcKey) {
  q.icp = {
    afcKey,
    seeded: AFC_ICP.seeded,
    seed: AFC_ICP.seeded ? afcKey : AFC_ICP.opponents[1],
    semi: AFC_ICP.seeded
      ? makeMatch(AFC_ICP.opponents[0], AFC_ICP.opponents[1], "PLAY-IN")
      : makeMatch(afcKey, AFC_ICP.opponents[0], "PLAY-IN"),
    final: null,
    stageIdx: 0, // 0 = play-in stage, 1 = final stage
  };
}

// ---------------------------------------------------------------------------
// The human's fixture this matchweek (null = bye / not their turn this week)
// ---------------------------------------------------------------------------
export function afcPlayerFixture(q) {
  const you = q.youKey;
  if (q.stage === "r1" || q.stage === "r5") {
    const tie = q.stage === "r1" ? q.r1.ties.find((t) => t.a === you || t.b === you) : q.r5.tie;
    if (!tie || tie.winner || (tie.a !== you && tie.b !== you)) return null;
    const leg = q.matchday;
    const homeKey = leg === 0 ? tie.a : tie.b;
    const awayKey = homeKey === tie.a ? tie.b : tie.a;
    return {
      kind: "tie", round: q.stage, tie, leg, a: homeKey, b: awayKey,
      youIsHome: homeKey === you, youKey: you, oppKey: homeKey === you ? awayKey : homeKey,
      label: (q.stage === "r1" ? "ROUND 1" : "ROUND 5") + " - LEG " + (leg + 1),
    };
  }
  if (q.stage === "r2" || q.stage === "r3" || q.stage === "r4") {
    const g = q[q.stage].groups.find((gr) => gr.teams.includes(you));
    if (!g) return null;
    const day = g.schedule[q.matchday];
    if (!day) return null;
    for (const [i, j] of day) {
      if (g.teams[i] === you || g.teams[j] === you) {
        return {
          kind: "group", round: q.stage, group: g, a: g.teams[i], b: g.teams[j],
          youIsA: g.teams[i] === you, youKey: you, oppKey: g.teams[i] === you ? g.teams[j] : g.teams[i],
          label: roundShort(q.stage) + " - MD " + (q.matchday + 1),
        };
      }
    }
    return null; // bye (R4 groups of 3)
  }
  if (q.stage === "icp") {
    const i = q.icp;
    const m = i.stageIdx === 0 ? i.semi : i.final;
    if (!m || m.winner) return null;
    if (m.a !== you && m.b !== you) return null;
    return {
      kind: "match", round: "icp", match: m, a: m.a, b: m.b,
      youIsA: m.a === you, youKey: you, oppKey: m.a === you ? m.b : m.a,
      label: "INTERCONTINENTAL PLAY-OFF " + (i.stageIdx === 0 ? "SEMI" : "FINAL"),
    };
  }
  return null;
}

const roundShort = (s) => ({ r2: "ROUND 2", r3: "ROUND 3", r4: "ROUND 4" }[s] || s);

export function afcStageLabel(q) {
  if (q.stage === "r1") return "ROUND 1 - LEG " + (q.matchday + 1);
  if (q.stage === "r2") return "ROUND 2 - MATCHDAY " + (q.matchday + 1);
  if (q.stage === "r3") return "ROUND 3 - MATCHDAY " + (q.matchday + 1);
  if (q.stage === "r4") return "ROUND 4 - MATCHDAY " + (q.matchday + 1);
  if (q.stage === "r5") return "ROUND 5 - LEG " + (q.matchday + 1);
  if (q.stage === "icp") return "INTER-CONFEDERATION PLAY-OFF";
  return "QUALIFICATION COMPLETE";
}

// ---------------------------------------------------------------------------
// Player outcome for the FULL TIME screen. Centralises leg/aggregate/penalty
// logic so wc.js stays thin. Returns { label, pens, decisive } where pens is
// oriented [youPens, oppPens] (cache + feed straight back into record).
// ---------------------------------------------------------------------------
export function previewPlayerOutcome(q, youScore, oppScore) {
  const f = afcPlayerFixture(q);
  if (!f) return { label: "", pens: null, decisive: true };
  const you = q.youKey;
  if (f.kind === "group") {
    if (youScore > oppScore) return { label: NATIONS[you].name + " WIN", pens: null };
    if (oppScore > youScore) return { label: NATIONS[f.oppKey].name + " WIN", pens: null };
    return { label: "DRAW", pens: null };
  }
  if (f.kind === "match") {
    if (youScore > oppScore) return { label: NATIONS[you].name + " WIN", pens: null };
    if (oppScore > youScore) return { label: NATIONS[f.oppKey].name + " WIN", pens: null };
    const p = penShootout(you, f.oppKey); // [youP, oppP]
    const win = p[0] > p[1] ? you : f.oppKey;
    return { label: NATIONS[win].name + " WIN " + Math.max(p[0], p[1]) + "-" + Math.min(p[0], p[1]) + " PENS", pens: p };
  }
  // tie (two legs)
  const tie = f.tie;
  const priorYou = tie.a === you ? tie.agg[0] : tie.agg[1];
  const priorOpp = tie.a === you ? tie.agg[1] : tie.agg[0];
  const aggYou = priorYou + youScore;
  const aggOpp = priorOpp + oppScore;
  if (f.leg === 0) {
    return { label: "LEG 1  -  AGGREGATE " + aggYou + "-" + aggOpp, pens: null, partial: true };
  }
  if (aggYou === aggOpp) {
    const p = penShootout(you, f.oppKey);
    const win = p[0] > p[1] ? you : f.oppKey;
    return { label: NATIONS[win].name + " WIN " + Math.max(p[0], p[1]) + "-" + Math.min(p[0], p[1]) + " PENS  (AGG " + aggYou + "-" + aggOpp + ")", pens: p };
  }
  const win = aggYou > aggOpp ? you : f.oppKey;
  return { label: NATIONS[win].name + " WIN  -  AGG " + Math.max(aggYou, aggOpp) + "-" + Math.min(aggYou, aggOpp), pens: null };
}

// ---------------------------------------------------------------------------
// Recording the human's result + simulating the rest of the matchweek.
// pens (optional) = [youPens, oppPens] for a level knockout (tie agg / ICP).
// ---------------------------------------------------------------------------
export function recordAfcPlayerMatch(q, youScore, oppScore, pens) {
  const f = afcPlayerFixture(q);
  if (!f) return;
  if (f.kind === "group") {
    const g = f.group;
    const sa = f.youIsA ? youScore : oppScore;
    const sb = f.youIsA ? oppScore : youScore;
    applyGroupResult(g, f.a, f.b, sa, sb, q.matchday);
    simRestOfGroupMatchday(q, g, f.a, f.b);
  } else if (f.kind === "tie") {
    const tie = f.tie;
    // orient this leg's scores to tie.a / tie.b
    const youIsA = tie.a === f.youKey;
    const legA = youIsA ? youScore : oppScore;
    const legB = youIsA ? oppScore : youScore;
    setTieLeg(tie, f.leg, legA, legB);
    if (f.leg === 1) {
      const penAB = pens ? (youIsA ? [pens[0], pens[1]] : [pens[1], pens[0]]) : null;
      resolveTie(tie, penAB);
    }
    simRestOfTieLeg(q, tie);
  } else if (f.kind === "match") {
    const m = f.match;
    const sa = f.youIsA ? youScore : oppScore;
    const sb = f.youIsA ? oppScore : youScore;
    const penAB = pens ? (f.youIsA ? [pens[0], pens[1]] : [pens[1], pens[0]]) : null;
    applyMatch(m, sa, sb, penAB);
  }
}

function simRestOfGroupMatchday(q, playerGroup, playedA, playedB) {
  for (const g of q[q.stage].groups) {
    const day = g.schedule[q.matchday];
    if (!day) continue;
    for (const [i, j] of day) {
      const a = g.teams[i], b = g.teams[j];
      if (g === playerGroup && a === playedA && b === playedB) continue;
      if (g.results.some((rr) => rr.md === q.matchday && rr.a === a && rr.b === b)) continue;
      const sim = simMatch(a, b, false);
      applyGroupResult(g, a, b, sim.a, sim.b, q.matchday);
    }
  }
}

function simRestOfTieLeg(q, playerTie) {
  if (q.stage !== "r1") return; // R5 is a single tie
  for (const tie of q.r1.ties) {
    if (tie === playerTie || tie.legs[q.matchday]) continue;
    const homeKey = q.matchday === 0 ? tie.a : tie.b;
    const awayKey = homeKey === tie.a ? tie.b : tie.a;
    const sim = simMatch(homeKey, awayKey, false);
    setTieLeg(tie, q.matchday, homeKey === tie.a ? sim.a : sim.b, homeKey === tie.a ? sim.b : sim.a);
    if (q.matchday === 1) resolveTie(tie);
  }
}

// Snapshot for the results screen (call after record, before advance).
export function afcMatchweekResults(q) {
  const stage = q.stage;
  if (stage === "r2" || stage === "r3" || stage === "r4") {
    return {
      kind: "groups", stage, label: afcStageLabel(q),
      groups: q[stage].groups.map((g) => ({
        name: g.name,
        yours: g.teams.includes(q.youKey),
        matches: g.results.filter((rr) => rr.md === q.matchday),
      })),
    };
  }
  if (stage === "r1" || stage === "r5") {
    const ties = stage === "r1" ? q.r1.ties : [q.r5.tie];
    return {
      kind: "ties", stage, label: afcStageLabel(q),
      ties: ties.map((t) => ({ a: t.a, b: t.b, leg: t.legs[q.matchday], agg: t.agg.slice(), winner: t.winner, pens: t.pens })),
    };
  }
  if (stage === "icp") return { kind: "icp", stage: "icp", label: "INTER-CONFEDERATION PLAY-OFF", icp: snapshotIcp(q) };
  return { kind: "done", stage, label: afcStageLabel(q) };
}

function snapshotIcp(q) {
  const i = q.icp;
  return { seeded: i.seeded, afcKey: i.afcKey, seed: i.seed, semi: i.semi && { ...i.semi }, final: i.final && { ...i.final } };
}

// ---------------------------------------------------------------------------
// Advancing the matchweek / concluding rounds
// ---------------------------------------------------------------------------
export function advanceAfcMatchweek(q) {
  q._prevStageLabel = afcStageLabel(q).replace(/ - .*/, "");
  const stage = q.stage;
  if (stage === "r1") { q.matchday++; if (q.matchday >= 2) { concludeR1(q); } }
  else if (stage === "r2") { q.matchday++; if (q.matchday >= q.r2.groups[0].schedule.length) concludeR2(q); }
  else if (stage === "r3") { q.matchday++; if (q.matchday >= q.r3.groups[0].schedule.length) concludeR3(q); }
  else if (stage === "r4") { q.matchday++; if (q.matchday >= q.r4.groups[0].schedule.length) concludeR4(q); }
  else if (stage === "r5") { q.matchday++; if (q.matchday >= 2) concludeR5(q); }
  else if (stage === "icp") advanceIcp(q);
  updateAfcAlive(q);
}

function concludeR1(q) { buildRound2(q); q.stage = "r2"; q.matchday = 0; }
function concludeR2(q) { buildRound3(q); q.stage = "r3"; q.matchday = 0; }
function concludeR3(q) { buildRound4(q); q.stage = "r4"; q.matchday = 0; }
function concludeR4(q) { buildRound5(q); q.stage = "r5"; q.matchday = 0; }
// Qualification ends here: the R5 winner is AFC's inter-confederation play-off
// representative (resolved centrally). No internal ICP.
function concludeR5(q) { q.icpReps = [q.r5.tie.winner]; q.stage = "done"; }

function advanceIcp(q) {
  const i = q.icp;
  if (i.stageIdx === 0) {
    if (!i.semi.winner) { const r = simMatch(i.semi.a, i.semi.b, true); applyMatch(i.semi, r.a, r.b); }
    i.final = i.seeded ? makeMatch(i.afcKey, i.semi.winner, "FINAL") : makeMatch(i.semi.winner, i.seed, "FINAL");
    i.stageIdx = 1;
  } else {
    if (!i.final.winner) { const r = simMatch(i.final.a, i.final.b, true); applyMatch(i.final, r.a, r.b); }
    q.icpWinnerKey = i.final.winner;
    q.stage = "done";
  }
}

function updateAfcAlive(q) {
  const you = q.youKey;
  if (q.stage === "done") { finalizeYouStatus(q); return; }
  if (q.qualifiedDirect.includes(you)) { q.youStatus = "qualified"; return; }
  let present = false;
  const stage = q.stage;
  if (stage === "r2" || stage === "r3" || stage === "r4") present = q[stage].groups.some((g) => g.teams.includes(you));
  else if (stage === "r1") present = q.r1.byes.includes(you) || q.r1.ties.some((t) => (t.a === you || t.b === you) && (!t.winner || t.winner === you));
  else if (stage === "r5") present = q.r5.tie.a === you || q.r5.tie.b === you;
  else if (stage === "icp") {
    present = q.icp.afcKey === you;
    // unseeded AFC team knocked out in the play-in
    if (present && !q.icp.seeded && q.icp.semi.winner && q.icp.semi.winner !== you) present = false;
  }
  if (!present && q.youStatus === "alive") { q.youStatus = "eliminated"; q.youOut = q._prevStageLabel || "QUALIFYING"; }
}

function finalizeYouStatus(q) {
  const you = q.youKey;
  if (q.qualifiedDirect.includes(you)) q.youStatus = "qualified";
  else if (q.icpReps.includes(you)) q.youStatus = "icp"; // off to the central play-off
  else if (q.youStatus !== "eliminated") { q.youStatus = "eliminated"; q.youOut = q.youOut || "PLAY-OFF"; }
}

// ---------------------------------------------------------------------------
// Resolve everything not involving the human (run once the human is qualified
// or eliminated) so all 9 Asian berths are decided for the World Cup.
// ---------------------------------------------------------------------------
export function simAfcRemaining(q) {
  let guard = 0;
  while (q.stage !== "done" && guard++ < 100) simWholeCurrentRound(q);
  finalizeYouStatus(q);
}

function simWholeCurrentRound(q) {
  const stage = q.stage;
  if (stage === "r1") { simWholeR1(q); concludeR1(q); }
  else if (stage === "r2" || stage === "r3" || stage === "r4") {
    for (const g of q[stage].groups) {
      for (let md = 0; md < g.schedule.length; md++) {
        for (const [i, j] of g.schedule[md]) {
          const a = g.teams[i], b = g.teams[j];
          if (g.results.some((rr) => rr.md === md && rr.a === a && rr.b === b)) continue;
          const sim = simMatch(a, b, false);
          applyGroupResult(g, a, b, sim.a, sim.b, md);
        }
      }
    }
    if (stage === "r2") concludeR2(q); else if (stage === "r3") concludeR3(q); else concludeR4(q);
  } else if (stage === "r5") {
    const tie = q.r5.tie;
    if (!tie.legs[0]) { const r = simMatch(tie.a, tie.b, false); setTieLeg(tie, 0, r.a, r.b); }
    if (!tie.legs[1]) { const r = simMatch(tie.b, tie.a, false); setTieLeg(tie, 1, r.b, r.a); }
    if (!tie.winner) resolveTie(tie);
    concludeR5(q);
  } else if (stage === "icp") {
    const i = q.icp;
    if (!i.semi.winner) { const r = simMatch(i.semi.a, i.semi.b, true); applyMatch(i.semi, r.a, r.b); }
    if (!i.final) i.final = i.seeded ? makeMatch(i.afcKey, i.semi.winner, "FINAL") : makeMatch(i.semi.winner, i.seed, "FINAL");
    if (!i.final.winner) { const r = simMatch(i.final.a, i.final.b, true); applyMatch(i.final, r.a, r.b); }
    q.icpWinnerKey = i.final.winner;
    q.stage = "done";
  }
}

// ---------------------------------------------------------------------------
// Qualifiers + the World Cup substitution map
// ---------------------------------------------------------------------------
export function afcQualifiers(q) {
  return { direct: q.qualifiedDirect.slice(), reps: q.icpReps.slice() };
}

// The World Cup field's 9 Asian-region slots (from GROUPS_2026).
export const AFC_WC_SLOTS = ["JPN", "KOR", "AUS", "IRN", "KSA", "QAT", "IRQ", "UZB", "JOR"];

// Map the 9 World Cup Asian slots → the teams that qualified this playthrough,
// paired by OVR (strong-for-strong) so the modified draw stays balanced.
export function buildAfcSubMap(q) {
  const qs = afcQualifiers(q);
  const fresh = [...qs.direct];
  if (qs.ninth) fresh.push(qs.ninth);
  while (fresh.length < AFC_WC_SLOTS.length) fresh.push(AFC_WC_SLOTS[fresh.length]);
  const slots = [...AFC_WC_SLOTS].sort((a, b) => ovr(b) - ovr(a));
  const news = fresh.slice(0, AFC_WC_SLOTS.length).sort((a, b) => ovr(b) - ovr(a));
  const sub = {};
  for (let i = 0; i < slots.length; i++) sub[slots[i]] = news[i];
  return sub;
}

// ---------------------------------------------------------------------------
// Render descriptor + uniform engine interface (so the road UI is confederation
// agnostic — CAF and future confederations implement the same shape).
// ---------------------------------------------------------------------------
const AFC_FOOTER = {
  r2: "TOP 2 ADVANCE TO ROUND 3",
  r3: "TOP 2 QUALIFY FOR THE WORLD CUP  -  3RD/4TH GO TO ROUND 4",
  r4: "GROUP WINNER QUALIFIES  -  RUNNER-UP GOES TO ROUND 5",
};
const AFC_OVERVIEW = {
  r2: "ROUND 2 - 9 GROUPS OF 4",
  r3: "ROUND 3 - 3 GROUPS OF 6",
  r4: "ROUND 4 - 2 GROUPS OF 3",
};
function afcBandFor(stage) {
  if (stage === "r2") return (k, i) => (i < 2 ? { status: "good", badge: "ADV" } : { status: "out", badge: "OUT" });
  if (stage === "r3") return (k, i) => (i < 2 ? { status: "good", badge: "WC" } : i < 4 ? { status: "next", badge: "R4" } : { status: "out", badge: "OUT" });
  return (k, i) => (i < 1 ? { status: "good", badge: "WC" } : i < 2 ? { status: "next", badge: "R5" } : { status: "out", badge: "OUT" });
}

export function afcRoadView(q) {
  const s = q.stage;
  if (s === "r2" || s === "r3" || s === "r4") {
    const groups = q[s].groups;
    return {
      kind: "groups", roundLabel: roundShort(s), groups,
      myGroup: groups.find((g) => g.teams.includes(q.youKey)) || null,
      bandFor: afcBandFor(s), footer: AFC_FOOTER[s], overviewTitle: AFC_OVERVIEW[s],
    };
  }
  if (s === "r1" || s === "r5") {
    const ties = s === "r1" ? q.r1.ties : [q.r5.tie];
    return {
      kind: "ties", roundLabel: s === "r1" ? "ROUND 1" : "ROUND 5", ties,
      myTie: ties.find((t) => t.a === q.youKey || t.b === q.youKey) || null, twoLeg: true,
      tiesTitle: (s === "r1" ? "ROUND 1" : "ROUND 5") + " - YOUR TIE",
      overviewTitle: s === "r1" ? "ROUND 1 - ALL TIES" : "ROUND 5 - THE PLAY-OFF",
      tiesFooter: "TWO LEGS - WINNER ON AGGREGATE ADVANCES",
    };
  }
  if (s === "icp") return { kind: "icp", roundLabel: "PLAY-OFF", icp: q.icp };
  return { kind: "done" };
}

export const ENGINE = {
  confed: "AFC",
  region: "ASIA",
  pickHeader: "AFC - 46 TEAMS - PLAY 2026 QUALIFYING, THEN INTO THE WORLD CUP",
  create: createAfcQualification,
  playerFixture: afcPlayerFixture,
  preview: previewPlayerOutcome,
  record: recordAfcPlayerMatch,
  results: afcMatchweekResults,
  advance: advanceAfcMatchweek,
  stageLabel: afcStageLabel,
  simRemaining: simAfcRemaining,
  qualifiers: afcQualifiers,
  buildSubMap: buildAfcSubMap,
  sortedGroup,
  roadView: afcRoadView,
  roadRankTab: () => null, // AFC has no cross-group ranking tab
  pickKeys: () => [...AFC_DIRECT, ...AFC_ROUND1],
};
