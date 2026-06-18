// ---------------------------------------------------------------------------
// The inter-confederation play-off — ONE real tournament among the six SIMULATED
// confederation representatives (not the 2026 teams). 6 teams, 2 paths, 2 World
// Cup berths.
//
//   The 2 highest-ranked reps are seeded straight into their path finals. The
//   other 4 contest two single-match play-ins; each play-in winner meets that
//   path's seed in a one-off final. The 2 final winners qualify.
//
//   The human's team (if it is its confederation's rep) plays its own path live;
//   everything else is simulated. Exposes the same road interface the engines do
//   so the road UI can drive it.
// ---------------------------------------------------------------------------
import { NATIONS } from "./nations.js";
import { simMatch, penShootout } from "./tournament.js";

const rank = (k) => NATIONS[k].fifaRank || 999;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

// reps: array of { key, confed } (length 6). youKey: the human's nation (may or
// may not be one of the reps).
export function createIcp(reps, youKey) {
  const sorted = [...reps].sort((a, b) => rank(a.key) - rank(b.key));
  const seeds = [sorted[0], sorted[1]];
  const unseeded = shuffle(sorted.slice(2)); // 4

  // Split the 4 unseeded across the two play-ins, minimising same-confederation
  // clashes within a path (the only possible duplicate is CONCACAF's two reps).
  const perms = [
    [[unseeded[0], unseeded[1]], [unseeded[2], unseeded[3]]],
    [[unseeded[0], unseeded[2]], [unseeded[1], unseeded[3]]],
    [[unseeded[0], unseeded[3]], [unseeded[1], unseeded[2]]],
  ];
  let best = perms[0], bestScore = Infinity;
  for (const [a, b] of perms) {
    const c0 = [seeds[0], ...a].map((x) => x.confed);
    const c1 = [seeds[1], ...b].map((x) => x.confed);
    const score = (c0.length - new Set(c0).size) + (c1.length - new Set(c1).size);
    if (score < bestScore) { bestScore = score; best = [a, b]; }
  }

  const paths = [
    { seed: seeds[0].key, semi: makeMatch(best[0][0].key, best[0][1].key, "PLAY-IN"), final: null },
    { seed: seeds[1].key, semi: makeMatch(best[1][0].key, best[1][1].key, "PLAY-IN"), final: null },
  ];
  let youPathIdx = -1;
  for (let i = 0; i < 2; i++) {
    const p = paths[i];
    if (p.seed === youKey || p.semi.a === youKey || p.semi.b === youKey) youPathIdx = i;
  }
  return { reps, youKey, paths, youPathIdx, stageIdx: 0, winners: [], done: false };
}

export function icpStageLabel(icp) {
  return "INTER-CONFEDERATION PLAY-OFF - " + (icp.stageIdx === 0 ? "PLAY-INS" : "FINALS");
}

// The human's fixture (null when they have a bye — a seed sitting out the play-in
// — or when they have been eliminated).
export function icpPlayerFixture(icp) {
  const you = icp.youKey;
  if (icp.youPathIdx < 0) return null;
  const p = icp.paths[icp.youPathIdx];
  if (icp.stageIdx === 0) {
    if (p.seed === you) return null; // seed byes the play-in
    if (!p.semi.winner && (p.semi.a === you || p.semi.b === you)) {
      return matchFixture(p.semi, you, "INTERCONTINENTAL PLAY-OFF PLAY-IN");
    }
    return null;
  }
  if (p.final && !p.final.winner && (p.final.a === you || p.final.b === you)) {
    return matchFixture(p.final, you, "INTERCONTINENTAL PLAY-OFF FINAL");
  }
  return null;
}

function matchFixture(m, you, label) {
  return {
    kind: "match", round: "icp", match: m, a: m.a, b: m.b,
    youIsA: m.a === you, youKey: you, oppKey: m.a === you ? m.b : m.a, label,
  };
}

export function previewPlayerOutcome(icp, youScore, oppScore) {
  const f = icpPlayerFixture(icp);
  if (!f) return { label: "", pens: null, decisive: true };
  const you = icp.youKey;
  if (youScore > oppScore) return { label: NATIONS[you].name + " WIN", pens: null };
  if (oppScore > youScore) return { label: NATIONS[f.oppKey].name + " WIN", pens: null };
  const p = penShootout(you, f.oppKey);
  const win = p[0] > p[1] ? you : f.oppKey;
  return { label: NATIONS[win].name + " WIN " + Math.max(p[0], p[1]) + "-" + Math.min(p[0], p[1]) + " PENS", pens: p };
}

export function recordPlayerMatch(icp, youScore, oppScore, pens) {
  const f = icpPlayerFixture(icp);
  if (!f) return;
  const m = f.match;
  const sa = f.youIsA ? youScore : oppScore;
  const sb = f.youIsA ? oppScore : youScore;
  applyMatch(m, sa, sb, pens ? (f.youIsA ? [pens[0], pens[1]] : [pens[1], pens[0]]) : null);
}

export function advanceIcp(icp) {
  if (icp.stageIdx === 0) {
    for (const p of icp.paths) if (!p.semi.winner) { const r = simMatch(p.semi.a, p.semi.b, true); applyMatch(p.semi, r.a, r.b); }
    for (const p of icp.paths) p.final = makeMatch(p.seed, p.semi.winner, "FINAL");
    icp.stageIdx = 1;
  } else {
    for (const p of icp.paths) if (!p.final.winner) { const r = simMatch(p.final.a, p.final.b, true); applyMatch(p.final, r.a, r.b); }
    icp.winners = icp.paths.map((p) => p.final.winner);
    icp.done = true;
  }
}

export function simIcpRemaining(icp) {
  let guard = 0;
  while (!icp.done && guard++ < 6) advanceIcp(icp);
}

export function icpWinners(icp) {
  if (!icp.done) simIcpRemaining(icp);
  return icp.winners.slice();
}

export function icpPlayerWon(icp) {
  return icp.winners.includes(icp.youKey);
}

export function icpMatchweekResults(icp) {
  return { kind: "icp", stage: "icp", label: icpStageLabel(icp), icp: snapshot(icp) };
}

function snapshot(icp) {
  return { youKey: icp.youKey, youPathIdx: icp.youPathIdx, stageIdx: icp.stageIdx, paths: icp.paths.map((p) => ({ seed: p.seed, semi: { ...p.semi }, final: p.final && { ...p.final } })) };
}

export function icpRoadView(icp) {
  return { kind: "icp", roundLabel: "PLAY-OFF", icp: snapshot(icp), tournament: true };
}
