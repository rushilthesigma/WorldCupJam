// ---------------------------------------------------------------------------
// CONMEBOL (South American) 2026 World Cup qualification engine — pure logic.
//
// Real 2026 CONMEBOL format (6 direct World Cup berths + 1 inter-confederation
// play-off berth):
//
//   League — all 10 members in ONE table, double round-robin (home & away,
//            18 matchdays). The top 6 qualify directly for the World Cup;
//            7th place goes to the inter-confederation play-off.
//   ICP    — the CONMEBOL team is UNSEEDED in its path: it plays Suriname in the
//            play-in, then the seed (Iraq) in the final. Winning the final takes
//            a World Cup berth (the path winner's slot).
//
// Same engine interface as afc.js / caf.js so the road UI is confederation
// agnostic.
// ---------------------------------------------------------------------------
import { NATIONS } from "./nations.js";
import { simMatch, penShootout } from "./tournament.js";
import { CONMEBOL_TEAMS, CONMEBOL_ICP } from "./conmebolData.js";

const ovr = (k) => NATIONS[k].ovr;
const rank = (k) => NATIONS[k].fifaRank || 999;

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
      const a = arr[i], b = arr[m - 1 - i];
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
    arr.splice(1, 0, arr.pop());
  }
  return double ? rounds.concat(rounds.map((d) => d.map(([a, b]) => [b, a]))) : rounds;
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

// ---------------------------------------------------------------------------
export function createConmebolQualification(youKey) {
  return {
    youKey, confed: "CONMEBOL",
    stage: "league", matchday: 0,
    league: makeGroup("CONMEBOL", [...CONMEBOL_TEAMS], true),
    qualifiedDirect: [],
    icpReps: [],
    icpTeam: null,
    icp: null,
    icpWinnerKey: null,
    youStatus: "alive",
    youOut: null,
    _prevStageLabel: "LEAGUE",
  };
}

function buildIcp(q, cmbKey) {
  // unseeded: cmbKey plays the play-in vs opponents[0], then the seed opponents[1].
  q.icpTeam = cmbKey;
  q.icp = {
    afcKey: cmbKey, // generic "our team" key (named afcKey for parity with afc.js)
    seeded: CONMEBOL_ICP.seeded,
    seed: CONMEBOL_ICP.opponents[1],
    semi: makeMatch(cmbKey, CONMEBOL_ICP.opponents[0], "PLAY-IN"),
    final: null,
    stageIdx: 0,
  };
}

