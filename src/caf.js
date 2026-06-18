// ---------------------------------------------------------------------------
// CAF (African) 2026 World Cup qualification engine — pure logic, no rendering.
//
// Real 2026 CAF format (9 direct World Cup berths + 1 inter-confederation
// play-off berth):
//
//   Group stage — 54 teams in 9 groups of 6, double round-robin (home & away).
//                 The 9 group WINNERS qualify directly for the World Cup.
//   Play-off    — the 4 best group runners-up meet in a single-elimination
//                 mini-tournament (2 one-off semi-finals + a one-off final).
//                 The winner takes CAF's inter-confederation play-off berth.
//   ICP path    — the CAF team is the SEED in its play-off path: it sits out the
//                 play-in (Jamaica v New Caledonia) and plays the winner in a
//                 one-off final. Win it and you take the 10th African berth.
//
// Same engine interface as afc.js so the road UI is confederation-agnostic.
// ---------------------------------------------------------------------------
import { NATIONS } from "./nations.js";
import { simMatch, penShootout } from "./tournament.js";
import { CAF_TEAMS, CAF_ICP } from "./cafData.js";

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

// Cross-group ranking of standings rows (for best-runners-up).
function rankRows(rows) {
  return [...rows].sort((x, y) =>
    y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || y.w - x.w || rank(x.key) - rank(y.key)
  );
}

