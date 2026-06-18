// ---------------------------------------------------------------------------
// OFC (Oceania) 2026 World Cup qualification engine — pure logic, no rendering.
//
// Real 2026 format — OFC's first ever DIRECT berth (1 direct + 1 ICP):
//
//   Round 1 — the 4 lowest-ranked members in a 4-team single-elim knockout
//             (2 semis + a final); 1 winner advances to Round 2.
//   Round 2 — 8 teams (7 byes + R1 winner) in 2 groups of 4, single round-robin;
//             top 2 of each group (4) advance.
//   Round 3 — those 4 in a single-leg knockout (2 semis + a final). The final
//             WINNER qualifies directly for the World Cup; the LOSER goes to ICP.
//   ICP     — the OFC team is unseeded in Path 1: play-in vs Jamaica, then the
//             DR Congo seed. Win the final to take a World Cup berth.
// ---------------------------------------------------------------------------
import { NATIONS } from "./nations.js";
import { simMatch, penShootout } from "./tournament.js";
import { OFC_R2_DIRECT, OFC_R1, OFC_ICP } from "./ofcData.js";

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

// 4-team single-elim bracket (2 semis → final), seeded 1v4 / 2v3 by rank.
function makeBracket(teamKeys) {
  const t = [...teamKeys].sort((a, b) => rank(a) - rank(b));
  return { teams: t, semis: [makeMatch(t[0], t[3], "SEMI-FINAL"), makeMatch(t[1], t[2], "SEMI-FINAL")], final: null, stageIdx: 0 };
}
function bracketPlayerMatch(br, you) {
  if (br.stageIdx === 0) {
    const m = br.semis.find((s) => s.a === you || s.b === you);
    return m && !m.winner ? m : null;
  }
  return br.final && !br.final.winner && (br.final.a === you || br.final.b === you) ? br.final : null;
}
function simWholeBracket(br) {
  for (const s of br.semis) if (!s.winner) { const r = simMatch(s.a, s.b, true); applyMatch(s, r.a, r.b); }
  if (!br.final) br.final = makeMatch(br.semis[0].winner, br.semis[1].winner, "FINAL");
  if (!br.final.winner) { const r = simMatch(br.final.a, br.final.b, true); applyMatch(br.final, r.a, r.b); }
}

// ---------------------------------------------------------------------------
export function createOfcQualification(youKey) {
  const q = {
    youKey, confed: "OFC",
    stage: null, matchday: 0,
    r1: null, r2: null, r3: null, icp: null,
    qualifiedDirect: [],
    icpReps: [],
    icpTeam: null, icpWinnerKey: null,
    youStatus: "alive", youOut: null,
    _prevStageLabel: "QUALIFYING",
  };
  q.r1 = makeBracket(OFC_R1);
  if (OFC_R1.includes(youKey)) {
    q.stage = "r1";
  } else {
    simWholeBracket(q.r1);
    buildRound2(q);
    q.stage = "r2";
  }
  return q;
}

function buildRound2(q) {
  const buckets = potDraw([...OFC_R2_DIRECT, q.r1.final.winner], 2);
  q.r2 = { groups: buckets.map((tk, i) => makeGroup(String.fromCharCode(65 + i), tk, false)) };
}

function buildRound3(q) {
  const advancers = [];
  for (const g of q.r2.groups) { const s = sortedGroup(g); advancers.push(s[0].key, s[1].key); }
  q.r3 = makeBracket(advancers);
}

function buildIcp(q, ofcKey) {
  q.icpTeam = ofcKey;
  q.icp = {
    afcKey: ofcKey, seeded: false, seed: OFC_ICP.opponents[1],
    semi: makeMatch(ofcKey, OFC_ICP.opponents[0], "PLAY-IN"),
    final: null, stageIdx: 0,
  };
}

