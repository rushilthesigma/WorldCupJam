// ---------------------------------------------------------------------------
// CONCACAF 2026 World Cup qualification engine — pure logic, no rendering.
//
// Real 2026 format (3 hosts auto-qualify and skip; 3 direct + 2 ICP contested):
//
//   Round 1 — the 4 lowest-ranked entrants, two two-legged ties → 2 winners.
//   Round 2 — 30 teams (28 byes + 2 R1 winners) in 6 groups of 5, SINGLE
//             round-robin. Top 2 of each group (12) advance.
//   Round 3 — 12 teams in 3 groups of 4, double round-robin. The 3 group winners
//             QUALIFY directly; the 2 best runners-up reach the ICP.
//   ICP     — CONCACAF's two best runners-up go into SEPARATE play-off paths
//             (both unseeded). We play whichever path the human's team is in.
//
// Same engine interface as the other confederations.
// ---------------------------------------------------------------------------
import { NATIONS } from "./nations.js";
import { simMatch, penShootout } from "./tournament.js";
import { CONCACAF_DIRECT_R2, CONCACAF_R1, CONCACAF_ICP } from "./concacafData.js";

const ovr = (k) => NATIONS[k].ovr;
const rank = (k) => NATIONS[k].fifaRank || 999;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roundRobin(n, double) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(i);
  if (arr.length % 2 === 1) arr.push(-1);
  const m = arr.length;
  const rounds = [];
  for (let r = 0; r < m - 1; r++) {
    const day = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i], b = arr[m - 1 - i];
      if (a === -1 || b === -1) continue;
      day.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(day);
    arr.splice(1, 0, arr.pop());
  }
  return double ? rounds.concat(rounds.map((d) => d.map(([a, b]) => [b, a]))) : rounds;
}

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

