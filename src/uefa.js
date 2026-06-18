// ---------------------------------------------------------------------------
// UEFA 2026 World Cup qualification engine — pure logic, no rendering.
//
// Real 2026 format (16 berths = 12 direct + 4 play-off; NO inter-confederation
// play-off):
//
//   Group stage — 54 teams in 12 groups (6 of 4 + 6 of 5), double round-robin.
//                 The 12 group WINNERS qualify directly for the World Cup.
//   Play-offs   — the 12 runners-up + the 4 best third-placed teams = 16 teams in
//                 4 paths of 4. Each path is single-leg semis + a final; the 4
//                 path winners qualify. We play the human's path; the other 3
//                 paths are simulated (they each still produce a qualifier).
//
// Same engine interface as the other confederations.
// ---------------------------------------------------------------------------
import { NATIONS } from "./nations.js";
import { simMatch, penShootout } from "./tournament.js";
import { UEFA_TEAMS } from "./uefaData.js";

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

// Pot draw into `groups` buckets — uneven totals leave the trailing buckets one
// short (54 → 6 groups of 5 + 6 groups of 4).
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

// Best 4 third-placed teams across the 12 groups (they join the play-offs).
export function bestThirdsKeys(q) {
  const thirds = q.groups.map((g) => sortedGroup(g)[2]).filter(Boolean);
  return new Set(rankRows(thirds).slice(0, 4).map((r) => r.key));
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

// 4-team path: 2 semis (1v4, 2v3 by rank) → final.
function makePath(teamKeys) {
  const t = [...teamKeys].sort((a, b) => rank(a) - rank(b));
  return { teams: t, semis: [makeMatch(t[0], t[3], "SEMI-FINAL"), makeMatch(t[1], t[2], "SEMI-FINAL")], final: null, stageIdx: 0 };
}
function pathPlayerMatch(p, you) {
  if (p.stageIdx === 0) { const m = p.semis.find((s) => s.a === you || s.b === you); return m && !m.winner ? m : null; }
  return p.final && !p.final.winner && (p.final.a === you || p.final.b === you) ? p.final : null;
}
function simWholePath(p) {
  for (const s of p.semis) if (!s.winner) { const r = simMatch(s.a, s.b, true); applyMatch(s, r.a, r.b); }
  if (!p.final) p.final = makeMatch(p.semis[0].winner, p.semis[1].winner, "FINAL");
  if (!p.final.winner) { const r = simMatch(p.final.a, p.final.b, true); applyMatch(p.final, r.a, r.b); }
}

// ---------------------------------------------------------------------------
export function createUefaQualification(youKey) {
  const buckets = potDraw(UEFA_TEAMS, 12);
  const groups = buckets.map((tk, i) => makeGroup(String.fromCharCode(65 + i), tk, true));
  return {
    youKey, confed: "UEFA",
    stage: "group", matchday: 0,
    groups,
    groupMaxLen: Math.max(...groups.map((g) => g.schedule.length)),
    qualifiedDirect: [],
    po: null,
    playoffWinners: [],
    youStatus: "alive", youOut: null,
    _prevStageLabel: "GROUP STAGE",
  };
}

function buildPlayoff(q) {
  const runnersUp = [], thirds = [];
  for (const g of q.groups) {
    const s = sortedGroup(g);
    q.qualifiedDirect.push(s[0].key);
    runnersUp.push(s[1].key);
    if (s[2]) thirds.push(s[2]);
  }
  const bestThirds = rankRows(thirds).slice(0, 4).map((r) => r.key);
  const poTeams = [...runnersUp, ...bestThirds]; // 16
  // seed into 4 paths via 4 pots of 4 (one per path)
  const sorted = [...poTeams].sort((a, b) => rank(a) - rank(b));
  const paths = [[], [], [], []];
  for (let p = 0; p < 4; p++) { const pot = shuffle(sorted.slice(p * 4, p * 4 + 4)); for (let i = 0; i < 4; i++) paths[i].push(pot[i]); }
  q.po = { paths: paths.map((tk) => makePath(tk)), youPathIdx: paths.findIndex((tk) => tk.includes(q.youKey)) };
  // simulate every path the human is NOT in (they each still yield a qualifier)
  for (let i = 0; i < 4; i++) if (i !== q.po.youPathIdx) simWholePath(q.po.paths[i]);
}

const youPath = (q) => (q.po && q.po.youPathIdx >= 0 ? q.po.paths[q.po.youPathIdx] : null);

// ---------------------------------------------------------------------------
export function uefaPlayerFixture(q) {
  const you = q.youKey;
  if (q.stage === "group") {
    const g = q.groups.find((gr) => gr.teams.includes(you));
    if (!g) return null;
    const day = g.schedule[q.matchday];
    if (!day) return null; // bye (a 4-team group on a late matchday)
    for (const [i, j] of day) {
      if (g.teams[i] === you || g.teams[j] === you) {
        return {
          kind: "group", round: "group", group: g, a: g.teams[i], b: g.teams[j],
          youIsA: g.teams[i] === you, youKey: you, oppKey: g.teams[i] === you ? g.teams[j] : g.teams[i],
          label: "GROUP - MD " + (q.matchday + 1),
        };
      }
    }
    return null;
  }
  if (q.stage === "po") {
    const p = youPath(q);
    if (!p) return null;
    const m = pathPlayerMatch(p, you);
    if (!m) return null;
    return {
      kind: "match", round: "po", match: m, a: m.a, b: m.b,
      youIsA: m.a === you, youKey: you, oppKey: m.a === you ? m.b : m.a,
      label: "PLAY-OFF " + (p.stageIdx === 0 ? "SEMI-FINAL" : "FINAL"),
    };
  }
  return null;
}

export function uefaStageLabel(q) {
  if (q.stage === "group") return "GROUP STAGE - MATCHDAY " + (q.matchday + 1);
  if (q.stage === "po") { const p = youPath(q); return "PLAY-OFFS - " + (p && p.stageIdx === 1 ? "FINAL" : "SEMI-FINALS"); }
  return "QUALIFICATION COMPLETE";
}

export function previewPlayerOutcome(q, youScore, oppScore) {
  const f = uefaPlayerFixture(q);
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

export function recordUefaPlayerMatch(q, youScore, oppScore, pens) {
  const f = uefaPlayerFixture(q);
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
    // play-off semis: sim the other semi in the human's path so the final builds
    const p = youPath(q);
    if (p && p.stageIdx === 0) for (const s of p.semis) if (!s.winner) { const r = simMatch(s.a, s.b, true); applyMatch(s, r.a, r.b); }
  }
}

function simRestOfGroupMatchday(q, playerGroup, playedA, playedB) {
  for (const g of q.groups) {
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

export function uefaMatchweekResults(q) {
  if (q.stage === "group") {
    return {
      kind: "groups", stage: "group", label: uefaStageLabel(q),
      groups: q.groups.map((g) => ({ name: g.name, yours: g.teams.includes(q.youKey), matches: g.results.filter((rr) => rr.md === q.matchday) })),
    };
  }
  if (q.stage === "po") {
    const p = youPath(q);
    return { kind: "bracket", stage: "po", label: uefaStageLabel(q), playoff: p ? { semis: p.semis.map((m) => ({ ...m })), final: p.final && { ...p.final } } : { semis: [], final: null } };
  }
  return { kind: "done", stage: q.stage, label: uefaStageLabel(q) };
}

export function advanceUefaMatchweek(q) {
  q._prevStageLabel = uefaStageLabel(q).replace(/ - .*/, "");
  if (q.stage === "group") {
    q.matchday++;
    if (q.matchday >= q.groupMaxLen) { buildPlayoff(q); q.stage = "po"; q.matchday = 0; }
  } else if (q.stage === "po") {
    advancePo(q);
  }
  updateAlive(q);
}

function advancePo(q) {
  const p = youPath(q);
  if (p) {
    if (p.stageIdx === 0) {
      for (const s of p.semis) if (!s.winner) { const r = simMatch(s.a, s.b, true); applyMatch(s, r.a, r.b); }
      p.final = makeMatch(p.semis[0].winner, p.semis[1].winner, "FINAL");
      p.stageIdx = 1;
      return; // human plays the final next
    }
    if (!p.final.winner) { const r = simMatch(p.final.a, p.final.b, true); applyMatch(p.final, r.a, r.b); }
  }
  collectPlayoffWinners(q);
  q.stage = "done";
}

function collectPlayoffWinners(q) {
  q.playoffWinners = [];
  for (const p of q.po.paths) { if (!p.final) simWholePath(p); q.playoffWinners.push(p.final.winner); }
}

function updateAlive(q) {
  const you = q.youKey;
  if (q.stage === "done") { finalizeYouStatus(q); return; }
  if (q.qualifiedDirect.includes(you)) { q.youStatus = "qualified"; return; }
  let present = false;
  if (q.stage === "group") present = q.groups.some((g) => g.teams.includes(you));
  else if (q.stage === "po") {
    const p = youPath(q);
    if (p) {
      if (!p.final) present = p.semis.some((s) => (s.a === you || s.b === you) && (!s.winner || s.winner === you));
      else present = p.final.a === you || p.final.b === you;
    }
  }
  if (!present && q.youStatus === "alive") { q.youStatus = "eliminated"; q.youOut = q._prevStageLabel || "QUALIFYING"; }
}

function finalizeYouStatus(q) {
  const you = q.youKey;
  if (q.qualifiedDirect.includes(you) || q.playoffWinners.includes(you)) q.youStatus = "qualified";
  else if (q.youStatus !== "eliminated") { q.youStatus = "eliminated"; q.youOut = q.youOut || "PLAY-OFF"; }
}

export function simUefaRemaining(q) {
  let guard = 0;
  while (q.stage !== "done" && guard++ < 100) {
    if (q.stage === "group") {
      for (const g of q.groups) {
        for (let md = 0; md < g.schedule.length; md++) {
          for (const [i, j] of g.schedule[md]) {
            const a = g.teams[i], b = g.teams[j];
            if (g.results.some((rr) => rr.md === md && rr.a === a && rr.b === b)) continue;
            const sim = simMatch(a, b, false);
            applyGroupResult(g, a, b, sim.a, sim.b, md);
          }
        }
      }
      buildPlayoff(q); q.stage = "po"; q.matchday = 0;
    } else if (q.stage === "po") {
      collectPlayoffWinners(q); q.stage = "done";
    }
  }
  finalizeYouStatus(q);
}

// ---------------------------------------------------------------------------
export function uefaQualifiers(q) {
  // UEFA fills all 16 of its World Cup slots directly (12 group winners + 4
  // play-off winners) and sends NO inter-confederation play-off representative.
  return { direct: [...q.qualifiedDirect, ...q.playoffWinners], reps: [] };
}

// The World Cup field's 16 UEFA slots (from GROUPS_2026).
export const UEFA_WC_SLOTS = ["FRA", "ESP", "ENG", "POR", "NED", "GER", "BEL", "CRO", "SUI", "NOR", "AUT", "SWE", "TUR", "CZE", "SCO", "BIH"];

export function buildUefaSubMap(q) {
  const fresh = [...q.qualifiedDirect, ...q.playoffWinners];
  while (fresh.length < UEFA_WC_SLOTS.length) fresh.push(UEFA_WC_SLOTS[fresh.length]);
  const slots = [...UEFA_WC_SLOTS].sort((a, b) => ovr(b) - ovr(a));
  const news = fresh.slice(0, UEFA_WC_SLOTS.length).sort((a, b) => ovr(b) - ovr(a));
  const sub = {};
  for (let i = 0; i < slots.length; i++) sub[slots[i]] = news[i];
  return sub;
}

// ---------------------------------------------------------------------------
function uefaBandFor(q) {
  const best = bestThirdsKeys(q);
  return (k, i) => {
    if (i < 1) return { status: "good", badge: "WC" };
    if (i < 2) return { status: "good", badge: "P-O" };
    if (i === 2) return best.has(k) ? { status: "good", badge: "P-O" } : { status: "next", badge: "3RD" };
    return { status: "out", badge: "OUT" };
  };
}

export function uefaRoadView(q) {
  if (q.stage === "group") {
    return {
      kind: "groups", roundLabel: "GROUP STAGE", groups: q.groups,
      myGroup: q.groups.find((g) => g.teams.includes(q.youKey)) || null,
      bandFor: uefaBandFor(q),
      footer: "GROUP WINNER QUALIFIES  -  RUNNER-UP + BEST 4 THIRDS GO TO THE PLAY-OFFS",
      overviewTitle: "GROUP STAGE - 12 GROUPS",
    };
  }
  if (q.stage === "po") {
    const p = youPath(q);
    return {
      kind: "bracket", roundLabel: "PLAY-OFFS",
      bracketTitle: "UEFA PLAY-OFF PATH  -  WIN TO QUALIFY",
      bracket: p ? { semis: p.semis, final: p.final, finalLabel: "FINAL - WINNER QUALIFIES" } : { semis: [], final: null, finalLabel: "FINAL" },
    };
  }
  return { kind: "done" };
}

export function uefaRoadRankTab(q) {
  if (q.stage !== "group") return null;
  const thirds = q.groups
    .map((g) => { const s = sortedGroup(g); return s[2] ? { ...s[2], grp: g.name } : null; })
    .filter(Boolean);
  const rows = rankRows(thirds).map((r, i) => ({
    key: r.key, grp: r.grp, pld: r.pld, gf: r.gf, gd: r.gd, pts: r.pts,
    status: i < 4 ? "good" : "out", badge: i < 4 ? "PLAY-OFF" : "OUT",
  }));
  return { tabLabel: "3RD PLACE", title: "BEST THIRD-PLACED TEAMS", subtitle: "BEST 4 JOIN THE 12 RUNNERS-UP IN THE PLAY-OFFS", rows, cutoff: 4 };
}

export const ENGINE = {
  confed: "UEFA",
  region: "EUROPE",
  pickHeader: "UEFA - 54 TEAMS - 12 GROUPS, WINNERS QUALIFY, THE REST PLAY OFF",
  create: createUefaQualification,
  playerFixture: uefaPlayerFixture,
  preview: previewPlayerOutcome,
  record: recordUefaPlayerMatch,
  results: uefaMatchweekResults,
  advance: advanceUefaMatchweek,
  stageLabel: uefaStageLabel,
  simRemaining: simUefaRemaining,
  qualifiers: uefaQualifiers,
  buildSubMap: buildUefaSubMap,
  sortedGroup,
  roadView: uefaRoadView,
  roadRankTab: uefaRoadRankTab,
  pickKeys: () => [...UEFA_TEAMS],
};