// ---------------------------------------------------------------------------
export function conmebolPlayerFixture(q) {
  const you = q.youKey;
  if (q.stage === "league") {
    const g = q.league;
    const day = g.schedule[q.matchday];
    if (!day) return null;
    for (const [i, j] of day) {
      if (g.teams[i] === you || g.teams[j] === you) {
        return {
          kind: "group", round: "league", group: g, a: g.teams[i], b: g.teams[j],
          youIsA: g.teams[i] === you, youKey: you, oppKey: g.teams[i] === you ? g.teams[j] : g.teams[i],
          label: "MATCHDAY " + (q.matchday + 1),
        };
      }
    }
    return null;
  }
  if (q.stage === "icp") {
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

export function conmebolStageLabel(q) {
  if (q.stage === "league") return "LEAGUE - MATCHDAY " + (q.matchday + 1);
  if (q.stage === "icp") return "INTER-CONFEDERATION PLAY-OFF";
  return "QUALIFICATION COMPLETE";
}

export function previewPlayerOutcome(q, youScore, oppScore) {
  const f = conmebolPlayerFixture(q);
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

export function recordConmebolPlayerMatch(q, youScore, oppScore, pens) {
  const f = conmebolPlayerFixture(q);
  if (!f) return;
  if (f.kind === "group") {
    const g = f.group;
    const sa = f.youIsA ? youScore : oppScore;
    const sb = f.youIsA ? oppScore : youScore;
    applyGroupResult(g, f.a, f.b, sa, sb, q.matchday);
    simRestOfLeagueMatchday(q, f.a, f.b);
  } else {
    const m = f.match;
    const sa = f.youIsA ? youScore : oppScore;
    const sb = f.youIsA ? oppScore : youScore;
    const penAB = pens ? (f.youIsA ? [pens[0], pens[1]] : [pens[1], pens[0]]) : null;
    applyMatch(m, sa, sb, penAB);
  }
}

function simRestOfLeagueMatchday(q, playedA, playedB) {
  const g = q.league;
  const day = g.schedule[q.matchday];
  if (!day) return;
  for (const [i, j] of day) {
    const a = g.teams[i], b = g.teams[j];
    if (a === playedA && b === playedB) continue;
    if (g.results.some((rr) => rr.md === q.matchday && rr.a === a && rr.b === b)) continue;
    const sim = simMatch(a, b, false);
    applyGroupResult(g, a, b, sim.a, sim.b, q.matchday);
  }
}

export function conmebolMatchweekResults(q) {
  if (q.stage === "league") {
    return {
      kind: "groups", stage: "league", label: conmebolStageLabel(q),
      groups: [{ name: q.league.name, yours: true, matches: q.league.results.filter((rr) => rr.md === q.matchday) }],
    };
  }
  if (q.stage === "icp") return { kind: "icp", stage: "icp", label: "INTER-CONFEDERATION PLAY-OFF", icp: snapshotIcp(q) };
  return { kind: "done", stage: q.stage, label: conmebolStageLabel(q) };
}

const snapshotIcp = (q) => ({ seeded: q.icp.seeded, afcKey: q.icp.afcKey, seed: q.icp.seed, semi: q.icp.semi && { ...q.icp.semi }, final: q.icp.final && { ...q.icp.final } });

export function advanceConmebolMatchweek(q) {
  q._prevStageLabel = conmebolStageLabel(q).replace(/ - .*/, "");
  if (q.stage === "league") {
    q.matchday++;
    if (q.matchday >= q.league.schedule.length) concludeLeague(q);
  } else if (q.stage === "icp") {
    advanceIcp(q);
  }
  updateAlive(q);
}

function concludeLeague(q) {
  const s = sortedGroup(q.league);
  for (let i = 0; i < 6; i++) q.qualifiedDirect.push(s[i].key);
  // 7th place is CONMEBOL's inter-confederation play-off rep (resolved centrally).
  q.icpReps = [s[6].key];
  q.stage = "done";
}

function advanceIcp(q) {
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
  if (q.stage === "league") present = q.league.teams.includes(you);
  else if (q.stage === "icp") {
    present = q.icp.afcKey === you;
    if (present && q.icp.semi.winner && q.icp.semi.winner !== you) present = false; // lost the play-in
  }
  if (!present && q.youStatus === "alive") { q.youStatus = "eliminated"; q.youOut = q._prevStageLabel || "QUALIFYING"; }
}

function finalizeYouStatus(q) {
  const you = q.youKey;
  if (q.qualifiedDirect.includes(you)) q.youStatus = "qualified";
  else if (q.icpReps.includes(you)) q.youStatus = "icp";
  else if (q.youStatus !== "eliminated") { q.youStatus = "eliminated"; q.youOut = q.youOut || "PLAY-OFF"; }
}

export function simConmebolRemaining(q) {
  let guard = 0;
  while (q.stage !== "done" && guard++ < 100) {
    if (q.stage === "league") {
      const g = q.league;
      for (let md = 0; md < g.schedule.length; md++) {
        for (const [i, j] of g.schedule[md]) {
          const a = g.teams[i], b = g.teams[j];
          if (g.results.some((rr) => rr.md === md && rr.a === a && rr.b === b)) continue;
          const sim = simMatch(a, b, false);
          applyGroupResult(g, a, b, sim.a, sim.b, md);
        }
      }
      concludeLeague(q);
    } else if (q.stage === "icp") {
      advanceIcp(q);
    }
  }
  finalizeYouStatus(q);
}

// ---------------------------------------------------------------------------
export function conmebolQualifiers(q) {
  return { direct: q.qualifiedDirect.slice(), reps: q.icpReps.slice() };
}

// The World Cup field's 6 South American slots (from GROUPS_2026).
export const CONMEBOL_WC_SLOTS = ["BRA", "ARG", "URU", "COL", "ECU", "PAR"];

export function buildConmebolSubMap(q) {
  const slots = [...CONMEBOL_WC_SLOTS].sort((a, b) => ovr(b) - ovr(a));
  const news = q.qualifiedDirect.slice(0, 6).sort((a, b) => ovr(b) - ovr(a));
  const sub = {};
  for (let i = 0; i < slots.length; i++) sub[slots[i]] = news[i];
  // If our team won its inter-confederation play-off path, it takes the path
  // winner's World Cup slot (Iraq's, in the 2026 field) — a 7th South American.
  if (q.icpWinnerKey && q.icpWinnerKey === q.icpTeam) sub["IRQ"] = q.icpWinnerKey;
  return sub;
}

// ---------------------------------------------------------------------------
function conmebolBandFor() {
  return (k, i) => (i < 6 ? { status: "good", badge: "WC" } : i === 6 ? { status: "next", badge: "P-O" } : { status: "out", badge: "OUT" });
}

export function conmebolRoadView(q) {
  if (q.stage === "league") {
    return {
      kind: "groups", roundLabel: "LEAGUE", groups: [q.league], myGroup: q.league,
      bandFor: conmebolBandFor(),
      footer: "TOP 6 QUALIFY  -  7TH GOES TO THE INTER-CONFEDERATION PLAY-OFF",
      overviewTitle: "CONMEBOL LEAGUE TABLE", league: true,
    };
  }
  if (q.stage === "icp") return { kind: "icp", roundLabel: "PLAY-OFF", icp: q.icp };
  return { kind: "done" };
}

export const ENGINE = {
  confed: "CONMEBOL",
  region: "SOUTH AMERICA",
  pickHeader: "CONMEBOL - 10 TEAMS - ONE LEAGUE, TOP 6 QUALIFY, 7TH TO THE PLAY-OFF",
  create: createConmebolQualification,
  playerFixture: conmebolPlayerFixture,
  preview: previewPlayerOutcome,
  record: recordConmebolPlayerMatch,
  results: conmebolMatchweekResults,
  advance: advanceConmebolMatchweek,
  stageLabel: conmebolStageLabel,
  simRemaining: simConmebolRemaining,
  qualifiers: conmebolQualifiers,
  buildSubMap: buildConmebolSubMap,
  sortedGroup,
  roadView: conmebolRoadView,
  roadRankTab: () => null,
  pickKeys: () => [...CONMEBOL_TEAMS],
};