function makeGroup(name, teamKeys, double) {
  return {
    name, teams: teamKeys,
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

function rankRows(rows) {
  return [...rows].sort((x, y) =>
    y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || y.w - x.w || rank(x.key) - rank(y.key)
  );
}

export function bestRunnersUpKeys(q) {
  const rus = q.r3.groups.map((g) => sortedGroup(g)[1]).filter(Boolean);
  return new Set(rankRows(rus).slice(0, 2).map((r) => r.key));
}

// Two-legged tie (Round 1)
function makeTie(aKey, bKey) {
  return { a: aKey, b: bKey, legs: [null, null], agg: [0, 0], pens: null, winner: null, played: false };
}
function setTieLeg(tie, leg, saAB, sbAB) {
  tie.legs[leg] = { sa: saAB, sb: sbAB };
  tie.agg[0] += saAB; tie.agg[1] += sbAB;
}
function resolveTie(tie, pens) {
  if (tie.agg[0] === tie.agg[1]) {
    tie.pens = pens || penShootout(tie.a, tie.b);
    tie.winner = tie.pens[0] > tie.pens[1] ? tie.a : tie.b;
  } else {
    tie.winner = tie.agg[0] > tie.agg[1] ? tie.a : tie.b;
  }
  tie.played = true;
}

// Single match (ICP)
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
export function createConcacafQualification(youKey) {
  const q = {
    youKey, confed: "CONCACAF",
    stage: null, matchday: 0,
    r1: null, r2: null, r3: null, icp: null,
    qualifiedDirect: [],
    icpReps: [],
    icpTeam: null, icpSlot: null,
    icpWinnerKey: null,
    youStatus: "alive",
    youOut: null,
    _prevStageLabel: "QUALIFYING",
  };
  // Round 1 draw: sort the 4 lowest by rank, pair 1v4 and 2v3.
  const r1 = [...CONCACAF_R1].sort((a, b) => rank(a) - rank(b));
  const ties = [makeTie(r1[0], r1[3]), makeTie(r1[1], r1[2])];
  q.r1 = { ties, matchdays: 2 };
  if (CONCACAF_R1.includes(youKey)) {
    q.stage = "r1";
  } else {
    simWholeR1(q);
    buildRound2(q);
    q.stage = "r2";
  }
  return q;
}

const r1Winners = (q) => q.r1.ties.map((t) => t.winner);

function simWholeR1(q) {
  for (const tie of q.r1.ties) {
    if (tie.winner) continue;
    if (!tie.legs[0]) { const r = simMatch(tie.a, tie.b, false); setTieLeg(tie, 0, r.a, r.b); }
    if (!tie.legs[1]) { const r = simMatch(tie.b, tie.a, false); setTieLeg(tie, 1, r.b, r.a); }
    resolveTie(tie);
  }
}

function buildRound2(q) {
  const buckets = potDraw([...CONCACAF_DIRECT_R2, ...r1Winners(q)], 6);
  q.r2 = { groups: buckets.map((tk, i) => makeGroup(String.fromCharCode(65 + i), tk, false)) };
}

function buildRound3(q) {
  const advancers = [];
  for (const g of q.r2.groups) { const s = sortedGroup(g); advancers.push(s[0].key, s[1].key); }
  const buckets = potDraw(advancers, 3);
  q.r3 = { groups: buckets.map((tk, i) => makeGroup(String.fromCharCode(65 + i), tk, true)) };
}

// Round 3 concludes → 3 group winners qualify; the 2 best runners-up are
// CONCACAF's two inter-confederation play-off reps (resolved centrally).
function concludeR3(q) {
  for (const g of q.r3.groups) q.qualifiedDirect.push(sortedGroup(g)[0].key);
  q.icpReps = rankRows(q.r3.groups.map((g) => sortedGroup(g)[1]).filter(Boolean)).slice(0, 2).map((r) => r.key);
  q.stage = "done";
}

// ---------------------------------------------------------------------------
export function concacafPlayerFixture(q) {
  const you = q.youKey;
  if (q.stage === "r1") {
    const tie = q.r1.ties.find((t) => t.a === you || t.b === you);
    if (!tie || tie.winner) return null;
    const leg = q.matchday;
    const homeKey = leg === 0 ? tie.a : tie.b;
    const awayKey = homeKey === tie.a ? tie.b : tie.a;
    return {
      kind: "tie", round: "r1", tie, leg, a: homeKey, b: awayKey,
      youIsHome: homeKey === you, youKey: you, oppKey: homeKey === you ? awayKey : homeKey,
      label: "ROUND 1 - LEG " + (leg + 1),
    };
  }
  if (q.stage === "r2" || q.stage === "r3") {
    const g = q[q.stage].groups.find((gr) => gr.teams.includes(you));
    if (!g) return null;
    const day = g.schedule[q.matchday];
    if (!day) return null;
    for (const [i, j] of day) {
      if (g.teams[i] === you || g.teams[j] === you) {
        return {
          kind: "group", round: q.stage, group: g, a: g.teams[i], b: g.teams[j],
          youIsA: g.teams[i] === you, youKey: you, oppKey: g.teams[i] === you ? g.teams[j] : g.teams[i],
          label: (q.stage === "r2" ? "ROUND 2" : "ROUND 3") + " - MD " + (q.matchday + 1),
        };
      }
    }
    return null; // bye this matchday
  }
  if (q.stage === "icp" && q.icp) {
    const i = q.icp;
    const m = i.stageIdx === 0 ? i.semi : i.final;
    if (!m || m.winner || (m.a !== you && m.b !== you)) return null;
    return {
      kind: "match", round: "icp", match: m, a: m.a, b: m.b,
      youIsA: m.a === you, youKey: you, oppKey: m.a === you ? m.b : m.a,
      label: "INTERCONTINENTAL PLAY-OFF " + (i.stageIdx === 0 ? "PLAY-IN" : "FINAL"),
    };
  }
  return null;
}

export function concacafStageLabel(q) {
  if (q.stage === "r1") return "ROUND 1 - LEG " + (q.matchday + 1);
  if (q.stage === "r2") return "ROUND 2 - MATCHDAY " + (q.matchday + 1);
  if (q.stage === "r3") return "FINAL ROUND - MATCHDAY " + (q.matchday + 1);
  if (q.stage === "icp") return "INTER-CONFEDERATION PLAY-OFF";
  return "QUALIFICATION COMPLETE";
}

export function previewPlayerOutcome(q, youScore, oppScore) {
  const f = concacafPlayerFixture(q);
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
    const p = penShootout(you, f.oppKey);
    const win = p[0] > p[1] ? you : f.oppKey;
    return { label: NATIONS[win].name + " WIN " + Math.max(p[0], p[1]) + "-" + Math.min(p[0], p[1]) + " PENS", pens: p };
  }
  // tie (two legs)
  const tie = f.tie;
  const priorYou = tie.a === you ? tie.agg[0] : tie.agg[1];
  const priorOpp = tie.a === you ? tie.agg[1] : tie.agg[0];
  const aggYou = priorYou + youScore, aggOpp = priorOpp + oppScore;
  if (f.leg === 0) return { label: "LEG 1  -  AGGREGATE " + aggYou + "-" + aggOpp, pens: null, partial: true };
  if (aggYou === aggOpp) {
    const p = penShootout(you, f.oppKey);
    const win = p[0] > p[1] ? you : f.oppKey;
    return { label: NATIONS[win].name + " WIN " + Math.max(p[0], p[1]) + "-" + Math.min(p[0], p[1]) + " PENS  (AGG " + aggYou + "-" + aggOpp + ")", pens: p };
  }
  const win = aggYou > aggOpp ? you : f.oppKey;
  return { label: NATIONS[win].name + " WIN  -  AGG " + Math.max(aggYou, aggOpp) + "-" + Math.min(aggYou, aggOpp), pens: null };
}

export function recordConcacafPlayerMatch(q, youScore, oppScore, pens) {
  const f = concacafPlayerFixture(q);
  if (!f) return;
  if (f.kind === "group") {
    const g = f.group;
    const sa = f.youIsA ? youScore : oppScore;
    const sb = f.youIsA ? oppScore : youScore;
    applyGroupResult(g, f.a, f.b, sa, sb, q.matchday);
    simRestOfGroupMatchday(q, g, f.a, f.b);
  } else if (f.kind === "tie") {
    const tie = f.tie;
    const youIsA = tie.a === f.youKey;
    const legA = youIsA ? youScore : oppScore;
    const legB = youIsA ? oppScore : youScore;
    setTieLeg(tie, f.leg, legA, legB);
    if (f.leg === 1) resolveTie(tie, pens ? (youIsA ? [pens[0], pens[1]] : [pens[1], pens[0]]) : null);
    simRestOfR1Leg(q, tie);
  } else {
    const m = f.match;
    const sa = f.youIsA ? youScore : oppScore;
    const sb = f.youIsA ? oppScore : youScore;
    applyMatch(m, sa, sb, pens ? (f.youIsA ? [pens[0], pens[1]] : [pens[1], pens[0]]) : null);
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

function simRestOfR1Leg(q, playerTie) {
  for (const tie of q.r1.ties) {
    if (tie === playerTie || tie.legs[q.matchday]) continue;
    const homeKey = q.matchday === 0 ? tie.a : tie.b;
    const sim = simMatch(homeKey, homeKey === tie.a ? tie.b : tie.a, false);
    setTieLeg(tie, q.matchday, homeKey === tie.a ? sim.a : sim.b, homeKey === tie.a ? sim.b : sim.a);
    if (q.matchday === 1) resolveTie(tie);
  }
}

export function concacafMatchweekResults(q) {
  const stage = q.stage;
  if (stage === "r2" || stage === "r3") {
    return {
      kind: "groups", stage, label: concacafStageLabel(q),
      groups: q[stage].groups.map((g) => ({
        name: g.name, yours: g.teams.includes(q.youKey),
        matches: g.results.filter((rr) => rr.md === q.matchday),
      })),
    };
  }
  if (stage === "r1") {
    return {
      kind: "ties", stage, label: concacafStageLabel(q),
      ties: q.r1.ties.map((t) => ({ a: t.a, b: t.b, leg: t.legs[q.matchday], agg: t.agg.slice(), winner: t.winner, pens: t.pens })),
    };
  }
  if (stage === "icp") return { kind: "icp", stage: "icp", label: "INTER-CONFEDERATION PLAY-OFF", icp: snapshotIcp(q) };
  return { kind: "done", stage, label: concacafStageLabel(q) };
}

const snapshotIcp = (q) => q.icp && ({ seeded: q.icp.seeded, afcKey: q.icp.afcKey, seed: q.icp.seed, semi: q.icp.semi && { ...q.icp.semi }, final: q.icp.final && { ...q.icp.final } });

export function advanceConcacafMatchweek(q) {
  q._prevStageLabel = concacafStageLabel(q).replace(/ - .*/, "");
  const stage = q.stage;
  if (stage === "r1") { q.matchday++; if (q.matchday >= 2) { buildRound2(q); q.stage = "r2"; q.matchday = 0; } }
  else if (stage === "r2") { q.matchday++; if (q.matchday >= q.r2.groups[0].schedule.length) { buildRound3(q); q.stage = "r3"; q.matchday = 0; } }
  else if (stage === "r3") { q.matchday++; if (q.matchday >= q.r3.groups[0].schedule.length) concludeR3(q); }
  updateAlive(q);
}

function advanceIcp(q) {
  if (!q.icp) { q.stage = "done"; return; } // human wasn't in the play-off
  const i = q.icp;
  if (i.stageIdx === 0) {
    if (!i.semi.winner) { const r = simMatch(i.semi.a, i.semi.b, true); applyMatch(i.semi, r.a, r.b); }
    i.final = makeMatch(i.semi.winner, i.seed, "FINAL");
    i.stageIdx = 1;
  } else {
    if (!i.final.winner) { const r = simMatch(i.final.a, i.final.b, true); applyMatch(i.final, r.a, r.b); }
    q.icpWinnerKey = i.final.winner;
    q.stage = "done";
  }
}

function updateAlive(q) {
  const you = q.youKey;
  if (q.stage === "done") { finalizeYouStatus(q); return; }
  if (q.qualifiedDirect.includes(you)) { q.youStatus = "qualified"; return; }
  let present = false;
  const stage = q.stage;
  if (stage === "r2" || stage === "r3") present = q[stage].groups.some((g) => g.teams.includes(you));
  else if (stage === "r1") present = q.r1.ties.some((t) => (t.a === you || t.b === you) && (!t.winner || t.winner === you));
  else if (stage === "icp") present = !!q.icp && q.icp.afcKey === you && (!q.icp.semi.winner || q.icp.semi.winner === you);
  if (!present && q.youStatus === "alive") { q.youStatus = "eliminated"; q.youOut = q._prevStageLabel || "QUALIFYING"; }
}

function finalizeYouStatus(q) {
  const you = q.youKey;
  if (q.qualifiedDirect.includes(you)) q.youStatus = "qualified";
  else if (q.icpReps.includes(you)) q.youStatus = "icp";
  else if (q.youStatus !== "eliminated") { q.youStatus = "eliminated"; q.youOut = q.youOut || "PLAY-OFF"; }
}

export function simConcacafRemaining(q) {
  let guard = 0;
  while (q.stage !== "done" && guard++ < 100) {
    const stage = q.stage;
    if (stage === "r1") { simWholeR1(q); buildRound2(q); q.stage = "r2"; q.matchday = 0; }
    else if (stage === "r2" || stage === "r3") {
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
      if (stage === "r2") { buildRound3(q); q.stage = "r3"; q.matchday = 0; }
      else concludeR3(q);
    }
  }
  finalizeYouStatus(q);
}

// ---------------------------------------------------------------------------
export function concacafQualifiers(q) {
  return { direct: q.qualifiedDirect.slice(), reps: q.icpReps.slice() };
}

// The World Cup field's 3 non-host CONCACAF slots (from GROUPS_2026).
export const CONCACAF_WC_SLOTS = ["PAN", "HAI", "CUW"];

export function buildConcacafSubMap(q) {
  const slots = [...CONCACAF_WC_SLOTS].sort((a, b) => ovr(b) - ovr(a));
  const news = q.qualifiedDirect.slice(0, 3).sort((a, b) => ovr(b) - ovr(a));
  const sub = {};
  for (let i = 0; i < slots.length; i++) sub[slots[i]] = news[i];
  // If our team won its play-off path, it takes that path's World Cup slot
  // (Iraq's or DR Congo's, in the 2026 field) — an extra CONCACAF team.
  if (q.icpWinnerKey && q.icpWinnerKey === q.icpTeam && q.icpSlot) sub[q.icpSlot] = q.icpWinnerKey;
  return sub;
}

// ---------------------------------------------------------------------------
function bandR2() {
  return (k, i) => (i < 2 ? { status: "good", badge: "ADV" } : { status: "out", badge: "OUT" });
}
function bandR3(q) {
  const best = bestRunnersUpKeys(q);
  return (k, i) => {
    if (i < 1) return { status: "good", badge: "WC" };
    if (i < 2) return best.has(k) ? { status: "good", badge: "P-O" } : { status: "next", badge: "RU" };
    return { status: "out", badge: "OUT" };
  };
}

export function concacafRoadView(q) {
  const s = q.stage;
  if (s === "r2" || s === "r3") {
    const groups = q[s].groups;
    return {
      kind: "groups", roundLabel: s === "r2" ? "ROUND 2" : "FINAL ROUND", groups,
      myGroup: groups.find((g) => g.teams.includes(q.youKey)) || null,
      bandFor: s === "r2" ? bandR2() : bandR3(q),
      footer: s === "r2" ? "TOP 2 ADVANCE TO THE FINAL ROUND"
        : "GROUP WINNER QUALIFIES  -  BEST 2 RUNNERS-UP REACH THE PLAY-OFF",
      overviewTitle: s === "r2" ? "ROUND 2 - 6 GROUPS OF 5" : "FINAL ROUND - 3 GROUPS OF 4",
    };
  }
  if (s === "r1") {
    return {
      kind: "ties", roundLabel: "ROUND 1", ties: q.r1.ties,
      myTie: q.r1.ties.find((t) => t.a === q.youKey || t.b === q.youKey) || null, twoLeg: true,
      tiesTitle: "ROUND 1 - YOUR TIE", overviewTitle: "ROUND 1 - ALL TIES",
      tiesFooter: "TWO LEGS - WINNER ON AGGREGATE ADVANCES",
    };
  }
  if (s === "icp") return { kind: "icp", roundLabel: "PLAY-OFF", icp: q.icp };
  return { kind: "done" };
}

export function concacafRoadRankTab(q) {
  if (q.stage !== "r3") return null;
  const rus = q.r3.groups
    .map((g) => { const ss = sortedGroup(g); return ss[1] ? { ...ss[1], grp: g.name } : null; })
    .filter(Boolean);
  const rows = rankRows(rus).map((r, i) => ({
    key: r.key, grp: r.grp, pld: r.pld, gf: r.gf, gd: r.gd, pts: r.pts,
    status: i < 2 ? "good" : "out", badge: i < 2 ? "PLAY-OFF" : "OUT",
  }));
  return { tabLabel: "RUNNERS-UP", title: "FINAL-ROUND RUNNERS-UP", subtitle: "BEST 2 ADVANCE TO THE PLAY-OFF", rows, cutoff: 2 };
}

export const ENGINE = {
  confed: "CONCACAF",
  region: "N & C AMERICA",
  pickHeader: "CONCACAF - 32 TEAMS (HOSTS AUTO-QUALIFY) - PLAY 2026 QUALIFYING",
  create: createConcacafQualification,
  playerFixture: concacafPlayerFixture,
  preview: previewPlayerOutcome,
  record: recordConcacafPlayerMatch,
  results: concacafMatchweekResults,
  advance: advanceConcacafMatchweek,
  stageLabel: concacafStageLabel,
  simRemaining: simConcacafRemaining,
  qualifiers: concacafQualifiers,
  buildSubMap: buildConcacafSubMap,
  sortedGroup,
  roadView: concacafRoadView,
  roadRankTab: concacafRoadRankTab,
  pickKeys: () => [...CONCACAF_DIRECT_R2, ...CONCACAF_R1],
};