// Set of the 4 best group runners-up currently in play-off position (for the
// live indicator on 2nd-place rows).
export function bestRunnersUpKeys(q) {
  const rus = q.groups.map((g) => sortedGroup(g)[1]).filter(Boolean);
  return new Set(rankRows(rus).slice(0, 4).map((r) => r.key));
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
// Creation
// ---------------------------------------------------------------------------
export function createCafQualification(youKey) {
  const buckets = potDraw(CAF_TEAMS, 9);
  const groups = buckets.map((tk, i) => makeGroup(String.fromCharCode(65 + i), tk, true));
  return {
    youKey, confed: "CAF",
    stage: "group", matchday: 0,
    groups,
    qualifiedDirect: [],
    playoff: null,
    icp: null,
    icpReps: [],
    icpWinnerKey: null,
    youStatus: "alive",
    youOut: null,
    _prevStageLabel: "GROUP STAGE",
  };
}

function buildPlayoff(q) {
  for (const g of q.groups) q.qualifiedDirect.push(sortedGroup(g)[0].key);
  const rus = rankRows(q.groups.map((g) => sortedGroup(g)[1]).filter(Boolean)).slice(0, 4).map((r) => r.key);
  // seed highest vs lowest, 2nd vs 3rd
  q.playoff = {
    teams: rus,
    semis: [makeMatch(rus[0], rus[3], "SEMI-FINAL"), makeMatch(rus[1], rus[2], "SEMI-FINAL")],
    final: null,
    stageIdx: 0, // 0 = semis, 1 = final
  };
}

function buildIcp(q, cafKey) {
  q.icp = {
    afcKey: cafKey, // (generic "seed key" — named afcKey for parity with afc.js)
    seeded: CAF_ICP.seeded,
    seed: CAF_ICP.seeded ? cafKey : CAF_ICP.opponents[1],
    semi: CAF_ICP.seeded
      ? makeMatch(CAF_ICP.opponents[0], CAF_ICP.opponents[1], "PLAY-IN")
      : makeMatch(cafKey, CAF_ICP.opponents[0], "PLAY-IN"),
    final: null,
    stageIdx: 0,
  };
}

// ---------------------------------------------------------------------------
// Player fixture
// ---------------------------------------------------------------------------
export function cafPlayerFixture(q) {
  const you = q.youKey;
  if (q.stage === "group") {
    const g = q.groups.find((gr) => gr.teams.includes(you));
    if (!g) return null;
    const day = g.schedule[q.matchday];
    if (!day) return null;
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
  if (q.stage === "playoff") {
    const p = q.playoff;
    const m = p.stageIdx === 0 ? p.semis.find((s) => s.a === you || s.b === you) : p.final;
    if (!m || m.winner || (m.a !== you && m.b !== you)) return null;
    return {
      kind: "match", round: "playoff", match: m, a: m.a, b: m.b,
      youIsA: m.a === you, youKey: you, oppKey: m.a === you ? m.b : m.a,
      label: "CAF PLAY-OFF " + (p.stageIdx === 0 ? "SEMI-FINAL" : "FINAL"),
    };
  }
  if (q.stage === "icp") {
    const i = q.icp;
    const m = i.stageIdx === 0 ? i.semi : i.final;
    if (!m || m.winner || (m.a !== you && m.b !== you)) return null;
    return {
      kind: "match", round: "icp", match: m, a: m.a, b: m.b,
      youIsA: m.a === you, youKey: you, oppKey: m.a === you ? m.b : m.a,
      label: "INTERCONTINENTAL PLAY-OFF " + (i.stageIdx === 0 ? "SEMI" : "FINAL"),
    };
  }
  return null;
}

export function cafStageLabel(q) {
  if (q.stage === "group") return "GROUP STAGE - MATCHDAY " + (q.matchday + 1);
  if (q.stage === "playoff") return "CAF PLAY-OFF - " + (q.playoff.stageIdx === 0 ? "SEMI-FINALS" : "FINAL");
  if (q.stage === "icp") return "INTER-CONFEDERATION PLAY-OFF";
  return "QUALIFICATION COMPLETE";
}

// ---------------------------------------------------------------------------
// Player outcome for the FULL TIME screen (groups can draw; knockouts decisive).
// ---------------------------------------------------------------------------
export function previewPlayerOutcome(q, youScore, oppScore) {
  const f = cafPlayerFixture(q);
  if (!f) return { label: "", pens: null, decisive: true };
  const you = q.youKey;
  if (f.kind === "group") {
    if (youScore > oppScore) return { label: NATIONS[you].name + " WIN", pens: null };
    if (oppScore > youScore) return { label: NATIONS[f.oppKey].name + " WIN", pens: null };
    return { label: "DRAW", pens: null };
  }
  // single knockout match
  if (youScore > oppScore) return { label: NATIONS[you].name + " WIN", pens: null };
  if (oppScore > youScore) return { label: NATIONS[f.oppKey].name + " WIN", pens: null };
  const p = penShootout(you, f.oppKey);
  const win = p[0] > p[1] ? you : f.oppKey;
  return { label: NATIONS[win].name + " WIN " + Math.max(p[0], p[1]) + "-" + Math.min(p[0], p[1]) + " PENS", pens: p };
}

// ---------------------------------------------------------------------------
// Record the human's result + simulate the rest of the matchweek
// ---------------------------------------------------------------------------
export function recordCafPlayerMatch(q, youScore, oppScore, pens) {
  const f = cafPlayerFixture(q);
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
    const penAB = pens ? (f.youIsA ? [pens[0], pens[1]] : [pens[1], pens[0]]) : null;
    applyMatch(m, sa, sb, penAB);
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

export function cafMatchweekResults(q) {
  if (q.stage === "group") {
    return {
      kind: "groups", stage: "group", label: cafStageLabel(q),
      groups: q.groups.map((g) => ({
        name: g.name, yours: g.teams.includes(q.youKey),
        matches: g.results.filter((rr) => rr.md === q.matchday),
      })),
    };
  }
  if (q.stage === "playoff") return { kind: "bracket", stage: "playoff", label: cafStageLabel(q), playoff: snapshotPlayoff(q) };
  if (q.stage === "icp") return { kind: "icp", stage: "icp", label: "INTER-CONFEDERATION PLAY-OFF", icp: snapshotIcp(q) };
  return { kind: "done", stage: q.stage, label: cafStageLabel(q) };
}

const snapshotPlayoff = (q) => ({ semis: q.playoff.semis.map((m) => ({ ...m })), final: q.playoff.final && { ...q.playoff.final } });
const snapshotIcp = (q) => ({ seeded: q.icp.seeded, afcKey: q.icp.afcKey, seed: q.icp.seed, semi: q.icp.semi && { ...q.icp.semi }, final: q.icp.final && { ...q.icp.final } });

// ---------------------------------------------------------------------------
// Advance / conclude
// ---------------------------------------------------------------------------
export function advanceCafMatchweek(q) {
  q._prevStageLabel = cafStageLabel(q).replace(/ - .*/, "");
  if (q.stage === "group") {
    q.matchday++;
    if (q.matchday >= q.groups[0].schedule.length) { buildPlayoff(q); q.stage = "playoff"; q.matchday = 0; }
  } else if (q.stage === "playoff") {
    advancePlayoff(q);
  } else if (q.stage === "icp") {
    advanceIcp(q);
  }
  updateCafAlive(q);
}

function advancePlayoff(q) {
  const p = q.playoff;
  if (p.stageIdx === 0) {
    for (const s of p.semis) if (!s.winner) { const r = simMatch(s.a, s.b, true); applyMatch(s, r.a, r.b); }
    p.final = makeMatch(p.semis[0].winner, p.semis[1].winner, "FINAL");
    p.stageIdx = 1;
  } else {
    if (!p.final.winner) { const r = simMatch(p.final.a, p.final.b, true); applyMatch(p.final, r.a, r.b); }
    // The play-off winner is CAF's inter-confederation play-off rep (resolved centrally).
    q.icpReps = [p.final.winner];
    q.stage = "done";
  }
}

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

function updateCafAlive(q) {
  const you = q.youKey;
  if (q.stage === "done") { finalizeYouStatus(q); return; }
  if (q.qualifiedDirect.includes(you)) { q.youStatus = "qualified"; return; }
  let present = false;
  if (q.stage === "group") present = q.groups.some((g) => g.teams.includes(you));
  else if (q.stage === "playoff") {
    const p = q.playoff;
    if (p.stageIdx === 0) present = p.semis.some((s) => s.a === you || s.b === you);
    else present = p.final && (p.final.a === you || p.final.b === you);
  } else if (q.stage === "icp") {
    present = q.icp.afcKey === you;
    if (present && !q.icp.seeded && q.icp.semi.winner && q.icp.semi.winner !== you) present = false;
  }
  if (!present && q.youStatus === "alive") { q.youStatus = "eliminated"; q.youOut = q._prevStageLabel || "QUALIFYING"; }
}

function finalizeYouStatus(q) {
  const you = q.youKey;
  if (q.qualifiedDirect.includes(you)) q.youStatus = "qualified";
  else if (q.icpReps.includes(you)) q.youStatus = "icp";
  else if (q.youStatus !== "eliminated") { q.youStatus = "eliminated"; q.youOut = q.youOut || "PLAY-OFF"; }
}

export function simCafRemaining(q) {
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
      buildPlayoff(q); q.stage = "playoff"; q.matchday = 0;
    } else if (q.stage === "playoff") {
      advancePlayoff(q); // sims any undecided + advances
    } else if (q.stage === "icp") {
      advanceIcp(q);
    }
  }
  finalizeYouStatus(q);
}

// ---------------------------------------------------------------------------
// Qualifiers + World Cup substitution
// ---------------------------------------------------------------------------
export function cafQualifiers(q) {
  return { direct: q.qualifiedDirect.slice(), reps: q.icpReps.slice() };
}

// The World Cup field's 10 African slots (from GROUPS_2026).
export const CAF_WC_SLOTS = ["MAR", "SEN", "ALG", "CIV", "EGY", "GHA", "TUN", "RSA", "CPV", "COD"];

export function buildCafSubMap(q) {
  const qs = cafQualifiers(q);
  const fresh = [...qs.direct];
  if (qs.tenth) fresh.push(qs.tenth);
  while (fresh.length < CAF_WC_SLOTS.length) fresh.push(CAF_WC_SLOTS[fresh.length]);
  const slots = [...CAF_WC_SLOTS].sort((a, b) => ovr(b) - ovr(a));
  const news = fresh.slice(0, CAF_WC_SLOTS.length).sort((a, b) => ovr(b) - ovr(a));
  const sub = {};
  for (let i = 0; i < slots.length; i++) sub[slots[i]] = news[i];
  return sub;
}

// ---------------------------------------------------------------------------
// Render descriptor + uniform engine interface
// ---------------------------------------------------------------------------
function cafBandFor(q) {
  const best = bestRunnersUpKeys(q);
  return (k, i) => {
    if (i < 1) return { status: "good", badge: "WC" };
    if (i < 2) return best.has(k) ? { status: "good", badge: "PO" } : { status: "next", badge: "RU" };
    return { status: "out", badge: "OUT" };
  };
}

// Cross-group runners-up standings tab (group stage only): all 9 runners-up
// ranked, best 4 advance to the play-off.
export function cafRoadRankTab(q) {
  if (q.stage !== "group") return null;
  const rus = q.groups
    .map((g) => { const s = sortedGroup(g); return s[1] ? { ...s[1], grp: g.name } : null; })
    .filter(Boolean);
  const ranked = rankRows(rus);
  const rows = ranked.map((r, i) => ({
    key: r.key, grp: r.grp, pld: r.pld, gf: r.gf, gd: r.gd, pts: r.pts,
    status: i < 4 ? "good" : "out", badge: i < 4 ? "PLAY-OFF" : "OUT",
  }));
  return { tabLabel: "RUNNERS-UP", title: "GROUP RUNNERS-UP", subtitle: "BEST 4 ADVANCE TO THE CAF PLAY-OFF", rows, cutoff: 4 };
}

export function cafRoadView(q) {
  if (q.stage === "group") {
    return {
      kind: "groups", roundLabel: "GROUP STAGE", groups: q.groups,
      myGroup: q.groups.find((g) => g.teams.includes(q.youKey)) || null,
      bandFor: cafBandFor(q),
      footer: "GROUP WINNER QUALIFIES  -  BEST 4 RUNNERS-UP MAKE THE PLAY-OFF",
      overviewTitle: "GROUP STAGE - 9 GROUPS OF 6",
    };
  }
  if (q.stage === "playoff") {
    const p = q.playoff;
    return {
      kind: "bracket", roundLabel: "PLAY-OFF",
      bracketTitle: "CAF PLAY-OFF  -  BEST RUNNERS-UP",
      bracket: {
        semis: p.semis, final: p.final,
        finalLabel: "FINAL  -  WIN TO REACH THE PLAY-OFF",
      },
    };
  }
  if (q.stage === "icp") return { kind: "icp", roundLabel: "PLAY-OFF", icp: q.icp };
  return { kind: "done" };
}

export const ENGINE = {
  confed: "CAF",
  region: "AFRICA",
  pickHeader: "CAF - 54 TEAMS - PLAY 2026 QUALIFYING, THEN INTO THE WORLD CUP",
  create: createCafQualification,
  playerFixture: cafPlayerFixture,
  preview: previewPlayerOutcome,
  record: recordCafPlayerMatch,
  results: cafMatchweekResults,
  advance: advanceCafMatchweek,
  stageLabel: cafStageLabel,
  simRemaining: simCafRemaining,
  qualifiers: cafQualifiers,
  buildSubMap: buildCafSubMap,
  sortedGroup,
  roadView: cafRoadView,
  roadRankTab: cafRoadRankTab,
  pickKeys: () => [...CAF_TEAMS],
};