// ---------------------------------------------------------------------------
export function ofcPlayerFixture(q) {
  const you = q.youKey;
  if (q.stage === "r1" || q.stage === "r3") {
    const m = bracketPlayerMatch(q[q.stage], you);
    if (!m) return null;
    return {
      kind: "match", round: q.stage, match: m, a: m.a, b: m.b,
      youIsA: m.a === you, youKey: you, oppKey: m.a === you ? m.b : m.a,
      label: (q.stage === "r1" ? "ROUND 1 " : "FINAL ROUND ") + (q[q.stage].stageIdx === 0 ? "SEMI-FINAL" : "FINAL"),
    };
  }
  if (q.stage === "r2") {
    const g = q.r2.groups.find((gr) => gr.teams.includes(you));
    if (!g) return null;
    const day = g.schedule[q.matchday];
    if (!day) return null;
    for (const [i, j] of day) {
      if (g.teams[i] === you || g.teams[j] === you) {
        return {
          kind: "group", round: "r2", group: g, a: g.teams[i], b: g.teams[j],
          youIsA: g.teams[i] === you, youKey: you, oppKey: g.teams[i] === you ? g.teams[j] : g.teams[i],
          label: "ROUND 2 - MD " + (q.matchday + 1),
        };
      }
    }
    return null;
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

export function ofcStageLabel(q) {
  if (q.stage === "r1") return "ROUND 1 - " + (q.r1.stageIdx === 0 ? "SEMI-FINALS" : "FINAL");
  if (q.stage === "r2") return "ROUND 2 - MATCHDAY " + (q.matchday + 1);
  if (q.stage === "r3") return "FINAL ROUND - " + (q.r3.stageIdx === 0 ? "SEMI-FINALS" : "FINAL");
  if (q.stage === "icp") return "INTER-CONFEDERATION PLAY-OFF";
  return "QUALIFICATION COMPLETE";
}

export function previewPlayerOutcome(q, youScore, oppScore) {
  const f = ofcPlayerFixture(q);
  if (!f) return { label: "", pens: null, decisive: true };
  const you = q.youKey;
  if (f.kind === "group") {
    if (youScore > oppScore) return { label: NATIONS[you].name + " WIN", pens: null };
    if (oppScore > youScore) return { label: NATIONS[f.oppKey].name + " WIN", pens: null };
    return { label: "DRAW", pens: null };
  }
  if (youScore > oppScore) return { label: NATIONS[you].name + " WIN", pens: null };
  if (oppScore > youScore) return { label: NATIONS[f.oppKey].name + " WIN", pens: null };
  const p = penShootout(you, f.oppKey);
  const win = p[0] > p[1] ? you : f.oppKey;
  return { label: NATIONS[win].name + " WIN " + Math.max(p[0], p[1]) + "-" + Math.min(p[0], p[1]) + " PENS", pens: p };
}

export function recordOfcPlayerMatch(q, youScore, oppScore, pens) {
  const f = ofcPlayerFixture(q);
  if (!f) return;
  if (f.kind === "group") {
    const g = f.group;
    const sa = f.youIsA ? youScore : oppScore;
    const sb = f.youIsA ? oppScore : youScore;
    applyGroupResult(g, f.a, f.b, sa, sb, q.matchday);
    simRestOfGroupMatchday(q, g, f.a, f.b);
  } else {
    const m = f.match;
    const sa = f.youIsA ? youScore : oppScore;
    const sb = f.youIsA ? oppScore : youScore;
    applyMatch(m, sa, sb, pens ? (f.youIsA ? [pens[0], pens[1]] : [pens[1], pens[0]]) : null);
    // sim the other semi alongside the human's (so the bracket fills in)
    if ((q.stage === "r1" || q.stage === "r3") && q[q.stage].stageIdx === 0) {
      for (const s of q[q.stage].semis) if (!s.winner) { const r = simMatch(s.a, s.b, true); applyMatch(s, r.a, r.b); }
    }
  }
}

function simRestOfGroupMatchday(q, playerGroup, playedA, playedB) {
  for (const g of q.r2.groups) {
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

export function ofcMatchweekResults(q) {
  if (q.stage === "r2") {
    return {
      kind: "groups", stage: "r2", label: ofcStageLabel(q),
      groups: q.r2.groups.map((g) => ({ name: g.name, yours: g.teams.includes(q.youKey), matches: g.results.filter((rr) => rr.md === q.matchday) })),
    };
  }
  if (q.stage === "r1" || q.stage === "r3") {
    const br = q[q.stage];
    return { kind: "bracket", stage: q.stage, label: ofcStageLabel(q), playoff: { semis: br.semis.map((m) => ({ ...m })), final: br.final && { ...br.final } } };
  }
  if (q.stage === "icp") return { kind: "icp", stage: "icp", label: "INTER-CONFEDERATION PLAY-OFF", icp: snapshotIcp(q) };
  return { kind: "done", stage: q.stage, label: ofcStageLabel(q) };
}

const snapshotIcp = (q) => q.icp && ({ seeded: q.icp.seeded, afcKey: q.icp.afcKey, seed: q.icp.seed, semi: q.icp.semi && { ...q.icp.semi }, final: q.icp.final && { ...q.icp.final } });

export function advanceOfcMatchweek(q) {
  q._prevStageLabel = ofcStageLabel(q).replace(/ - .*/, "");
  const stage = q.stage;
  if (stage === "r1") advanceBracketStage(q, "r1");
  else if (stage === "r2") { q.matchday++; if (q.matchday >= q.r2.groups[0].schedule.length) { buildRound3(q); q.stage = "r3"; q.matchday = 0; } }
  else if (stage === "r3") advanceBracketStage(q, "r3");
  else if (stage === "icp") advanceIcp(q);
  updateAlive(q);
}

function advanceBracketStage(q, key) {
  const br = q[key];
  if (br.stageIdx === 0) {
    for (const s of br.semis) if (!s.winner) { const r = simMatch(s.a, s.b, true); applyMatch(s, r.a, r.b); }
    br.final = makeMatch(br.semis[0].winner, br.semis[1].winner, "FINAL");
    br.stageIdx = 1;
  } else {
    if (!br.final.winner) { const r = simMatch(br.final.a, br.final.b, true); applyMatch(br.final, r.a, r.b); }
    if (key === "r1") { buildRound2(q); q.stage = "r2"; q.matchday = 0; }
    else { // r3: final winner qualifies directly, loser is OFC's ICP rep
      const winner = br.final.winner;
      const loser = br.final.a === winner ? br.final.b : br.final.a;
      q.qualifiedDirect.push(winner);
      q.icpReps = [loser];
      q.stage = "done";
    }
  }
}

function advanceIcp(q) {
  if (!q.icp) { q.stage = "done"; return; }
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

function bracketPresent(br, you) {
  if (!br) return false;
  if (!br.final) return br.semis.some((s) => (s.a === you || s.b === you) && (!s.winner || s.winner === you));
  return br.final.a === you || br.final.b === you;
}

function updateAlive(q) {
  const you = q.youKey;
  if (q.stage === "done") { finalizeYouStatus(q); return; }
  if (q.qualifiedDirect.includes(you)) { q.youStatus = "qualified"; return; }
  let present = false;
  const stage = q.stage;
  if (stage === "r1") present = bracketPresent(q.r1, you);
  else if (stage === "r2") present = q.r2.groups.some((g) => g.teams.includes(you));
  else if (stage === "r3") present = bracketPresent(q.r3, you);
  else if (stage === "icp") present = !!q.icp && q.icp.afcKey === you && (!q.icp.semi.winner || q.icp.semi.winner === you);
  if (!present && q.youStatus === "alive") { q.youStatus = "eliminated"; q.youOut = q._prevStageLabel || "QUALIFYING"; }
}

function finalizeYouStatus(q) {
  const you = q.youKey;
  if (q.qualifiedDirect.includes(you)) q.youStatus = "qualified";
  else if (q.icpReps.includes(you)) q.youStatus = "icp";
  else if (q.youStatus !== "eliminated") { q.youStatus = "eliminated"; q.youOut = q.youOut || "PLAY-OFF"; }
}

export function simOfcRemaining(q) {
  let guard = 0;
  while (q.stage !== "done" && guard++ < 100) {
    const stage = q.stage;
    if (stage === "r1") { simWholeBracket(q.r1); buildRound2(q); q.stage = "r2"; q.matchday = 0; }
    else if (stage === "r2") {
      for (const g of q.r2.groups) {
        for (let md = 0; md < g.schedule.length; md++) {
          for (const [i, j] of g.schedule[md]) {
            const a = g.teams[i], b = g.teams[j];
            if (g.results.some((rr) => rr.md === md && rr.a === a && rr.b === b)) continue;
            const sim = simMatch(a, b, false);
            applyGroupResult(g, a, b, sim.a, sim.b, md);
          }
        }
      }
      buildRound3(q); q.stage = "r3"; q.matchday = 0;
    } else if (stage === "r3") {
      simWholeBracket(q.r3);
      const winner = q.r3.final.winner;
      const loser = q.r3.final.a === winner ? q.r3.final.b : q.r3.final.a;
      q.qualifiedDirect.push(winner);
      q.icpReps = [loser];
      q.stage = "done";
    }
  }
  finalizeYouStatus(q);
}

// ---------------------------------------------------------------------------
export function ofcQualifiers(q) {
  return { direct: q.qualifiedDirect.slice(), reps: q.icpReps.slice() };
}

// The World Cup field's single Oceanian slot (from GROUPS_2026).
export const OFC_WC_SLOTS = ["NZL"];

export function buildOfcSubMap(q) {
  const sub = {};
  if (q.qualifiedDirect[0]) sub["NZL"] = q.qualifiedDirect[0];
  // If our team won its play-off path, it takes that path's slot (DR Congo's).
  if (q.icpWinnerKey && q.icpWinnerKey === q.icpTeam) sub[OFC_ICP.slot] = q.icpWinnerKey;
  return sub;
}

// ---------------------------------------------------------------------------
function bandR2() {
  return (k, i) => (i < 2 ? { status: "good", badge: "ADV" } : { status: "out", badge: "OUT" });
}

export function ofcRoadView(q) {
  if (q.stage === "r2") {
    return {
      kind: "groups", roundLabel: "ROUND 2", groups: q.r2.groups,
      myGroup: q.r2.groups.find((g) => g.teams.includes(q.youKey)) || null,
      bandFor: bandR2(), footer: "TOP 2 ADVANCE TO THE FINAL ROUND", overviewTitle: "ROUND 2 - 2 GROUPS OF 4",
    };
  }
  if (q.stage === "r1" || q.stage === "r3") {
    const br = q[q.stage];
    return {
      kind: "bracket", roundLabel: q.stage === "r1" ? "ROUND 1" : "FINAL ROUND",
      bracketTitle: q.stage === "r1" ? "OFC ROUND 1 - PRELIMINARY KNOCKOUT" : "OFC FINAL ROUND - WIN TO QUALIFY",
      bracket: { semis: br.semis, final: br.final, finalLabel: q.stage === "r1" ? "FINAL - WIN TO REACH ROUND 2" : "FINAL - WINNER QUALIFIES, LOSER TO PLAY-OFF" },
    };
  }
  if (q.stage === "icp") return { kind: "icp", roundLabel: "PLAY-OFF", icp: q.icp };
  return { kind: "done" };
}

export const ENGINE = {
  confed: "OFC",
  region: "OCEANIA",
  pickHeader: "OFC - 11 TEAMS - PLAY 2026 QUALIFYING, WIN THE FINAL TO QUALIFY",
  create: createOfcQualification,
  playerFixture: ofcPlayerFixture,
  preview: previewPlayerOutcome,
  record: recordOfcPlayerMatch,
  results: ofcMatchweekResults,
  advance: advanceOfcMatchweek,
  stageLabel: ofcStageLabel,
  simRemaining: simOfcRemaining,
  qualifiers: ofcQualifiers,
  buildSubMap: buildOfcSubMap,
  sortedGroup,
  roadView: ofcRoadView,
  roadRankTab: () => null,
  pickKeys: () => [...OFC_R2_DIRECT, ...OFC_R1],
};
