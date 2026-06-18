// ---------------------------------------------------------------------------
// World Cup front-end: the Mode Select, team pick, and tournament hub screens.
//
// main.js owns input + the match engine; while we're on one of these menus it
// delegates the whole frame to this controller (update + render) and exposes a
// few hooks so we can launch a match, drop into Quick Play, or bail to the
// title. Everything here is mouse-first (every action is a clickable button or
// grid cell) with keyboard as a fallback. Pure tournament maths lives in
// tournament.js — this file is only flow + drawing.
// ---------------------------------------------------------------------------
import { VIEW_W, VIEW_H } from "./constants.js";
import { NATIONS, WC_KEYS, NATION_KEYS, drawKit, keysByConfed } from "./nations.js";

// Fast lookup: which keys are actually in the 2026 World Cup field.
const WC_SET = new Set(WC_KEYS);
import { drawText, drawTextCentered, textWidth } from "./font.js";
import * as T from "./tournament.js";
import { ENGINE as AFC_ENGINE } from "./afc.js";
import { ENGINE as CAF_ENGINE } from "./caf.js";
import { ENGINE as CONMEBOL_ENGINE } from "./conmebol.js";
import { ENGINE as CONCACAF_ENGINE } from "./concacaf.js";
import { ENGINE as OFC_ENGINE } from "./ofc.js";
import { ENGINE as UEFA_ENGINE } from "./uefa.js";
import * as ICP from "./icp.js";
import { CONFED_DIRECT_SLOTS, ICP_SLOTS } from "./confedSlots.js";
import * as Save from "./save.js";

// "Road to the World Cup" — one qualification engine per confederation. Each
// engine exposes the same interface (create/playerFixture/preview/record/
// results/advance/stageLabel/simRemaining/qualifiers/buildSubMap/sortedGroup/
// roadView/roadRankTab) so the road UI below is confederation-agnostic.
const ROAD_ENGINES = { AFC: AFC_ENGINE, CAF: CAF_ENGINE, CONMEBOL: CONMEBOL_ENGINE, CONCACAF: CONCACAF_ENGINE, OFC: OFC_ENGINE, UEFA: UEFA_ENGINE };
// Confederations offered on the road-select screen (in order). `soon` = visible
// but not yet playable — all six are now playable.
const ROAD_CONFEDS = [
  { key: "AFC", name: "ASIA", soon: false },
  { key: "CAF", name: "AFRICA", soon: false },
  { key: "CONMEBOL", name: "SOUTH AMERICA", soon: false },
  { key: "CONCACAF", name: "N & C AMERICA", soon: false },
  { key: "OFC", name: "OCEANIA", soon: false },
  { key: "UEFA", name: "EUROPE", soon: false },
];
const BLUE = "#5aa9e6"; // "advances to the next round" indicator
const statusColor = (s) => (s === "good" ? GREEN : s === "next" ? BLUE : "#3a4566");

const ACC = "#ffe66b";
const LINE = "#27406a";
const TEXT = "#eaf0ff";
const MUTE = "#9fb6e0";
const SUB = "#bcd3ff";
const GREEN = "#7cff8a";
const PANEL = "rgba(11,20,38,0.92)";

const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function ovrColor(o) {
  return o >= 85 ? "#7cff8a" : o >= 80 ? "#bfe66b" : o >= 76 ? "#ffe66b" : "#d2a24a";
}

export function createWorldCup(hooks) {
  // hooks: { startMatch(youKey, oppKey, knockout), quickPlay(), toTitle(), sfx }
  const sfx = hooks.sfx || {};
  const ctrl = {
    view: "mode", // mode | team | hub | results | eliminated | champion | road | roadresults | roadqualified | roadeliminated
    t: null,
    sel: 0, // focused button index (keyboard)
    hubTab: "me", // me | all
    gridCursor: 0,
    gridScroll: 0,
    searchQuery: "",
    searchFocused: false,
    allScroll: 0,
    resScroll: 0,
    buttons: [], // focusable buttons for the current frame
    // live input snapshot (set each update, read by render for hover)
    mx: 0,
    my: 0,
    mouseActive: false,
    // current match context
    matchYou: null,
    matchOpp: null,
    matchKnockout: false,
    pendingPens: null,
    // --- Road to the World Cup (confederation qualification) ---
    pickMode: "wc",     // "wc" | "road" — which team grid is showing
    roadConfed: "AFC",  // which confederation's road is being played
    eng: AFC_ENGINE,    // the active qualification engine for that confederation
    road: null,         // the qualification object produced by the engine
    roadActive: false,  // true while playing qualification (before the WC hand-off)
    roadTab: "me",      // "me" | "all" dashboard tab in the road hub
    roadResultsData: null,
    // --- Save files (save.js) ---
    slotsMode: "load",  // "load" (from the menu) | "save" (from a campaign)
    slotsFrom: "mode",  // view to return to when leaving the slots screen
    slotCursor: 0,      // focused slot row (keyboard)
    slots: [],          // cached slot list, refreshed when the screen opens
    pendingSlot: -1,    // slot armed for overwrite/delete confirmation (-1 = none)
    pendingDelete: false, // true when the armed action is a delete (vs overwrite)
    activeSlot: -1,     // slot the live campaign auto-syncs into (-1 = unsaved)
    slotMsg: "",        // transient confirmation line on the slots screen
  };

  // -------------------------------------------------------------------------
  // Public entry points called by main.js
  // -------------------------------------------------------------------------
  ctrl.enter = function () {
    ctrl.view = "mode";
    ctrl.sel = 0;
    ctrl.t = null;
  };

  // Final-score label for the FULL TIME screen (resolves a drawn knockout tie
  // on penalties and caches them so reportResult reuses the same shootout).
  ctrl.previewOutcome = function (youScore, oppScore) {
    // Road to the World Cup: leg/aggregate/penalty logic lives in the active
    // engine (the confederation's, or the central ICP while playing it).
    if (ctrl.roadActive && ctrl.road) {
      const out = aEng().preview(aObj(), youScore, oppScore);
      ctrl.pendingPens = out.pens;
      return out.label;
    }
    const you = ctrl.matchYou;
    const opp = ctrl.matchOpp;
    if (youScore > oppScore) return NATIONS[you].name + " WIN";
    if (oppScore > youScore) return NATIONS[opp].name + " WIN";
    // knockout draw -> shootout
    const pens = T.penShootout(you, opp); // [youPens, oppPens]
    ctrl.pendingPens = pens;
    const winner = pens[0] > pens[1] ? you : opp;
    const hi = Math.max(pens[0], pens[1]);
    const lo = Math.min(pens[0], pens[1]);
    return NATIONS[winner].name + " WIN " + hi + "-" + lo + " PENS";
  };

  // Record the human's result, snapshot the matchweek, show the results screen.
  ctrl.reportResult = function (youScore, oppScore) {
    if (ctrl.roadActive && ctrl.road) {
      reportRoadResult(youScore, oppScore);
      return;
    }
    const pens = youScore === oppScore ? ctrl.pendingPens || T.penShootout(ctrl.matchYou, ctrl.matchOpp) : null;
    T.recordPlayerMatch(ctrl.t, youScore, oppScore, pens);
    ctrl.resultsData = T.matchweekResults(ctrl.t);
    ctrl.pendingPens = null;
    ctrl.resScroll = 0;
    ctrl.sel = 0;
    ctrl.view = "results";
  };

  // -------------------------------------------------------------------------
  // Match launching
  // -------------------------------------------------------------------------
  function simPlayerMatch() {
    const t = ctrl.t;
    const f = T.playerFixture(t);
    if (!f) return;
    const r = T.simMatch(f.a, f.b, f.kind === "ko");
    const youScore = f.youIsA ? r.a : r.b;
    const oppScore = f.youIsA ? r.b : r.a;
    let pens = null;
    if (r.pens) {
      pens = f.youIsA ? [r.pens[0], r.pens[1]] : [r.pens[1], r.pens[0]];
    }
    T.recordPlayerMatch(t, youScore, oppScore, pens);
    ctrl.resultsData = T.matchweekResults(t);
    ctrl.pendingPens = null;
    ctrl.resScroll = 0;
    ctrl.sel = 0;
    ctrl.view = "results";
    if (sfx.whistle) sfx.whistle();
  }

  function startPlayerMatch() {
    const f = T.playerFixture(ctrl.t);
    if (!f) return;
    const you = ctrl.t.youKey;
    const opp = f.a === you ? f.b : f.a;
    ctrl.matchYou = you;
    ctrl.matchOpp = opp;
    ctrl.matchKnockout = f.kind === "ko";
    ctrl.pendingPens = null;
    if (sfx.whistle) sfx.whistle();
    hooks.startMatch(you, opp, ctrl.matchKnockout);
  }

  function continueAfterResults() {
    T.advanceMatchweek(ctrl.t);
    T.checkGroupElimination(ctrl.t);
    ctrl.sel = 0;
    ctrl.allScroll = 0;
    if (ctrl.t.stage === "done" || ctrl.t.champion) ctrl.view = "champion";
    else if (!ctrl.t.youAlive) ctrl.view = "eliminated";
    else {
      ctrl.hubTab = "me";
      ctrl.view = "hub";
    }
    autosaveActiveSlot(); // keep a bound slot fresh between matchweeks
  }

  // -------------------------------------------------------------------------
  // Road to the World Cup — confederation qualification flow (engine-driven)
  // -------------------------------------------------------------------------
  function startRoad(youKey) {
    ctrl.eng = ROAD_ENGINES[ctrl.roadConfed] || AFC_ENGINE;
    ctrl.road = ctrl.eng.create(youKey);
    ctrl.roadActive = true;
    ctrl.icp = null;
    ctrl.icpActive = false;
    ctrl.roadOtherQs = null;
    ctrl.roadTab = "me";
    ctrl.allScroll = 0;
    ctrl.sel = 0;
    ctrl.activeSlot = -1; // a fresh run is unsaved until you pick a slot
    ctrl.view = "road";
  }

  // While the human plays the inter-confederation play-off, the "engine" driving
  // fixtures/results is the central ICP; otherwise it's their confederation's.
  const ICP_ENG = {
    playerFixture: ICP.icpPlayerFixture, preview: ICP.previewPlayerOutcome,
    record: ICP.recordPlayerMatch, results: ICP.icpMatchweekResults,
    advance: ICP.advanceIcp, stageLabel: ICP.icpStageLabel, roadView: ICP.icpRoadView,
  };
  const aEng = () => (ctrl.icpActive ? ICP_ENG : ctrl.eng);
  const aObj = () => (ctrl.icpActive ? ctrl.icp : ctrl.road);

  function startRoadMatch() {
    const f = aEng().playerFixture(aObj());
    if (!f) return;
    ctrl.matchYou = f.youKey;
    ctrl.matchOpp = f.oppKey;
    // A two-legged tie's leg can be drawn (aggregate decides later); a single
    // knockout match (including every ICP match) forces a live shootout.
    ctrl.matchKnockout = f.kind === "match";
    ctrl.pendingPens = null;
    if (sfx.whistle) sfx.whistle();
    const youHome = f.a === f.youKey;
    hooks.startMatch(f.youKey, f.oppKey, ctrl.matchKnockout, true, ctrl.roadConfed, youHome);
  }

  function simRoadMatch() {
    const e = aEng(), o = aObj();
    const f = e.playerFixture(o);
    if (!f) return;
    const r = T.simMatch(f.youKey, f.oppKey, false);
    const out = e.preview(o, r.a, r.b);
    e.record(o, r.a, r.b, out.pens);
    ctrl.roadResultsData = e.results(o);
    ctrl.pendingPens = null;
    ctrl.resScroll = 0;
    ctrl.sel = 0;
    ctrl.view = "roadresults";
    if (sfx.whistle) sfx.whistle();
  }

  // No fixture for the human this matchweek (a group bye, or a play-in a seed
  // sits out): advance directly.
  function skipRoadWeek() {
    aEng().advance(aObj());
    afterAdvance();
  }

  function reportRoadResult(youScore, oppScore) {
    const e = aEng(), o = aObj();
    e.record(o, youScore, oppScore, ctrl.pendingPens);
    ctrl.roadResultsData = e.results(o);
    ctrl.pendingPens = null;
    ctrl.resScroll = 0;
    ctrl.sel = 0;
    ctrl.view = "roadresults";
  }

  function continueAfterRoadResults() {
    aEng().advance(aObj());
    afterAdvance();
    autosaveActiveSlot();
  }

  function afterAdvance() {
    ctrl.sel = 0;
    ctrl.allScroll = 0;
    if (ctrl.icpActive) { afterIcpAdvance(); return; }
    afterRoadAdvance();
  }

  // After a confederation matchweek: keep playing, celebrate direct qualification,
  // enter the central play-off (if you're your confederation's rep), or end.
  function afterRoadAdvance() {
    const q = ctrl.road;
    if (q.youStatus === "qualified") {
      ctrl.view = "roadqualified";
    } else if (q.youStatus === "icp") {
      enterIntercontinental();
    } else if (q.youStatus === "eliminated") {
      ctrl.view = "roadeliminated";
    } else {
      ctrl.roadTab = "me";
      ctrl.view = "road";
    }
  }

  function afterIcpAdvance() {
    if (!ctrl.icp.done) { ctrl.roadTab = "me"; ctrl.view = "road"; return; }
    const won = ICP.icpPlayerWon(ctrl.icp);
    ctrl.road.youStatus = won ? "qualified" : "eliminated";
    ctrl.icpActive = false;
    ctrl.view = won ? "roadqualified" : "roadeliminated";
  }

  // -------------------------------------------------------------------------
  // Whole-world simulation: the other five confederations + the central ICP
  // -------------------------------------------------------------------------
  // Simulate every confederation the human did NOT play, so the World Cup field
  // is freshly generated (not a copy of the real 2026 result).
  function ensureOthersSimmed() {
    if (!ctrl.roadOtherQs) ctrl.roadOtherQs = {};
    for (const confed of Object.keys(ROAD_ENGINES)) {
      if (confed === ctrl.roadConfed || ctrl.roadOtherQs[confed]) continue;
      const e = ROAD_ENGINES[confed];
      const oq = e.create(e.pickKeys()[0]); // youKey is irrelevant for a full sim
      e.simRemaining(oq);
      ctrl.roadOtherQs[confed] = oq;
    }
  }

  // The six inter-confederation play-off representatives, one (or two for
  // CONCACAF) per confederation, taken from each confederation's simulation.
  function gatherIcpReps() {
    const reps = [];
    for (const confed of Object.keys(ROAD_ENGINES)) {
      const q = confed === ctrl.roadConfed ? ctrl.road : ctrl.roadOtherQs[confed];
      for (const k of (ROAD_ENGINES[confed].qualifiers(q).reps || [])) reps.push({ key: k, confed });
    }
    return reps;
  }

  // The human is their confederation's ICP rep: build the real play-off among the
  // six simulated reps and play their path.
  function enterIntercontinental() {
    if (ctrl.road.stage !== "done") ctrl.eng.simRemaining(ctrl.road); // lock in direct qualifiers + rep
    ensureOthersSimmed();
    ctrl.icp = ICP.createIcp(gatherIcpReps(), ctrl.road.youKey);
    ctrl.icpActive = true;
    ctrl.roadTab = "me";
    ctrl.view = "road";
  }

  // Make sure the ICP exists and is resolved (used when the human didn't play it).
  function ensureIcpResolved() {
    if (!ctrl.icp) { ensureOthersSimmed(); ctrl.icp = ICP.createIcp(gatherIcpReps(), ctrl.road.youKey); }
    ICP.simIcpRemaining(ctrl.icp);
  }

  // OVR-pair a list of WC slots with the teams that won them.
  function assignByOvr(sub, slots, teams) {
    const t = teams.slice();
    while (t.length < slots.length) t.push(slots[t.length]);
    const ss = [...slots].sort((a, b) => NATIONS[b].ovr - NATIONS[a].ovr);
    const tt = t.slice(0, slots.length).sort((a, b) => NATIONS[b].ovr - NATIONS[a].ovr);
    for (let i = 0; i < ss.length; i++) sub[ss[i]] = tt[i];
  }

  // Rebuild the ENTIRE 48-team field from simulated qualifying: every
  // confederation's direct berths + the 2 winners of the simulated ICP. Hosts
  // (USA/MEX/CAN) are untouched.
  function buildWorldSubMap() {
    if (ctrl.road.stage !== "done") ctrl.eng.simRemaining(ctrl.road);
    ensureOthersSimmed();
    ensureIcpResolved();
    const sub = {};
    for (const confed of Object.keys(CONFED_DIRECT_SLOTS)) {
      const q = confed === ctrl.roadConfed ? ctrl.road : ctrl.roadOtherQs[confed];
      assignByOvr(sub, CONFED_DIRECT_SLOTS[confed], ROAD_ENGINES[confed].qualifiers(q).direct);
    }
    assignByOvr(sub, ICP_SLOTS, ICP.icpWinners(ctrl.icp));
    return sub;
  }

  // Drop into the World Cup the human qualified for (or watch it as a neutral).
  function handoffToWorldCup(spectate) {
    const sub = buildWorldSubMap();
    const youKey = (!spectate && ctrl.road.youStatus === "qualified") ? ctrl.road.youKey : Object.values(sub)[0];
    ctrl.t = T.createTournament(youKey, sub);
    ctrl.roadActive = false;
    ctrl.hubTab = "me";
    ctrl.sel = 0;
    ctrl.allScroll = 0;
    if (spectate) {
      T.simToEnd(ctrl.t);
      ctrl.view = "champion";
    } else {
      ctrl.view = "hub";
      autosaveActiveSlot();
    }
  }

  // -------------------------------------------------------------------------
  // Save files
  // -------------------------------------------------------------------------
  // Snapshot the live campaign into a storable payload (or null if there's no
  // savable campaign right now). Road runs are only savable while still alive —
  // a finished road has either handed off to the cup or ended.
  function campaignSnapshot() {
    if (ctrl.roadActive && ctrl.road && ctrl.road.youStatus === "alive") {
      return {
        kind: "road",
        confed: ctrl.roadConfed,
        youKey: ctrl.road.youKey,
        label: ctrl.eng.region + " - " + ctrl.eng.stageLabel(ctrl.road),
        data: { road: ctrl.road },
      };
    }
    if (ctrl.t && !ctrl.roadActive) {
      return {
        kind: "wc",
        youKey: ctrl.t.youKey,
        label: T.stageLabel(ctrl.t),
        data: { t: ctrl.t },
      };
    }
    return null;
  }

  // True when there's a campaign the player could save from the current screen.
  function canSaveNow() {
    return !!campaignSnapshot();
  }

  // Re-write the slot the live campaign is bound to, so named saves stay fresh
  // as you progress without re-picking a slot each matchweek. No-op when the run
  // is unsaved (activeSlot === -1) or can't be snapshotted.
  function autosaveActiveSlot() {
    if (ctrl.activeSlot < 0) return;
    const snap = campaignSnapshot();
    if (!snap) return;
    Save.saveSlot(ctrl.activeSlot, snap);
  }

  // Open the slots screen in either "load" (from the menu) or "save" (from a
  // campaign) mode, remembering where to return to.
  function enterSlots(mode, from) {
    ctrl.slotsMode = mode;
    ctrl.slotsFrom = from;
    ctrl.slots = Save.listSlots();
    ctrl.slotCursor = 0;
    ctrl.pendingSlot = -1;
    ctrl.pendingDelete = false;
    ctrl.slotMsg = "";
    ctrl.view = "slots";
    ctrl.sel = 0;
  }

  function leaveSlots() {
    ctrl.pendingSlot = -1;
    ctrl.pendingDelete = false;
    ctrl.slotMsg = "";
    ctrl.view = ctrl.slotsFrom || "mode";
    ctrl.sel = 0;
  }

  // Write the live campaign into slot i and bind future autosaves to it.
  // Returns true on a successful write.
  function doSaveSlot(i) {
    const snap = campaignSnapshot();
    if (!snap) return false;
    const rec = Save.saveSlot(i, snap);
    ctrl.slots = Save.listSlots();
    if (rec) {
      ctrl.activeSlot = i;
      ctrl.slotMsg = "SAVED TO SLOT " + (i + 1);
      return true;
    }
    ctrl.slotMsg = "COULD NOT SAVE (STORAGE BLOCKED)";
    return false;
  }

  // Restore slot i's campaign and jump to the right screen for its progress.
  function doLoadSlot(i) {
    const rec = Save.loadSlot(i);
    if (!rec || !rec.data) return;
    if (rec.kind === "road" && rec.data.road) {
      ctrl.roadConfed = rec.confed || rec.data.road.confed || "AFC";
      ctrl.eng = ROAD_ENGINES[ctrl.roadConfed] || AFC_ENGINE;
      ctrl.road = rec.data.road;
      ctrl.roadActive = true;
      ctrl.t = null;
      ctrl.roadTab = "me";
      ctrl.allScroll = 0;
      const st = ctrl.road.youStatus;
      ctrl.view = st === "qualified" ? "roadqualified" : st === "eliminated" ? "roadeliminated" : "road";
    } else if (rec.kind === "wc" && rec.data.t) {
      ctrl.t = rec.data.t;
      ctrl.roadActive = false;
      ctrl.road = null;
      ctrl.hubTab = "me";
      ctrl.allScroll = 0;
      const t = ctrl.t;
      ctrl.view = (t.stage === "done" || t.champion) ? "champion" : !t.youAlive ? "eliminated" : "hub";
    } else {
      return; // unknown payload — leave the menu alone
    }
    ctrl.activeSlot = i;
    ctrl.sel = 0;
    if (sfx.whistle) sfx.whistle();
  }

  function doDeleteSlot(i) {
    Save.deleteSlot(i);
    ctrl.slots = Save.listSlots();
    if (ctrl.activeSlot === i) ctrl.activeSlot = -1;
    ctrl.slotMsg = "DELETED SLOT " + (i + 1);
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------
  ctrl.onWheel = function (dir) {
    if (ctrl.view === "team") {
      const maxS = Math.max(0, gridRows() - GRID.vis);
      ctrl.gridScroll = clamp(ctrl.gridScroll + dir, 0, maxS);
    } else if (ctrl.view === "hub" && ctrl.hubTab === "all") {
      ctrl.allScroll = clamp(ctrl.allScroll + dir, 0, 40);
    } else if (ctrl.view === "road" && (ctrl.roadTab === "all" || ctrl.roadTab === "rank")) {
      ctrl.allScroll = clamp(ctrl.allScroll + dir, 0, 60);
    } else if (ctrl.view === "results" || ctrl.view === "roadresults") {
      ctrl.resScroll = clamp(ctrl.resScroll + dir, 0, 60);
    } else if (ctrl.view === "bracket") {
      ctrl.allScroll = clamp(ctrl.allScroll + dir, 0, 40);
    }
  };

  ctrl.update = function (input) {
    ctrl.mx = input.mx;
    ctrl.my = input.my;
    ctrl.mouseActive = input.mouseActive;
    if (ctrl.view === "team") {
      updateTeam(input);
      return;
    }
    if (ctrl.view === "slots") {
      updateSlots(input);
      return;
    }
    // Button-driven views.
    buildButtons();
    const b = ctrl.buttons;
    if (b.length) {
      // hover focuses, arrows move focus, enter / click activate.
      if (input.mouseActive && input.mouseMoved) {
        for (let i = 0; i < b.length; i++) if (inRect(b[i], input.mx, input.my)) ctrl.sel = i;
      }
      if (input.key("down") || input.key("right")) ctrl.sel = (ctrl.sel + 1) % b.length;
      if (input.key("up") || input.key("left")) ctrl.sel = (ctrl.sel + b.length - 1) % b.length;
      ctrl.sel = clamp(ctrl.sel, 0, b.length - 1);
      let fire = null;
      if (input.click) {
        for (const r of b) if (inRect(r, input.click.x, input.click.y)) fire = r;
      }
      if (!fire && input.key("start")) fire = b[ctrl.sel];
      if (fire && !fire.disabled) {
        if (sfx.pass) sfx.pass();
        fire.action();
        if (input.consume) input.consume(); // don't let this ENTER bleed into the next screen
        return;
      }
    }
    if (input.key("back")) handleBack();
  };

  function handleBack() {
    if (ctrl.view === "mode") {
      hooks.toTitle();
    } else if (ctrl.view === "roadconfed") {
      ctrl.view = "mode"; ctrl.sel = 1;
    } else if (ctrl.view === "hub") {
      if (ctrl.hubTab === "all" || ctrl.hubTab === "thirds") ctrl.hubTab = "me";
    } else if (ctrl.view === "road") {
      if (ctrl.roadTab !== "me") ctrl.roadTab = "me";
    } else if (ctrl.view === "bracket") {
      ctrl.view = ctrl.bracketFrom || "champion";
      ctrl.sel = 0;
    }
    // results / eliminated / champion ignore back (use the buttons).
  }

  // Build the focusable buttons for the current view (used by update + render).
  function buildButtons() {
    const b = [];
    const cx = VIEW_W / 2;
    if (ctrl.view === "mode") {
      b.push({ id: "quick", x: cx - 160, y: 104, w: 320, h: 42, label: "QUICK PLAY", scale: 3, subtitle: "ONE MATCH, ANY TWO TEAMS", action: () => hooks.quickPlay() });
      b.push({ id: "road", x: cx - 160, y: 150, w: 320, h: 42, label: "ROAD TO WC", scale: 3, primary: true, subtitle: "PICK A CONFEDERATION - PLAY 2026 QUALIFYING INTO THE CUP", action: enterRoadPick });
      b.push({ id: "wc", x: cx - 160, y: 196, w: 320, h: 42, label: "WORLD CUP", scale: 3, subtitle: "JUMP STRAIGHT INTO THE 48-TEAM TOURNAMENT", action: enterTeamPick });
      b.push({ id: "auto", x: cx - 160, y: 242, w: 320, h: 42, label: "AUTOPLAY", scale: 3, subtitle: "PICK 2 TEAMS, WATCH AI VS AI", action: () => hooks.autoPlay() });
      const saveCount = Save.listSlots().filter(Boolean).length;
      b.push({ id: "load", x: cx - 160, y: 288, w: 320, h: 42, label: "LOAD GAME", scale: 3, subtitle: saveCount ? "RESUME A SAVED RUN  -  " + saveCount + " OF " + Save.SLOTS + " SLOTS USED" : "NO SAVED CAMPAIGNS YET", action: () => enterSlots("load", "mode") });
    } else if (ctrl.view === "roadconfed") {
      const bw = 300, bh = 40, gx = 12, gy = 10, cols = 2;
      const x0 = cx - (cols * bw + gx) / 2;
      const y0 = 96;
      for (let i = 0; i < ROAD_CONFEDS.length; i++) {
        const c = ROAD_CONFEDS[i];
        const x = x0 + (i % cols) * (bw + gx);
        const y = y0 + ((i / cols) | 0) * (bh + gy);
        b.push({
          id: "cf" + c.key, x, y, w: bw, h: bh, scale: 2,
          label: c.name, subtitle: c.soon ? "COMING SOON" : c.key + "  -  2026 QUALIFYING",
          primary: !c.soon, disabled: c.soon,
          action: c.soon ? () => {} : () => enterRoadTeamPick(c.key),
        });
      }
      b.push({ id: "back", x: cx - 80, y: VIEW_H - 40, w: 160, h: 28, label: "BACK", scale: 2, action: () => { ctrl.view = "mode"; ctrl.sel = 1; } });
    } else if (ctrl.view === "road") {
      buildRoadButtons(b, cx);
    } else if (ctrl.view === "roadresults") {
      b.push({ id: "continue", x: cx - 130, y: VIEW_H - 38, w: 260, h: 30, label: "CONTINUE", scale: 2, primary: true, action: continueAfterRoadResults });
    } else if (ctrl.view === "roadqualified") {
      b.push({ id: "toWc", x: cx - 170, y: VIEW_H - 52, w: 340, h: 40, label: "ENTER THE WORLD CUP", scale: 3, primary: true, action: () => handoffToWorldCup(false) });
    } else if (ctrl.view === "roadeliminated") {
      b.push({ id: "watch", x: 70, y: VIEW_H - 52, w: 200, h: 40, label: "WATCH WORLD CUP", scale: 2, primary: true, action: () => handoffToWorldCup(true) });
      b.push({ id: "newroad", x: 278, y: VIEW_H - 52, w: 130, h: 40, label: "NEW ROAD", scale: 2, action: enterRoadPick });
      b.push({ id: "menu", x: 416, y: VIEW_H - 52, w: 154, h: 40, label: "MAIN MENU", scale: 2, action: () => { ctrl.road = null; ctrl.roadActive = false; ctrl.t = null; hooks.toTitle(); } });
    } else if (ctrl.view === "hub") {
      // tab toggles — 3 tabs during group stage, 2 during knockout
      if (ctrl.t.stage === "group") {
        const tw = 148, tg = 4, tx0 = cx - Math.round((3 * tw + 2 * tg) / 2);
        b.push({ id: "tabme",     x: tx0,              y: 32, w: tw, h: 18, label: "MY GROUP",   scale: 1, active: ctrl.hubTab === "me",     action: () => (ctrl.hubTab = "me") });
        b.push({ id: "taball",    x: tx0 + tw + tg,    y: 32, w: tw, h: 18, label: "ALL GROUPS", scale: 1, active: ctrl.hubTab === "all",    action: () => { ctrl.hubTab = "all";    ctrl.allScroll = 0; } });
        b.push({ id: "tabthirds", x: tx0 + 2*(tw+tg),  y: 32, w: tw, h: 18, label: "3RD PLACE",  scale: 1, active: ctrl.hubTab === "thirds", action: () => (ctrl.hubTab = "thirds") });
      } else {
        b.push({ id: "tabme",  x: cx - 162, y: 32, w: 158, h: 18, label: "MY TIE",  scale: 1, active: ctrl.hubTab === "me",  action: () => (ctrl.hubTab = "me") });
        b.push({ id: "taball", x: cx + 4,   y: 32, w: 158, h: 18, label: "BRACKET", scale: 1, active: ctrl.hubTab === "all", action: () => { ctrl.hubTab = "all"; ctrl.allScroll = 0; } });
      }
      if (canSaveNow()) b.push({ id: "save", x: 6, y: 32, w: 64, h: 18, label: "SAVE", scale: 1, action: () => enterSlots("save", "hub") });
      if (ctrl.hubTab === "me" && T.playerFixture(ctrl.t)) {
        b.push({ id: "play", x: cx - 265, y: 340, w: 255, h: 42, label: "PLAY MATCH", scale: 3, primary: true, action: startPlayerMatch });
        b.push({ id: "sim", x: cx + 10, y: 340, w: 255, h: 42, label: "SIM MATCH", scale: 2, subtitle: "AUTO-SIMULATE YOUR FIXTURE", action: simPlayerMatch });
      }
    } else if (ctrl.view === "results") {
      b.push({ id: "continue", x: cx - 130, y: VIEW_H - 40, w: 260, h: 30, label: "CONTINUE", scale: 2, primary: true, action: continueAfterResults });
    } else if (ctrl.view === "eliminated") {
      // 4 buttons in a row: 4×130 + 3×8 = 544px, start = (640-544)/2 = 48
      b.push({ id: "sim",     x: 48,  y: 250, w: 130, h: 38, label: "SIM TO END",   scale: 2, primary: true, action: () => { T.simToEnd(ctrl.t); ctrl.view = "champion"; ctrl.sel = 0; } });
      b.push({ id: "bracket", x: 186, y: 250, w: 130, h: 38, label: "VIEW BRACKET", scale: 2, action: () => { if (ctrl.t.stage !== "done") T.simToEnd(ctrl.t); ctrl.bracketFrom = "eliminated"; ctrl.allScroll = 0; ctrl.view = "bracket"; ctrl.sel = 0; } });
      b.push({ id: "new",     x: 324, y: 250, w: 130, h: 38, label: "NEW CUP",      scale: 2, action: enterTeamPick });
      b.push({ id: "menu",    x: 462, y: 250, w: 130, h: 38, label: "MAIN MENU",    scale: 2, action: () => { ctrl.t = null; hooks.toTitle(); } });
    } else if (ctrl.view === "champion") {
      // 3 buttons in a row: 3×130 + 2×10 = 410px, start = (640-410)/2 = 115
      b.push({ id: "new",     x: 115, y: VIEW_H - 56, w: 130, h: 38, label: "NEW CUP",      scale: 2, primary: true, action: enterTeamPick });
      b.push({ id: "bracket", x: 255, y: VIEW_H - 56, w: 130, h: 38, label: "VIEW BRACKET", scale: 2, action: () => { ctrl.bracketFrom = "champion"; ctrl.allScroll = 0; ctrl.view = "bracket"; ctrl.sel = 0; } });
      b.push({ id: "menu",    x: 395, y: VIEW_H - 56, w: 130, h: 38, label: "MAIN MENU",    scale: 2, action: () => { ctrl.t = null; hooks.toTitle(); } });
    } else if (ctrl.view === "bracket") {
      // 3 buttons at bottom: 3×110 + 2×10 = 350px, start = (640-350)/2 = 145
      b.push({ id: "back",    x: 145, y: VIEW_H - 40, w: 110, h: 30, label: "BACK",      scale: 2, primary: true, action: () => { ctrl.view = ctrl.bracketFrom || "champion"; ctrl.sel = 0; } });
      b.push({ id: "new",     x: 265, y: VIEW_H - 40, w: 110, h: 30, label: "NEW CUP",   scale: 2, action: enterTeamPick });
      b.push({ id: "menu",    x: 385, y: VIEW_H - 40, w: 110, h: 30, label: "MAIN MENU", scale: 2, action: () => { ctrl.t = null; hooks.toTitle(); } });
    }
    ctrl.buttons = b;
    if (ctrl.sel >= b.length) ctrl.sel = 0;
  }

  function enterTeamPick() {
    ctrl.pickMode = "wc";
    ctrl.view = "team";
    ctrl.gridCursor = 0;
    ctrl.gridScroll = 0;
    ctrl.searchQuery = "";
    ctrl.searchFocused = false;
    ctrl.pendingNonWC = null;
  }

  // The road starts with a confederation choice (each one is a different
  // qualification format); picking one opens that confederation's team grid.
  function enterRoadPick() {
    ctrl.view = "roadconfed";
    ctrl.sel = 0;
  }

  function enterRoadTeamPick(confed) {
    ctrl.roadConfed = confed;
    ctrl.eng = ROAD_ENGINES[confed] || AFC_ENGINE;
    ctrl.pickMode = "road";
    ctrl.view = "team";
    ctrl.gridCursor = 0;
    ctrl.gridScroll = 0;
    ctrl.searchQuery = "";
    ctrl.searchFocused = false;
    ctrl.pendingNonWC = null;
  }

  // ---- Team grid (4 cols, scrolling). WC pick: all nations, non-WC greyed.
  //      Road pick: that confederation's entrants only (hosts excluded where
  //      they auto-qualify, e.g. CONCACAF), strongest first. ----
  const GRID = { cols: 4, vis: 3, cw: 132, ch: 70, gx: 12, gy: 10, y0: 92 };
  GRID.x0 = Math.round((VIEW_W - (GRID.cols * GRID.cw + (GRID.cols - 1) * GRID.gx)) / 2);
  function getFilteredKeys() {
    let base;
    if (ctrl.pickMode === "road") {
      base = ctrl.eng && ctrl.eng.pickKeys ? ctrl.eng.pickKeys() : keysByConfed(ctrl.roadConfed);
      base = [...base].sort((a, b) => (NATIONS[a].fifaRank || 999) - (NATIONS[b].fifaRank || 999));
    } else {
      base = NATION_KEYS;
    }
    if (!ctrl.searchQuery) return base;
    const q = ctrl.searchQuery.toLowerCase();
    return base.filter(k =>
      k.toLowerCase().includes(q) || NATIONS[k].name.toLowerCase().includes(q)
    );
  }
  const gridRows = () => Math.ceil(getFilteredKeys().length / GRID.cols);
  function cellRect(i) {
    const col = i % GRID.cols;
    const row = ((i / GRID.cols) | 0) - ctrl.gridScroll;
    return {
      x: GRID.x0 + col * (GRID.cw + GRID.gx),
      y: GRID.y0 + row * (GRID.ch + GRID.gy),
      w: GRID.cw,
      h: GRID.ch,
      visible: row >= 0 && row < GRID.vis,
    };
  }
  function ensureVisible() {
    const fk = getFilteredKeys();
    const row = (ctrl.gridCursor / GRID.cols) | 0;
    if (row < ctrl.gridScroll) ctrl.gridScroll = row;
    else if (row >= ctrl.gridScroll + GRID.vis) ctrl.gridScroll = row - GRID.vis + 1;
    ctrl.gridScroll = clamp(ctrl.gridScroll, 0, Math.max(0, gridRows() - GRID.vis));
  }
  function gridHit(x, y) {
    const fk = getFilteredKeys();
    for (let i = 0; i < fk.length; i++) {
      const r = cellRect(i);
      if (r.visible && inRect(r, x, y)) return i;
    }
    return -1;
  }
  function updateTeam(input) {
    // Search bar click detection
    const sbX = GRID.x0, sbY = 78, sbW = GRID.cols * (GRID.cw + GRID.gx) - GRID.gx, sbH = 12;
    if (input.click && input.click.y >= sbY && input.click.y <= sbY + sbH &&
        input.click.x >= sbX && input.click.x <= sbX + sbW) {
      if (ctrl.searchQuery && input.click.x >= sbX + sbW - 14) {
        ctrl.searchQuery = "";
        ctrl.gridCursor = 0;
        ctrl.gridScroll = 0;
      }
      ctrl.searchFocused = true;
      input.click = null;
    } else if (input.click) {
      ctrl.searchFocused = false;
    }

    // Typed characters go to search when focused
    if (ctrl.searchFocused && input.pressed) {
      const prevLen = ctrl.searchQuery.length;
      for (const k of input.pressed) {
        if (k.length === 1 && ((k >= "a" && k <= "z") || (k >= "0" && k <= "9"))) {
          ctrl.searchQuery += k.toUpperCase();
          input.pressed.delete(k);
        }
      }
      if (input.pressed.has("backspace") && ctrl.searchQuery.length > 0) {
        ctrl.searchQuery = ctrl.searchQuery.slice(0, -1);
        input.pressed.delete("backspace");
      } else if (input.pressed.has("escape") && ctrl.searchQuery) {
        ctrl.searchQuery = "";
        input.pressed.delete("escape");
      }
      if (ctrl.searchQuery.length !== prevLen) {
        ctrl.gridCursor = 0;
        ctrl.gridScroll = 0;
      }
    }

    const filteredKeys = getFilteredKeys();
    const n = filteredKeys.length;
    let nav = false;
    if (input.key("right")) { ctrl.gridCursor = Math.min(n - 1, ctrl.gridCursor + 1); nav = true; }
    if (input.key("left")) { ctrl.gridCursor = Math.max(0, ctrl.gridCursor - 1); nav = true; }
    if (input.key("down")) { ctrl.gridCursor = Math.min(n - 1, ctrl.gridCursor + GRID.cols); nav = true; }
    if (input.key("up")) { ctrl.gridCursor = Math.max(0, ctrl.gridCursor - GRID.cols); nav = true; }
    if (input.mouseActive && input.mouseMoved) {
      const h = gridHit(input.mx, input.my);
      if (h >= 0) { ctrl.gridCursor = h; ctrl.searchFocused = false; }
    }
    if (nav) ensureVisible();
    if (input.key("back")) {
      if (ctrl.pendingNonWC) { ctrl.pendingNonWC = null; return; }
      if (ctrl.pickMode === "road") { ctrl.view = "roadconfed"; ctrl.sel = 0; return; }
      ctrl.view = "mode"; ctrl.sel = 2; return;
    }
    let confirm = input.key("start");
    if (input.click) {
      const h = gridHit(input.click.x, input.click.y);
      if (h >= 0) {
        ctrl.gridCursor = h;
        ctrl.searchFocused = false;
        confirm = true;
      }
    }
    const curKey = filteredKeys[ctrl.gridCursor];
    if (confirm && curKey) {
      if (ctrl.pickMode === "road") {
        // Road to the World Cup: any team in the chosen confederation starts qualification.
        if (sfx.whistle) sfx.whistle();
        startRoad(curKey);
        if (input.consume) input.consume();
      } else if (ctrl.pendingNonWC) {
        // Replace mode: pick which WC team to boot
        if (WC_SET.has(curKey)) {
          if (sfx.whistle) sfx.whistle();
          ctrl.t = T.createTournament(ctrl.pendingNonWC, { [curKey]: ctrl.pendingNonWC });
          ctrl.pendingNonWC = null;
          ctrl.hubTab = "me";
          ctrl.sel = 0;
          ctrl.activeSlot = -1; // a fresh cup is unsaved until you pick a slot
          ctrl.view = "hub";
          if (input.consume) input.consume();
        } else {
          ctrl.pendingNonWC = curKey; // swap to a different non-WC team
        }
      } else if (WC_SET.has(curKey)) {
        if (sfx.whistle) sfx.whistle();
        ctrl.t = T.createTournament(curKey);
        ctrl.hubTab = "me";
        ctrl.sel = 0;
        ctrl.activeSlot = -1; // a fresh cup is unsaved until you pick a slot
        ctrl.view = "hub";
        if (input.consume) input.consume();
      } else {
        ctrl.pendingNonWC = curKey; // enter replace mode
      }
    }
  }

  // ---- Save slots screen (shared by LOAD GAME and SAVE) ----
  const SLOT = { x: 80, w: 480, h: 74, gap: 8, y0: 74 };
  const slotRowRect = (i) => ({ x: SLOT.x, y: SLOT.y0 + i * (SLOT.h + SLOT.gap), w: SLOT.w, h: SLOT.h });
  const slotDelRect = (i) => { const r = slotRowRect(i); return { x: r.x + r.w - 24, y: r.y + 6, w: 16, h: 16 }; };
  const SLOT_BACK = { x: VIEW_W / 2 - 70, y: VIEW_H - 40, w: 140, h: 26 };

  function updateSlots(input) {
    const slots = ctrl.slots;
    if (input.key("down")) { ctrl.slotCursor = Math.min(Save.SLOTS - 1, ctrl.slotCursor + 1); ctrl.pendingSlot = -1; }
    if (input.key("up"))   { ctrl.slotCursor = Math.max(0, ctrl.slotCursor - 1); ctrl.pendingSlot = -1; }
    if (input.mouseActive && input.mouseMoved) {
      for (let i = 0; i < Save.SLOTS; i++) if (inRect(slotRowRect(i), input.mx, input.my)) ctrl.slotCursor = i;
    }
    if (input.key("back")) { leaveSlots(); return; }

    const click = input.click;
    if (click && inRect(SLOT_BACK, click.x, click.y)) { if (sfx.pass) sfx.pass(); leaveSlots(); return; }

    // Delete X on an occupied slot — two-click confirm.
    if (click) {
      for (let i = 0; i < Save.SLOTS; i++) {
        if (slots[i] && inRect(slotDelRect(i), click.x, click.y)) {
          if (ctrl.pendingSlot === i && ctrl.pendingDelete) {
            if (sfx.whistle) sfx.whistle();
            doDeleteSlot(i); ctrl.pendingSlot = -1; ctrl.pendingDelete = false;
          } else {
            ctrl.pendingSlot = i; ctrl.pendingDelete = true;
            ctrl.slotMsg = "DELETE SLOT " + (i + 1) + "?  CLICK X AGAIN";
          }
          if (input.consume) input.consume();
          return;
        }
      }
    }

    // Activate a slot (click a row, or ENTER on the focused one).
    let target = -1;
    if (click) for (let i = 0; i < Save.SLOTS; i++) if (inRect(slotRowRect(i), click.x, click.y)) target = i;
    if (target < 0 && input.key("start")) target = ctrl.slotCursor;
    if (target < 0) return;
    ctrl.slotCursor = target;

    if (ctrl.slotsMode === "load") {
      if (slots[target]) { if (sfx.pass) sfx.pass(); doLoadSlot(target); }
      else ctrl.slotMsg = "SLOT " + (target + 1) + " IS EMPTY";
    } else {
      const occupied = !!slots[target];
      const confirmed = !occupied || (ctrl.pendingSlot === target && !ctrl.pendingDelete);
      if (confirmed) {
        if (doSaveSlot(target)) { if (sfx.whistle) sfx.whistle(); leaveSlots(); }
      } else {
        ctrl.pendingSlot = target; ctrl.pendingDelete = false;
        ctrl.slotMsg = "OVERWRITE SLOT " + (target + 1) + "?  CLICK AGAIN";
      }
    }
    if (input.consume) input.consume();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  ctrl.render = function (ctx, blinkT) {
    dim(ctx, 0.78);
    if (ctrl.view === "mode") renderMode(ctx, blinkT);
    else if (ctrl.view === "roadconfed") renderRoadConfed(ctx, blinkT);
    else if (ctrl.view === "team") renderTeam(ctx, blinkT);
    else if (ctrl.view === "slots") renderSlots(ctx, blinkT);
    else if (ctrl.view === "hub") renderHub(ctx, blinkT);
    else if (ctrl.view === "results") renderResults(ctx, blinkT);
    else if (ctrl.view === "eliminated") renderEliminated(ctx, blinkT);
    else if (ctrl.view === "champion") renderChampion(ctx, blinkT);
    else if (ctrl.view === "bracket") renderBracketFull(ctx, blinkT);
    else if (ctrl.view === "road") renderRoad(ctx, blinkT);
    else if (ctrl.view === "roadresults") renderRoadResults(ctx, blinkT);
    else if (ctrl.view === "roadqualified") renderRoadQualified(ctx, blinkT);
    else if (ctrl.view === "roadeliminated") renderRoadEliminated(ctx, blinkT);
  };

  function drawButtons(ctx) {
    for (let i = 0; i < ctrl.buttons.length; i++) {
      const r = ctrl.buttons[i];
      if (r.disabled) {
        // greyed, non-interactive (e.g. a confederation that's not built yet)
        ctx.fillStyle = "rgba(14,18,28,0.85)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "#26304a"; ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        const s = r.scale || 1;
        const titleH = 5 * s;
        const groupH = r.subtitle ? titleH + 5 + 5 : titleH;
        const titleY = r.y + Math.round((r.h - groupH) / 2);
        drawTextCentered(ctx, r.label, r.x + r.w / 2, titleY, s, "#475172");
        if (r.subtitle) drawTextCentered(ctx, r.subtitle, r.x + r.w / 2, titleY + titleH + 5, 1, "#3a4566");
        continue;
      }
      const hover = i === ctrl.sel || (ctrl.mouseActive && inRect(r, ctrl.mx, ctrl.my));
      ctx.fillStyle = hover ? "rgba(255,230,107,0.18)" : r.active ? "rgba(255,230,107,0.10)" : r.primary ? "rgba(124,255,138,0.10)" : PANEL;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = hover ? ACC : r.active ? ACC : r.primary ? "#7bdc8a" : LINE;
      ctx.lineWidth = hover ? 2 : 1;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      const s = r.scale || 1;
      const col = hover ? ACC : r.active ? ACC : r.primary ? "#aaffb8" : TEXT;
      const titleH = 5 * s;
      const groupH = r.subtitle ? titleH + 5 + 5 : titleH;
      const titleY = r.y + Math.round((r.h - groupH) / 2);
      drawTextCentered(ctx, r.label, r.x + r.w / 2, titleY, s, col);
      if (r.subtitle) {
        drawTextCentered(ctx, r.subtitle, r.x + r.w / 2, titleY + titleH + 5, 1, hover ? MUTE : SUB);
      }
    }
  }

  function renderMode(ctx, blinkT) {
    drawTextCentered(ctx, "WORLD CUP JAM", VIEW_W / 2, 50, 6, ACC);
    drawTextCentered(ctx, "CHOOSE A MODE", VIEW_W / 2, 94, 2, TEXT);
    drawButtons(ctx);
    blink(blinkT, () => drawTextCentered(ctx, "CLICK A MODE  -  ARROWS + ENTER  -  ESC BACK", VIEW_W / 2, VIEW_H - 12, 1, MUTE));
  }

  // A small original confederation badge (a shield with the confed code) — drawn
  // top-left on every road screen so AFC vs CAF reads at a glance.
  const CONFED_TINT = { AFC: "#e2792b", CAF: "#1fae4f", CONMEBOL: "#2f7fd6", UEFA: "#3a4d8f", CONCACAF: "#c8443a", OFC: "#1f9fb0" };
  const CONFED_ABBR = { AFC: "AFC", CAF: "CAF", CONMEBOL: "CMB", UEFA: "UEFA", CONCACAF: "CCF", OFC: "OFC" };
  function drawConfedBadge(ctx, confed, cx, cy, scale = 1) {
    const tint = CONFED_TINT[confed] || ACC;
    const w = 16 * scale, h = 20 * scale;
    const x = cx - w / 2, y = cy - h / 2;
    // shield body
    ctx.fillStyle = "#0b1426";
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h * 0.55);
    ctx.lineTo(cx, y + h); ctx.lineTo(x, y + h * 0.55); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = tint; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = tint;
    ctx.fillRect(x + 1.5, y + 1.5, w - 3, 3 * scale); // top bar
    drawTextCentered(ctx, CONFED_ABBR[confed] || confed.slice(0, 4), cx, y + 6 * scale, 1, "#eaf0ff");
  }

  function renderRoadConfed(ctx, blinkT) {
    drawTextCentered(ctx, "ROAD TO THE WORLD CUP", VIEW_W / 2, 40, 3, ACC);
    drawTextCentered(ctx, "CHOOSE YOUR CONFEDERATION", VIEW_W / 2, 74, 1, TEXT);
    drawButtons(ctx);
    // badge next to each playable confederation button
    for (const r of ctrl.buttons) {
      if (!r.id || !r.id.startsWith("cf")) continue;
      const key = r.id.slice(2);
      if (CONFED_TINT[key]) drawConfedBadge(ctx, key, r.x + 18, r.y + r.h / 2, 1);
    }
    blink(blinkT, () => drawTextCentered(ctx, "ALL SIX CONFEDERATIONS PLAYABLE  -  EACH ITS REAL 2026 FORMAT  -  ESC BACK", VIEW_W / 2, VIEW_H - 12, 1, MUTE));
  }

  function renderSlots(ctx, blinkT) {
    const saving = ctrl.slotsMode === "save";
    drawTextCentered(ctx, saving ? "SAVE GAME" : "LOAD GAME", VIEW_W / 2, 24, 3, ACC);
    const sub = saving
      ? "PICK A SLOT FOR YOUR " + (ctrl.roadActive ? "ROAD RUN" : "WORLD CUP")
      : "PICK A SAVED CAMPAIGN TO RESUME";
    drawTextCentered(ctx, sub, VIEW_W / 2, 52, 1, MUTE);

    for (let i = 0; i < Save.SLOTS; i++) {
      const r = slotRowRect(i);
      const rec = ctrl.slots[i];
      const focused = i === ctrl.slotCursor;
      const armed = ctrl.pendingSlot === i;
      ctx.fillStyle = rec ? PANEL : "rgba(10,16,30,0.85)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = armed ? "#ff7b7b" : focused ? ACC : rec ? LINE : "#26314c";
      ctx.lineWidth = armed || focused ? 2 : 1;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);

      drawText(ctx, "SLOT " + (i + 1), r.x + 10, r.y + 8, 1, focused ? ACC : MUTE);
      if (ctrl.activeSlot === i) drawText(ctx, "ACTIVE", r.x + 10, r.y + r.h - 12, 1, GREEN);

      if (rec) {
        if (NATIONS[rec.youKey]) NATIONS[rec.youKey].drawFlag(ctx, rec.youKey, r.x + 10, r.y + 22, 44, 28);
        drawKit(ctx, rec.youKey, r.x + 84, r.y + r.h / 2 + 2, 2.2, "home");
        const nm = NATIONS[rec.youKey] ? NATIONS[rec.youKey].name : rec.youKey;
        drawText(ctx, nm, r.x + 116, r.y + 16, 2, focused ? ACC : TEXT);
        const tag = rec.kind === "road" ? "ROAD TO WC" : "WORLD CUP";
        drawText(ctx, tag, r.x + 116, r.y + 40, 1, rec.kind === "road" ? BLUE : SUB);
        drawText(ctx, rec.label || "", r.x + 116, r.y + 52, 1, MUTE);
        const tstr = Save.relTime(rec.ts);
        drawText(ctx, tstr, r.x + r.w - 8 - textWidth(tstr, 1), r.y + r.h - 12, 1, "#6a7aa0");
        const act = saving ? "OVERWRITE" : "LOAD";
        drawTextCentered(ctx, act, r.x + r.w - 64, r.y + r.h / 2 - 2, 1, focused ? ACC : SUB);
        // delete X
        const dx = slotDelRect(i);
        ctx.strokeStyle = armed && ctrl.pendingDelete ? "#ff7b7b" : "#6a7aa0";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(dx.x + 3, dx.y + 3); ctx.lineTo(dx.x + dx.w - 3, dx.y + dx.h - 3);
        ctx.moveTo(dx.x + dx.w - 3, dx.y + 3); ctx.lineTo(dx.x + 3, dx.y + dx.h - 3);
        ctx.stroke();
      } else {
        drawTextCentered(ctx, "EMPTY", r.x + r.w / 2, r.y + r.h / 2 - 8, 2, "#3a4566");
        drawTextCentered(ctx, saving ? "CLICK TO SAVE HERE" : "NO SAVE", r.x + r.w / 2, r.y + r.h / 2 + 8, 1, focused && saving ? ACC : "#3a4566");
      }
    }

    if (ctrl.slotMsg) {
      drawTextCentered(ctx, ctrl.slotMsg, VIEW_W / 2, SLOT.y0 + Save.SLOTS * (SLOT.h + SLOT.gap) + 2, 1, ACC);
    }

    const bk = SLOT_BACK;
    const bkHover = ctrl.mouseActive && inRect(bk, ctrl.mx, ctrl.my);
    ctx.fillStyle = bkHover ? "rgba(255,230,107,0.18)" : PANEL;
    ctx.fillRect(bk.x, bk.y, bk.w, bk.h);
    ctx.strokeStyle = bkHover ? ACC : LINE;
    ctx.lineWidth = bkHover ? 2 : 1;
    ctx.strokeRect(bk.x + 1, bk.y + 1, bk.w - 2, bk.h - 2);
    drawTextCentered(ctx, "BACK", bk.x + bk.w / 2, bk.y + Math.round((bk.h - 5) / 2), 1, bkHover ? ACC : TEXT);

    blink(blinkT, () => drawTextCentered(ctx,
      saving ? "CLICK A SLOT TO SAVE  -  X DELETES  -  ESC BACK" : "CLICK A SAVE TO LOAD  -  X DELETES  -  ESC BACK",
      VIEW_W / 2, VIEW_H - 12, 1, MUTE));
  }

  function renderTeam(ctx, blinkT) {
    const road = ctrl.pickMode === "road";
    drawTextCentered(ctx, road ? "ROAD TO THE WORLD CUP" : "WORLD CUP", VIEW_W / 2, 16, road ? 2 : 3, ACC);
    if (road) {
      drawConfedBadge(ctx, ctrl.roadConfed, 24, 18, 1);
      drawTextCentered(ctx, "PICK YOUR " + ctrl.eng.region + " NATION", VIEW_W / 2, 48, 2, TEXT);
      drawTextCentered(ctx, ctrl.eng.pickHeader, VIEW_W / 2, 70, 1, MUTE);
    } else if (ctrl.pendingNonWC) {
      drawTextCentered(ctx, "CHOOSE TEAM TO REPLACE", VIEW_W / 2, 48, 2, TEXT);
      const pn = NATIONS[ctrl.pendingNonWC];
      drawTextCentered(ctx, pn.name + " ENTERS AS A WILDCARD  —  CLICK A WC TEAM TO BOOT THEM OUT", VIEW_W / 2, 70, 1, ACC);
    } else {
      drawTextCentered(ctx, "PICK YOUR NATION", VIEW_W / 2, 48, 2, TEXT);
      drawTextCentered(ctx, "48 QUALIFIED TEAMS  -  GREYED = NOT IN WC 2026  -  CLICK GREY TO WILDCARD IN", VIEW_W / 2, 70, 1, MUTE);
    }

    // Search bar
    const sbX = GRID.x0, sbY = 78, sbW = GRID.cols * (GRID.cw + GRID.gx) - GRID.gx, sbH = 12;
    ctx.fillStyle = ctrl.searchFocused ? "rgba(15,28,54,0.97)" : "rgba(11,20,38,0.88)";
    ctx.fillRect(sbX, sbY, sbW, sbH);
    ctx.strokeStyle = ctrl.searchFocused ? ACC : LINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(sbX, sbY, sbW, sbH);
    ctx.strokeStyle = ctrl.searchFocused ? ACC : MUTE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sbX + 8, sbY + 6, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sbX + 10, sbY + 8);
    ctx.lineTo(sbX + 13, sbY + 11);
    ctx.stroke();
    const showCursor = ctrl.searchFocused && Math.floor(blinkT * 2) % 2 === 0;
    if (ctrl.searchQuery) {
      drawText(ctx, ctrl.searchQuery + (showCursor ? "_" : ""), sbX + 18, sbY + 3, 1, TEXT);
    } else {
      drawText(ctx, ctrl.searchFocused ? (showCursor ? "_" : "") : "SEARCH...", sbX + 18, sbY + 3, 1, ctrl.searchFocused ? TEXT : "#2a3a56");
    }
    if (ctrl.searchQuery) drawText(ctx, "X", sbX + sbW - 11, sbY + 3, 1, MUTE);

    const filteredKeys = getFilteredKeys();
    if (filteredKeys.length === 0) {
      drawTextCentered(ctx, "NO RESULTS", VIEW_W / 2, GRID.y0 + 28, 2, MUTE);
    }
    for (let i = 0; i < filteredKeys.length; i++) {
      const r = cellRect(i);
      if (!r.visible) continue;
      const key = filteredKeys[i];
      const qualified = road || WC_SET.has(key);
      const sel = i === ctrl.gridCursor;
      const isPending = key === ctrl.pendingNonWC;
      // In replace mode: non-WC cells are extra-dimmed (not targets); WC cells are targets
      const replaceMode = !!ctrl.pendingNonWC;
      ctx.fillStyle = qualified ? PANEL : "rgba(14,18,28,0.92)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = isPending ? ACC : sel ? (qualified ? ACC : "#666688") : (qualified ? LINE : "#28304a");
      ctx.lineWidth = (isPending || sel) ? 2 : 1;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.globalAlpha = qualified ? 1 : (replaceMode && !isPending ? 0.12 : 0.3);
      NATIONS[key].drawFlag(ctx, key, r.x + 12, r.y + 10, 40, 26);
      drawKit(ctx, key, r.x + r.w - 26, r.y + 23, 1.5);
      ctx.globalAlpha = 1;
      const nameCol = isPending ? ACC : sel ? (qualified ? ACC : "#888aaa") : (qualified ? TEXT : "#4a5070");
      drawTextCentered(ctx, NATIONS[key].name, r.x + r.w / 2, r.y + 44, 1, nameCol);
      if (isPending) {
        drawTextCentered(ctx, "YOUR PICK", r.x + r.w / 2, r.y + 56, 1, ACC);
      } else if (road) {
        drawTextCentered(ctx, "OVR " + NATIONS[key].ovr + "  -  RANK " + NATIONS[key].fifaRank, r.x + r.w / 2, r.y + 56, 1, ovrColor(NATIONS[key].ovr));
      } else if (qualified) {
        drawTextCentered(ctx, "OVR " + NATIONS[key].ovr, r.x + r.w / 2, r.y + 56, 1, ovrColor(NATIONS[key].ovr));
      } else {
        drawTextCentered(ctx, "NOT IN WC 2026", r.x + r.w / 2, r.y + 56, 1, "#3a3f55");
      }
    }
    // scrollbar
    const rows = gridRows();
    if (rows > GRID.vis) {
      const trackX = GRID.x0 + GRID.cols * (GRID.cw + GRID.gx) - GRID.gx + 5;
      const trackH = GRID.vis * (GRID.ch + GRID.gy) - GRID.gy;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(trackX, GRID.y0, 3, trackH);
      const thumbH = Math.max(12, (trackH * GRID.vis) / rows);
      const maxS = rows - GRID.vis;
      ctx.fillStyle = ACC;
      ctx.fillRect(trackX, GRID.y0 + (maxS ? (ctrl.gridScroll / maxS) * (trackH - thumbH) : 0), 3, thumbH);
    }
    const hint = ctrl.pickMode === "road"
      ? "CLICK YOUR ASIAN NATION  -  SCROLL TO SEE ALL  -  ESC BACK"
      : ctrl.pendingNonWC ? "CLICK A WC TEAM TO REPLACE  -  ESC CANCEL"
      : "CLICK ANY TEAM TO PICK  -  GREY TEAMS WILDCARD IN  -  SCROLL TO SEE ALL  -  ESC BACK";
    blink(blinkT, () => drawTextCentered(ctx, hint, VIEW_W / 2, VIEW_H - 12, 1, MUTE));
  }

  // ---- Hub ----
  function renderHub(ctx, blinkT) {
    const t = ctrl.t;
    buildButtons();
    if (ctrl.hubTab === "me") renderHubMe(ctx, blinkT);
    else if (ctrl.hubTab === "thirds") renderThirds(ctx, blinkT);
    else renderHubAll(ctx, blinkT);
    // top bar drawn last so scrolling content can't overdraw it
    ctx.fillStyle = "rgba(7,16,31,0.9)";
    ctx.fillRect(0, 0, VIEW_W, 26);
    drawText(ctx, "WORLD CUP", 8, 4, 1, MUTE);
    drawTextCentered(ctx, T.stageLabel(t), VIEW_W / 2, 4, 2, ACC);
    drawKit(ctx, t.youKey, VIEW_W - 90, 13, 1, "home");
    drawText(ctx, NATIONS[t.youKey].name, VIEW_W - 80, 4, 1, GREEN);
    drawButtons(ctx);
  }

  function renderHubMe(ctx, blinkT) {
    const t = ctrl.t;
    const f = T.playerFixture(t);
    if (t.stage === "group") {
      const g = T.groupOfTeam(t, t.youKey);
      drawTextCentered(ctx, "GROUP " + g.name, VIEW_W / 2, 60, 2, TEXT);
      drawGroupTable(ctx, g, VIEW_W / 2 - 230, 84, 460, t.youKey);
    } else {
      drawTextCentered(ctx, "YOUR ROUND", VIEW_W / 2, 60, 2, TEXT);
      drawRoadSoFar(ctx, 92);
    }
    // next match banner
    if (f) {
      const opp = f.a === t.youKey ? f.b : f.a;
      const by = 196;
      ctx.fillStyle = PANEL;
      ctx.fillRect(VIEW_W / 2 - 230, by, 460, 96);
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(VIEW_W / 2 - 230, by, 460, 96);
      drawTextCentered(ctx, "YOUR NEXT MATCH", VIEW_W / 2, by + 10, 1, MUTE);
      drawMatchup(ctx, t.youKey, opp, VIEW_W / 2, by + 50);
    } else {
      drawTextCentered(ctx, "NO FIXTURE THIS WEEK", VIEW_W / 2, 230, 2, MUTE);
    }
    blink(blinkT, () => drawTextCentered(ctx, "CLICK PLAY MATCH TO KICK OFF YOUR GAME", VIEW_W / 2, VIEW_H - 12, 1, MUTE));
  }

  // A vs B with kits + OVR, centred on (cx, y).
  function drawMatchup(ctx, aKey, bKey, cx, y) {
    drawKit(ctx, aKey, cx - 150, y, 2, "home");
    drawText(ctx, NATIONS[aKey].name, cx - 132, y - 6, 1, TEXT);
    drawText(ctx, "OVR " + NATIONS[aKey].ovr, cx - 132, y + 4, 1, ovrColor(NATIONS[aKey].ovr));
    drawTextCentered(ctx, "VS", cx, y - 4, 2, ACC);
    const bw = textWidth(NATIONS[bKey].name, 1);
    drawKit(ctx, bKey, cx + 150, y, 2, "home");
    drawText(ctx, NATIONS[bKey].name, cx + 132 - bw, y - 6, 1, TEXT);
    const ov = "OVR " + NATIONS[bKey].ovr;
    drawText(ctx, ov, cx + 132 - textWidth(ov, 1), y + 4, 1, ovrColor(NATIONS[bKey].ovr));
  }

  function drawRoadSoFar(ctx, y) {
    const t = ctrl.t;
    let line = "ROAD:  ";
    for (let i = 0; i < t.koRound; i++) {
      const r = t.ko.rounds[i];
      const tie = r.ties.find((x) => x && (x.a === t.youKey || x.b === t.youKey));
      if (!tie) continue;
      const opp = tie.a === t.youKey ? tie.b : tie.a;
      const ys = tie.a === t.youKey ? tie.sa : tie.sb;
      const os = tie.a === t.youKey ? tie.sb : tie.sa;
      line += r.short + " " + NATIONS[opp].abbr + " " + ys + "-" + os + "   ";
    }
    if (t.koRound > 0) drawTextCentered(ctx, line, VIEW_W / 2, y, 1, MUTE);
  }

  // Standings table for one group.
  function drawGroupTable(ctx, g, x, y, w, youKey) {
    const rows = T.sortedGroup(g);
    const qualThirds = ctrl.t && ctrl.t.stage === "group" ? T.bestThirdsKeys(ctrl.t) : new Set();
    const rt = (str, xr, yy, sc, col) => drawText(ctx, str, xr - textWidth(str, sc), yy, sc, col);
    const cP = x + w - 132, cW = x + w - 110, cD = x + w - 88, cL = x + w - 66, cGD = x + w - 36, cPTS = x + w - 8;
    drawText(ctx, "TEAM", x + 20, y, 1, "#5f7099");
    rt("P", cP, y, 1, "#5f7099");
    rt("W", cW, y, 1, "#5f7099");
    rt("D", cD, y, 1, "#5f7099");
    rt("L", cL, y, 1, "#5f7099");
    rt("GD", cGD, y, 1, "#5f7099");
    rt("PTS", cPTS, y, 1, "#5f7099");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ry = y + 14 + i * 18;
      const you = r.key === youKey;
      const qual = i < 2;
      if (you) {
        ctx.fillStyle = "rgba(124,255,138,0.14)";
        ctx.fillRect(x - 2, ry - 3, w + 4, 16);
      }
      // qualification bar (green = top 2, amber = 3rd currently in top-8 thirds, dark = out)
      const isQual3 = i === 2 && qualThirds.has(r.key);
      ctx.fillStyle = qual ? GREEN : isQual3 ? "#d2a24a" : "#445";
      ctx.fillRect(x - 2, ry - 3, 3, 16);
      drawKit(ctx, r.key, x + 10, ry + 3, 0.9, "home");
      drawText(ctx, NATIONS[r.key].abbr, x + 20, ry, 1, you ? GREEN : TEXT);
      drawText(ctx, NATIONS[r.key].name.length > 9 ? NATIONS[r.key].abbr : NATIONS[r.key].name, x + 46, ry, 1, you ? GREEN : TEXT);
      const col = you ? GREEN : TEXT;
      rt("" + r.pld, cP, ry, 1, col);
      rt("" + r.w, cW, ry, 1, col);
      rt("" + r.d, cD, ry, 1, col);
      rt("" + r.l, cL, ry, 1, col);
      rt((r.gd > 0 ? "+" : "") + r.gd, cGD, ry, 1, col);
      rt("" + r.pts, cPTS, ry, 1, you ? GREEN : ACC);
    }
    drawText(ctx, "TOP 2 ADVANCE - 3RD MAY ADVANCE", x, y + 14 + rows.length * 18 + 4, 1, "#6a7aa0");
  }

  function renderHubAll(ctx, blinkT) {
    if (ctrl.t.stage === "group") renderAllGroups(ctx);
    else renderBracket(ctx);
    blink(blinkT, () => drawTextCentered(ctx, "WHEEL TO SCROLL  -  CLICK MY GROUP TO GO BACK", VIEW_W / 2, VIEW_H - 12, 1, MUTE));
  }

  function renderAllGroups(ctx) {
    const t = ctrl.t;
    const qualThirds = T.bestThirdsKeys(t);
    const cols = 4;
    const bw = 150;
    const bh = 92;
    const gx = 8;
    const gy = 8;
    const x0 = Math.round((VIEW_W - (cols * bw + (cols - 1) * gx)) / 2);
    const y0 = 56 - ctrl.allScroll * 6;
    for (let gi = 0; gi < t.groups.length; gi++) {
      const g = t.groups[gi];
      const col = gi % cols;
      const row = (gi / cols) | 0;
      const x = x0 + col * (bw + gx);
      const y = y0 + row * (bh + gy);
      if (y + bh < 52 || y > VIEW_H - 20) continue;
      const yours = g === T.groupOfTeam(t, t.youKey);
      ctx.fillStyle = yours ? "rgba(18,42,30,0.92)" : PANEL;
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = yours ? GREEN : LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
      drawText(ctx, "GROUP " + g.name, x + 6, y + 5, 1, yours ? GREEN : ACC);
      const rows = T.sortedGroup(g);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const ry = y + 20 + i * 16;
        const you = r.key === t.youKey;
        const isQual3 = i === 2 && qualThirds.has(r.key);
        ctx.fillStyle = i < 2 ? GREEN : isQual3 ? "#d2a24a" : "#445";
        ctx.fillRect(x + 4, ry, 2, 11);
        drawText(ctx, NATIONS[r.key].abbr, x + 10, ry, 1, you ? GREEN : TEXT);
        drawText(ctx, r.pld + "GP", x + 40, ry, 1, "#6a7aa0");
        drawText(ctx, (r.gd > 0 ? "+" : "") + r.gd, x + bw - 44, ry, 1, "#9fb6e0");
        drawText(ctx, r.pts + "PT", x + bw - 22, ry, 1, (i < 2 || isQual3) ? ACC : MUTE);
      }
    }
  }

  function renderThirds(ctx, blinkT) {
    const t = ctrl.t;
    const thirds = [];
    for (const g of t.groups) {
      const rows = T.sortedGroup(g);
      if (rows[2]) thirds.push({ ...rows[2], grp: g.name });
    }
    thirds.sort((x, y) =>
      y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || NATIONS[y.key].ovr - NATIONS[x.key].ovr
    );

    drawTextCentered(ctx, "3RD PLACE STANDINGS", VIEW_W / 2, 56, 2, ACC);
    drawTextCentered(ctx, "TOP 8 QUALIFY FOR ROUND OF 32", VIEW_W / 2, 69, 1, MUTE);

    const x0 = 62;
    const rowW = VIEW_W - x0 * 2;
    const rY = (i) => 82 + i * 18;
    const rt = (s, xr, yy, sc, col) => drawText(ctx, s, xr - textWidth(s, sc), yy, sc, col);

    for (let i = 0; i < thirds.length; i++) {
      const r = thirds[i];
      const y = rY(i);
      const qualifying = i < 8;
      const bubble = i === 7;
      const you = r.key === t.youKey;

      if (you) {
        ctx.fillStyle = "rgba(124,255,138,0.14)";
        ctx.fillRect(x0 - 6, y - 2, rowW + 12, 15);
      }
      ctx.fillStyle = qualifying ? (bubble ? "#d2a24a" : GREEN) : "#334455";
      ctx.fillRect(x0 - 6, y - 2, 3, 15);

      const rc = qualifying ? (bubble ? "#d2a24a" : GREEN) : MUTE;
      rt("" + (i + 1), x0 + 10, y, 1, rc);

      drawKit(ctx, r.key, x0 + 20, y + 4, 0.9, "home");

      const tc = you ? GREEN : qualifying ? TEXT : "#4a5568";
      drawText(ctx, NATIONS[r.key].abbr, x0 + 32, y, 1, tc);
      drawText(ctx, "GP" + r.grp, x0 + 56, y, 1, "#5f7099");

      rt(r.pld + "P",  x0 + 148, y, 1, tc);
      rt(r.gf + "F",   x0 + 192, y, 1, tc);
      const gdStr = (r.gd > 0 ? "+" : "") + r.gd;
      rt(gdStr,         x0 + 240, y, 1, tc);
      rt(r.pts + "PT", x0 + 302, y, 1, qualifying ? (bubble ? "#d2a24a" : ACC) : MUTE);

      const badge = qualifying ? (bubble ? "8TH" : "ADVANCE") : "OUT";
      const bc = qualifying ? (bubble ? "#d2a24a" : GREEN) : "#445566";
      rt(badge, x0 + rowW, y, 1, bc);
    }

    if (thirds.length > 8) {
      const lineY = rY(8) - 4;
      ctx.save();
      ctx.strokeStyle = "#d2a24a";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x0 - 6, lineY);
      ctx.lineTo(x0 + rowW, lineY);
      ctx.stroke();
      ctx.restore();
    }
    blink(blinkT, () => drawTextCentered(ctx, "CLICK MY GROUP TO GO BACK", VIEW_W / 2, VIEW_H - 12, 1, MUTE));
  }

  function renderBracket(ctx) {
    const t = ctrl.t;
    const rounds = t.ko.rounds;
    const colW = 122;
    const x0 = 8;
    drawTextCentered(ctx, "KNOCKOUT BRACKET", VIEW_W / 2, 54, 1, MUTE);
    for (let ri = 0; ri < rounds.length; ri++) {
      const round = rounds[ri];
      const x = x0 + ri * (colW + 2);
      drawText(ctx, round.short, x + 4, 66, 1, ACC);
      const n = round.ties.length;
      const top = 80;
      const avail = VIEW_H - top - 24;
      const slot = avail / n;
      for (let i = 0; i < n; i++) {
        const tie = round.ties[i];
        const y = top + i * slot + (slot - 18) / 2 - ctrl.allScroll * 4;
        if (y < 74 || y > VIEW_H - 14) continue;
        drawTie(ctx, tie, x, y, colW, t.youKey);
      }
    }
  }

  function drawTie(ctx, tie, x, y, w, youKey) {
    ctx.fillStyle = "rgba(11,20,38,0.85)";
    ctx.fillRect(x, y, w, 17);
    const involvesYou = tie && (tie.a === youKey || tie.b === youKey);
    ctx.strokeStyle = involvesYou ? GREEN : "#1e3052";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 16);
    if (!tie) {
      drawText(ctx, "TBD", x + 4, y + 6, 1, "#445b7a");
      return;
    }
    const line = (key, sc, ry, score) => {
      const win = tie.winner === key;
      const col = key === youKey ? GREEN : win ? TEXT : "#8294b5";
      drawText(ctx, NATIONS[key].abbr, x + 4, ry, 1, col);
      if (score !== null && score !== undefined) drawText(ctx, "" + score, x + w - 8, ry, 1, col);
      if (win) drawText(ctx, ">", x + w - 16, ry, 1, ACC);
    };
    line(tie.a, 1, y + 2, tie.sa);
    line(tie.b, 1, y + 9, tie.sb);
    if (tie.pens) drawText(ctx, "P" + tie.pens[0] + tie.pens[1], x + w - 34, y + 6, 1, "#c0a24a");
  }

  // ---- Results ----
  function renderResults(ctx, blinkT) {
    const d = ctrl.resultsData;
    drawTextCentered(ctx, d.label, VIEW_W / 2, 14, 2, ACC);
    buildButtons();
    if (d.stage === "group") renderGroupResults(ctx, d);
    else renderKoResults(ctx, d);
    drawButtons(ctx);
    blink(blinkT, () => drawTextCentered(ctx, "CLICK CONTINUE FOR THE NEXT MATCHWEEK", VIEW_W / 2, VIEW_H - 52, 1, MUTE));
  }

  function renderGroupResults(ctx, d) {
    const t = ctrl.t;
    const yourG = d.groups.find((g) => g.yours);
    // your group + updated standings, left
    const lx = 30;
    drawText(ctx, "YOUR GROUP " + yourG.name, lx, 40, 1, GREEN);
    let yy = 56;
    for (const m of yourG.matches) {
      drawResultLine(ctx, lx, yy, m.a, m.sa, m.b, m.sb, t.youKey);
      yy += 14;
    }
    const g = T.groupOfTeam(t, t.youKey);
    drawGroupTable(ctx, g, lx, yy + 8, 300, t.youKey);
    // other groups, right (scrolling one line per group)
    const rx = 350;
    drawText(ctx, "AROUND THE GROUNDS", rx, 40, 1, MUTE);
    let ry = 56 - ctrl.resScroll * 6;
    for (const gr of d.groups) {
      if (gr.yours) continue;
      if (ry > 48 && ry < VIEW_H - 60) {
        drawText(ctx, "GP " + gr.name, rx, ry, 1, ACC);
        let mx = rx + 34;
        for (const m of gr.matches) {
          const s = NATIONS[m.a].abbr + " " + m.sa + "-" + m.sb + " " + NATIONS[m.b].abbr;
          drawText(ctx, s, mx, ry, 1, "#aeb9d6");
          mx += textWidth(s, 1) + 10;
        }
      }
      ry += 16;
    }
  }

  function renderKoResults(ctx, d) {
    drawText(ctx, d.ties.length + " TIES", 30, 40, 1, MUTE);
    const cols = 2;
    const colW = 280;
    const x0 = (VIEW_W - (cols * colW + 20)) / 2;
    const perCol = Math.ceil(d.ties.length / cols);
    for (let i = 0; i < d.ties.length; i++) {
      const tie = d.ties[i];
      const col = (i / perCol) | 0;
      const row = i % perCol;
      const x = x0 + col * (colW + 20);
      const y = 54 + row * 18 - ctrl.resScroll * 6;
      if (y < 48 || y > VIEW_H - 58) continue;
      const you = tie.a === ctrl.t.youKey || tie.b === ctrl.t.youKey;
      if (you) {
        ctx.fillStyle = "rgba(124,255,138,0.12)";
        ctx.fillRect(x - 4, y - 3, colW, 16);
      }
      drawKoResultLine(ctx, x, y, tie, ctrl.t.youKey);
    }
  }

  function drawResultLine(ctx, x, y, aKey, sa, bKey, sb, youKey) {
    const aw = sa > sb;
    const bw = sb > sa;
    drawText(ctx, NATIONS[aKey].abbr, x, y, 1, aKey === youKey ? GREEN : aw ? TEXT : "#8294b5");
    drawText(ctx, sa + "-" + sb, x + 34, y, 1, ACC);
    drawText(ctx, NATIONS[bKey].abbr, x + 64, y, 1, bKey === youKey ? GREEN : bw ? TEXT : "#8294b5");
  }

  function drawKoResultLine(ctx, x, y, tie, youKey) {
    const wA = tie.winner === tie.a;
    drawText(ctx, NATIONS[tie.a].abbr, x, y, 1, tie.a === youKey ? GREEN : wA ? TEXT : "#8294b5");
    let s = tie.sa + "-" + tie.sb;
    if (tie.pens) s += " P" + tie.pens[0] + "-" + tie.pens[1];
    drawText(ctx, s, x + 34, y, 1, ACC);
    drawText(ctx, NATIONS[tie.b].abbr, x + 34 + textWidth(s, 1) + 10, y, 1, tie.b === youKey ? GREEN : !wA ? TEXT : "#8294b5");
  }

  // ---- Eliminated ----
  function renderEliminated(ctx, blinkT) {
    const t = ctrl.t;
    drawTextCentered(ctx, "ELIMINATED", VIEW_W / 2, 90, 6, "#ff7b7b");
    drawKit(ctx, t.youKey, VIEW_W / 2, 160, 4, "home");
    drawTextCentered(ctx, NATIONS[t.youKey].name + " ARE OUT", VIEW_W / 2, 190, 2, TEXT);
    drawTextCentered(ctx, "YOU WENT OUT IN THE " + (t.youOut || "GROUP STAGE"), VIEW_W / 2, 218, 1, MUTE);
    buildButtons();
    drawButtons(ctx);
    blink(blinkT, () => drawTextCentered(ctx, "SIM THE REST TO SEE WHO LIFTS THE CUP", VIEW_W / 2, VIEW_H - 16, 1, MUTE));
  }

  // ---- Champion ----
  function renderChampion(ctx, blinkT) {
    const t = ctrl.t;
    const champ = t.champion;
    const youWon = champ === t.youKey;
    if (youWon) {
      const flash = Math.floor(blinkT * 6) % 2 === 0;
      drawTextCentered(ctx, "WORLD CHAMPIONS!", VIEW_W / 2, 70, 5, flash ? ACC : "#ff7b7b");
    } else {
      drawTextCentered(ctx, "WORLD CUP WINNERS", VIEW_W / 2, 70, 4, ACC);
    }
    drawKit(ctx, champ, VIEW_W / 2, 150, 5, "home");
    NATIONS[champ].drawFlag(ctx, champ, VIEW_W / 2 - 30, 176, 60, 38);
    drawTextCentered(ctx, NATIONS[champ].name, VIEW_W / 2, 224, 3, youWon ? GREEN : TEXT);
    if (!youWon) {
      drawTextCentered(ctx, "YOU (" + NATIONS[t.youKey].name + ") WENT OUT IN THE " + (t.youOut || "FINAL"), VIEW_W / 2, 256, 1, MUTE);
    } else {
      drawTextCentered(ctx, "YOU WON THE WHOLE THING", VIEW_W / 2, 256, 2, GREEN);
    }
    buildButtons();
    drawButtons(ctx);
  }

  // ---- Full bracket view (opened from eliminated or champion) ----
  function renderBracketFull(ctx, blinkT) {
    const t = ctrl.t;
    const rounds = t.ko.rounds;
    const colW = 122;
    const x0 = 8;
    drawTextCentered(ctx, "FINAL BRACKET", VIEW_W / 2, 32, 2, ACC);
    const champ = t.champion;
    if (champ) {
      drawKit(ctx, champ, VIEW_W / 2 - 40, 46, 1, "home");
      drawTextCentered(ctx, NATIONS[champ].name + " - WORLD CHAMPIONS", VIEW_W / 2, 46, 1, champ === t.youKey ? GREEN : TEXT);
    }
    for (let ri = 0; ri < rounds.length; ri++) {
      const round = rounds[ri];
      const x = x0 + ri * (colW + 2);
      drawText(ctx, round.short, x + 4, 64, 1, ACC);
      const n = round.ties.length;
      const top = 76;
      const avail = VIEW_H - top - 52;
      const slot = avail / n;
      for (let i = 0; i < n; i++) {
        const tie = round.ties[i];
        const y = top + i * slot + (slot - 18) / 2 - ctrl.allScroll * 4;
        if (y < 70 || y > VIEW_H - 52) continue;
        drawTie(ctx, tie, x, y, colW, t.youKey);
      }
    }
    ctx.fillStyle = "rgba(7,16,31,0.92)";
    ctx.fillRect(0, VIEW_H - 46, VIEW_W, 46);
    buildButtons();
    drawButtons(ctx);
    blink(blinkT, () => drawTextCentered(ctx, "WHEEL TO SCROLL  -  ESC BACK", VIEW_W / 2, VIEW_H - 52, 1, MUTE));
  }

  // =========================================================================
  // Road to the World Cup — rendering
  // =========================================================================

  // Advancement band for a finishing position in a road group, by round kind.
  // Full standings table for one road group; advancement bands come from the
  // engine's bandFor(rowKey, idx, size) → { status:"good"|"next"|"out", badge }.
  // rowH shrinks for big single-league tables (CONMEBOL's 10) so it still fits.
  function drawRoadGroupTable(ctx, g, x, y, w, youKey, bandFor, footer, rowH = 16) {
    const rows = ctrl.eng.sortedGroup(g);
    const rt = (s, xr, yy, sc, col) => drawText(ctx, s, xr - textWidth(s, sc), yy, sc, col);
    const cP = x + w - 188, cW = x + w - 168, cD = x + w - 148, cL = x + w - 128, cGD = x + w - 96, cPTS = x + w - 64;
    drawText(ctx, "TEAM", x + 20, y, 1, "#5f7099");
    rt("P", cP, y, 1, "#5f7099"); rt("W", cW, y, 1, "#5f7099"); rt("D", cD, y, 1, "#5f7099");
    rt("L", cL, y, 1, "#5f7099"); rt("GD", cGD, y, 1, "#5f7099"); rt("PTS", cPTS, y, 1, "#5f7099");
    drawText(ctx, "STATUS", x + w - 30, y, 1, "#5f7099");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ry = y + 14 + i * rowH;
      const you = r.key === youKey;
      const band = bandFor(r.key, i, rows.length);
      const bc = statusColor(band.status);
      if (you) { ctx.fillStyle = "rgba(124,255,138,0.12)"; ctx.fillRect(x - 2, ry - 3, w + 4, rowH - 1); }
      ctx.fillStyle = bc; ctx.fillRect(x - 2, ry - 3, 3, rowH - 1);
      drawKit(ctx, r.key, x + 10, ry + 3, 0.9, "home");
      const nm = NATIONS[r.key];
      drawText(ctx, nm.abbr, x + 20, ry, 1, you ? GREEN : TEXT);
      drawText(ctx, nm.name.length > 10 ? nm.abbr : nm.name, x + 46, ry, 1, you ? GREEN : TEXT);
      const col = you ? GREEN : TEXT;
      rt("" + r.pld, cP, ry, 1, col); rt("" + r.w, cW, ry, 1, col); rt("" + r.d, cD, ry, 1, col);
      rt("" + r.l, cL, ry, 1, col); rt((r.gd > 0 ? "+" : "") + r.gd, cGD, ry, 1, col);
      rt("" + r.pts, cPTS, ry, 1, you ? GREEN : ACC);
      rt(band.badge, x + w - 2, ry, 1, band.status === "out" ? MUTE : bc);
    }
    const fy = y + 14 + rows.length * rowH + 4;
    drawText(ctx, footer || "", x, fy, 1, "#6a7aa0");
    return fy;
  }

  // Compact group box for the overview tab.
  function drawRoadMiniGroup(ctx, g, x, y, bw, bh, youKey, bandFor) {
    const yours = g.teams.includes(youKey);
    ctx.fillStyle = yours ? "rgba(18,42,30,0.92)" : PANEL;
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = yours ? GREEN : LINE; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    drawText(ctx, "GROUP " + g.name, x + 6, y + 5, 1, yours ? GREEN : ACC);
    const rows = ctrl.eng.sortedGroup(g);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ry = y + 18 + i * 13;
      const you = r.key === youKey;
      const band = bandFor(r.key, i, rows.length);
      ctx.fillStyle = statusColor(band.status); ctx.fillRect(x + 4, ry, 2, 9);
      drawText(ctx, NATIONS[r.key].abbr, x + 10, ry, 1, you ? GREEN : TEXT);
      drawText(ctx, r.pld + "P", x + bw - 52, ry, 1, "#6a7aa0");
      drawText(ctx, (r.gd > 0 ? "+" : "") + r.gd, x + bw - 34, ry, 1, "#9fb6e0");
      drawText(ctx, r.pts + "", x + bw - 12, ry, 1, band.status === "out" ? MUTE : ACC);
    }
  }

  // A two-legged tie row (aggregate + winner).
  function drawRoadTie(ctx, tie, x, y, w, youKey) {
    const inv = tie.a === youKey || tie.b === youKey;
    ctx.fillStyle = inv ? "rgba(18,42,30,0.85)" : "rgba(11,20,38,0.85)";
    ctx.fillRect(x, y, w, 26);
    ctx.strokeStyle = inv ? GREEN : "#1e3052"; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 25);
    const l1 = tie.legs && tie.legs[0], l2 = tie.legs && tie.legs[1];
    const line = (key, agg, won, ry) => {
      const col = key === youKey ? GREEN : won ? TEXT : "#8294b5";
      drawKit(ctx, key, x + 10, ry + 4, 0.8, "home");
      drawText(ctx, NATIONS[key].abbr, x + 20, ry, 1, col);
      drawText(ctx, "" + agg, x + w - 12, ry, 1, won ? ACC : col);
      if (won) drawText(ctx, ">", x + w - 22, ry, 1, ACC);
    };
    line(tie.a, tie.agg ? tie.agg[0] : 0, tie.winner === tie.a, y + 4);
    line(tie.b, tie.agg ? tie.agg[1] : 0, tie.winner === tie.b, y + 15);
    let legStr = "";
    if (l1) legStr += "L1 " + l1.sa + "-" + l1.sb + "  ";
    if (l2) legStr += "L2 " + l2.sa + "-" + l2.sb;
    if (legStr) drawText(ctx, legStr, x + w / 2 - textWidth(legStr, 1) / 2, y + 9, 1, "#7e8fb3");
    if (tie.pens) drawText(ctx, "PENS " + tie.pens[0] + "-" + tie.pens[1], x + w / 2 - 24, y + 18, 1, "#c0a24a");
  }

  // A single-match box (a, b, score, winner) — used by the ICP path and the CAF
  // runner-up play-off bracket. Handles TBD (null) sides.
  function drawMatchBox(ctx, label, aKey, bKey, m, x, y, w, youKey) {
    const yours = aKey === youKey || bKey === youKey;
    ctx.fillStyle = yours ? "rgba(18,42,30,0.9)" : PANEL;
    ctx.fillRect(x, y, w, 40);
    ctx.strokeStyle = yours ? GREEN : LINE; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 39);
    drawText(ctx, label, x + 6, y + 4, 1, ACC);
    const row = (key, score, won, ry) => {
      if (!key) { drawText(ctx, "TBD", x + 22, ry, 1, "#445b7a"); return; }
      const col = key === youKey ? GREEN : won ? TEXT : "#8294b5";
      drawKit(ctx, key, x + 12, ry + 4, 0.8, "home");
      drawText(ctx, NATIONS[key].name, x + 22, ry, 1, col);
      if (score !== null && score !== undefined) drawText(ctx, "" + score, x + w - 12, ry, 1, won ? ACC : col);
      if (won) drawText(ctx, ">", x + w - 22, ry, 1, ACC);
    };
    row(aKey, m ? m.sa : null, m && m.winner === aKey, y + 14);
    row(bKey, m ? m.sb : null, m && m.winner === bKey, y + 26);
    if (m && m.pens) drawText(ctx, "P" + m.pens[0] + "-" + m.pens[1], x + w - 52, y + 20, 1, "#c0a24a");
  }

  // The inter-confederation play-off path (seed → final vs play-in winner).
  function drawIcpPath(ctx, icp, cx, y) {
    drawMatchBox(ctx, "PLAY-IN", icp.semi.a, icp.semi.b, icp.semi, cx - 150, y, 300, null);
    const finalA = icp.afcKey;
    const finalB = icp.final ? (icp.final.a === icp.afcKey ? icp.final.b : icp.final.a) : (icp.semi.winner || null);
    drawMatchBox(ctx, "PATH FINAL  -  WIN TO QUALIFY", finalA, finalB, icp.final, cx - 150, y + 52, 300, ctrl.road.youKey);
  }

  // A 4-team play-off bracket (2 semis → final) — the CAF runner-up play-off.
  function drawMatchBracket(ctx, bracket, cx, y, youKey) {
    const s0 = bracket.semis[0], s1 = bracket.semis[1], fin = bracket.final;
    drawMatchBox(ctx, "SEMI-FINAL", s0.a, s0.b, s0, cx - 296, y, 280, youKey);
    drawMatchBox(ctx, "SEMI-FINAL", s1.a, s1.b, s1, cx + 16, y, 280, youKey);
    const fa = fin ? fin.a : (s0.winner || null);
    const fb = fin ? fin.b : (s1.winner || null);
    drawMatchBox(ctx, bracket.finalLabel || "FINAL", fa, fb, fin, cx - 150, y + 54, 300, youKey);
  }

  function renderRoad(ctx, blinkT) {
    const q = ctrl.road;
    buildButtons();
    if (ctrl.roadTab === "me") renderRoadMe(ctx, blinkT);
    else if (ctrl.roadTab === "rank") renderRoadRank(ctx, blinkT);
    else renderRoadAll(ctx, blinkT);
    // top bar with the confederation badge
    ctx.fillStyle = "rgba(7,16,31,0.9)"; ctx.fillRect(0, 0, VIEW_W, 26);
    drawConfedBadge(ctx, ctrl.roadConfed, 18, 13, 1);
    drawText(ctx, "ROAD TO WC", 30, 4, 1, MUTE);
    drawTextCentered(ctx, aEng().stageLabel(aObj()), VIEW_W / 2, 4, 2, ACC);
    drawKit(ctx, q.youKey, VIEW_W - 90, 13, 1, "home");
    drawText(ctx, NATIONS[q.youKey].name, VIEW_W - 80, 4, 1, GREEN);
    drawButtons(ctx);
    const hint = ctrl.roadTab === "me"
      ? "PLAY YOUR MATCH OR SIM IT  -  TAB FOR THE FULL ROUND"
      : "WHEEL TO SCROLL  -  CLICK MY ROAD TO GO BACK";
    blink(blinkT, () => drawTextCentered(ctx, hint, VIEW_W / 2, VIEW_H - 8, 1, MUTE));
  }

  function renderRoadMe(ctx, blinkT) {
    const q = ctrl.road;
    const v = aEng().roadView(aObj());
    const f = aEng().playerFixture(aObj());
    if (v.kind === "groups") {
      if (v.myGroup) {
        const league = v.myGroup.teams.length > 6;
        drawTextCentered(ctx, league ? v.overviewTitle : "GROUP " + v.myGroup.name, VIEW_W / 2, 54, 2, TEXT);
        const fy = drawRoadGroupTable(ctx, v.myGroup, VIEW_W / 2 - 250, league ? 70 : 76, 500, q.youKey, v.bandFor, v.footer, league ? 14 : 16);
        drawNextOrRest(ctx, f, fy + (league ? 8 : 14));
      }
    } else if (v.kind === "ties") {
      drawTextCentered(ctx, v.tiesTitle, VIEW_W / 2, 56, 2, TEXT);
      if (v.myTie) drawRoadTie(ctx, v.myTie, VIEW_W / 2 - 200, 78, 400, q.youKey);
      drawTextCentered(ctx, v.tiesFooter || "", VIEW_W / 2, 112, 1, "#6a7aa0");
      drawNextOrRest(ctx, f, 132);
    } else if (v.kind === "bracket") {
      drawTextCentered(ctx, v.bracketTitle || "PLAY-OFF", VIEW_W / 2, 54, 2, TEXT);
      drawMatchBracket(ctx, v.bracket, VIEW_W / 2, 74, q.youKey);
      drawNextOrRest(ctx, f, 190);
    } else if (v.kind === "icp") {
      drawTextCentered(ctx, "INTER-CONFEDERATION PLAY-OFF", VIEW_W / 2, 50, 2, TEXT);
      drawTextCentered(ctx, "SIX CONFEDERATION REPS  -  TWO WORLD CUP PLACES", VIEW_W / 2, 66, 1, MUTE);
      drawIcpTournament(ctx, v.icp, VIEW_W / 2, 78, q.youKey);
      if (f) drawTextCentered(ctx, "YOUR NEXT MATCH  -  " + NATIONS[f.youKey].abbr + " VS " + NATIONS[f.oppKey].abbr, VIEW_W / 2, VIEW_H - 30, 1, ACC);
    }
  }

  // The "next match" banner, or a rest-day note when the human has no fixture.
  function drawNextOrRest(ctx, f, by) {
    const w = 460, x = VIEW_W / 2 - w / 2;
    ctx.fillStyle = PANEL; ctx.fillRect(x, by, w, 86);
    ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.strokeRect(x, by, w, 86);
    if (f) {
      drawTextCentered(ctx, "YOUR NEXT MATCH  -  " + f.label, VIEW_W / 2, by + 8, 1, MUTE);
      drawMatchup(ctx, f.a, f.b, VIEW_W / 2, by + 46);
    } else {
      drawTextCentered(ctx, "NO MATCH FOR YOU THIS WEEK", VIEW_W / 2, by + 24, 2, MUTE);
      drawTextCentered(ctx, "YOUR GROUP RESTS / THE PLAY-IN IS CONTESTED  -  PRESS CONTINUE", VIEW_W / 2, by + 52, 1, "#6a7aa0");
    }
  }

  function renderRoadAll(ctx, blinkT) {
    const q = ctrl.road;
    const v = aEng().roadView(aObj());
    if (v.kind === "groups" && v.groups.length === 1) {
      // A single big league (CONMEBOL): the overview IS the full standings table.
      drawTextCentered(ctx, v.overviewTitle, VIEW_W / 2, 50, 1, MUTE);
      drawTextCentered(ctx, "GREEN = QUALIFY   BLUE = PLAY-OFF   GREY = OUT", VIEW_W / 2, 61, 1, "#6a7aa0");
      drawRoadGroupTable(ctx, v.groups[0], VIEW_W / 2 - 250, 78, 500, q.youKey, v.bandFor, v.footer, 16);
    } else if (v.kind === "groups") {
      drawTextCentered(ctx, v.overviewTitle, VIEW_W / 2, 50, 1, MUTE);
      drawTextCentered(ctx, "GREEN = QUALIFY / ADVANCE   BLUE = NEXT ROUND   GREY = OUT", VIEW_W / 2, 61, 1, "#6a7aa0");
      const groups = v.groups, n = groups.length, size = groups[0].teams.length;
      const cols = n >= 3 ? 3 : Math.max(1, n);
      const bw = cols === 3 ? (size >= 6 ? 200 : 196) : 220;
      const bh = 18 + size * 13 + 5;
      const gx = 8, gy = 8;
      const x0 = Math.round((VIEW_W - (cols * bw + (cols - 1) * gx)) / 2);
      for (let gi = 0; gi < n; gi++) {
        const x = x0 + (gi % cols) * (bw + gx);
        const y = 72 + ((gi / cols) | 0) * (bh + gy) - ctrl.allScroll * 6;
        if (y + bh < 66 || y > VIEW_H - 10) continue;
        drawRoadMiniGroup(ctx, groups[gi], x, y, bw, bh, q.youKey, v.bandFor);
      }
    } else if (v.kind === "ties") {
      drawTextCentered(ctx, v.overviewTitle, VIEW_W / 2, 56, 1, MUTE);
      const ties = v.ties, cols = 2, cw = 300;
      const x0 = (VIEW_W - (cols * cw + 16)) / 2;
      const per = Math.ceil(ties.length / cols);
      for (let i = 0; i < ties.length; i++) {
        const c = (i / per) | 0, r = i % per;
        const x = x0 + c * (cw + 16), y = 70 + r * 30 - ctrl.allScroll * 6;
        if (y < 56 || y > VIEW_H - 30) continue;
        drawRoadTie(ctx, ties[i], x, y, cw, q.youKey);
      }
    } else if (v.kind === "bracket") {
      drawTextCentered(ctx, v.bracketTitle || "PLAY-OFF", VIEW_W / 2, 56, 1, MUTE);
      drawMatchBracket(ctx, v.bracket, VIEW_W / 2, 80, q.youKey);
    } else if (v.kind === "icp") {
      drawTextCentered(ctx, "INTER-CONFEDERATION PLAY-OFF  -  6 REPS, 2 PLACES", VIEW_W / 2, 52, 1, MUTE);
      drawIcpTournament(ctx, v.icp, VIEW_W / 2, 64, q.youKey);
    }
  }

  // Both inter-confederation play-off paths (the human's path highlighted).
  function drawIcpTournament(ctx, icp, cx, y, youKey) {
    for (let i = 0; i < icp.paths.length; i++) {
      const p = icp.paths[i];
      const py = y + i * 90;
      const mine = i === icp.youPathIdx;
      drawTextCentered(ctx, "PATH " + (i + 1) + (mine ? "  -  YOUR PATH" : ""), cx, py, 1, mine ? GREEN : MUTE);
      drawMatchBox(ctx, "PLAY-IN", p.semi.a, p.semi.b, p.semi, cx - 150, py + 10, 300, youKey);
      const fb = p.final ? (p.final.a === p.seed ? p.final.b : p.final.a) : (p.semi.winner || null);
      drawMatchBox(ctx, "FINAL  -  WINNER QUALIFIES", p.seed, fb, p.final, cx - 150, py + 50, 300, youKey);
    }
  }

  // Cross-group ranking tab (e.g. CAF runners-up): a full ranked standings list
  // with the advancement cutoff line. Driven by eng.roadRankTab(q).
  function renderRoadRank(ctx, blinkT) {
    const rt = ctrl.eng.roadRankTab(ctrl.road);
    if (!rt) { ctrl.roadTab = "me"; return; }
    drawTextCentered(ctx, rt.title, VIEW_W / 2, 56, 2, TEXT);
    drawTextCentered(ctx, rt.subtitle, VIEW_W / 2, 72, 1, MUTE);
    const x0 = 62, rowW = VIEW_W - x0 * 2;
    const rY = (i) => 92 + i * 17 - ctrl.allScroll * 6;
    const rt2 = (s, xr, yy, sc, col) => drawText(ctx, s, xr - textWidth(s, sc), yy, sc, col);
    for (let i = 0; i < rt.rows.length; i++) {
      const r = rt.rows[i];
      const y = rY(i);
      if (y < 86 || y > VIEW_H - 18) continue;
      const you = r.key === ctrl.road.youKey;
      const good = r.status === "good";
      const col = statusColor(r.status);
      if (you) { ctx.fillStyle = "rgba(124,255,138,0.14)"; ctx.fillRect(x0 - 6, y - 2, rowW + 12, 15); }
      ctx.fillStyle = col; ctx.fillRect(x0 - 6, y - 2, 3, 15);
      rt2("" + (i + 1), x0 + 10, y, 1, good ? col : MUTE);
      drawKit(ctx, r.key, x0 + 20, y + 4, 0.9, "home");
      const tc = you ? GREEN : good ? TEXT : "#586481";
      drawText(ctx, NATIONS[r.key].abbr, x0 + 32, y, 1, tc);
      drawText(ctx, "GP" + r.grp, x0 + 58, y, 1, "#5f7099");
      rt2(r.pld + "P", x0 + 150, y, 1, tc);
      rt2(r.gf + "F", x0 + 196, y, 1, tc);
      rt2((r.gd > 0 ? "+" : "") + r.gd, x0 + 244, y, 1, tc);
      rt2(r.pts + "PT", x0 + 306, y, 1, good ? ACC : MUTE);
      rt2(r.badge, x0 + rowW, y, 1, good ? col : "#586481");
    }
    // cutoff line below the qualifying rows
    if (rt.cutoff && rt.cutoff < rt.rows.length) {
      const ly = rY(rt.cutoff) - 4;
      if (ly > 86 && ly < VIEW_H - 12) {
        ctx.save(); ctx.strokeStyle = BLUE; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x0 - 6, ly); ctx.lineTo(x0 + rowW, ly); ctx.stroke(); ctx.restore();
      }
    }
    blink(blinkT, () => drawTextCentered(ctx, "CLICK MY ROAD TO GO BACK", VIEW_W / 2, VIEW_H - 8, 1, MUTE));
  }

  function renderRoadResults(ctx, blinkT) {
    const d = ctrl.roadResultsData;
    buildButtons();
    drawTextCentered(ctx, d.label + " RESULTS", VIEW_W / 2, 14, 2, ACC);
    if (d.kind === "groups") {
      const yourG = d.groups.find((g) => g.yours);
      const lx = 30;
      if (yourG) {
        drawText(ctx, "YOUR GROUP " + yourG.name, lx, 38, 1, GREEN);
        let yy = 54;
        for (const m of yourG.matches) { drawResultLine(ctx, lx, yy, m.a, m.sa, m.b, m.sb, ctrl.road.youKey); yy += 14; }
      }
      const rx = 320;
      drawText(ctx, "AROUND THE GROUPS", rx, 38, 1, MUTE);
      let ry = 54 - ctrl.resScroll * 6;
      for (const gr of d.groups) {
        if (gr.yours) continue;
        if (ry > 46 && ry < VIEW_H - 60) {
          drawText(ctx, "GP " + gr.name, rx, ry, 1, ACC);
          let mx = rx + 34;
          for (const m of gr.matches) {
            const s = NATIONS[m.a].abbr + " " + m.sa + "-" + m.sb + " " + NATIONS[m.b].abbr;
            drawText(ctx, s, mx, ry, 1, "#aeb9d6"); mx += textWidth(s, 1) + 8;
            if (mx > VIEW_W - 80) { mx = rx + 34; ry += 12; }
          }
        }
        ry += 14;
      }
    } else if (d.kind === "ties") {
      drawTextCentered(ctx, "AGGREGATE AFTER THIS LEG", VIEW_W / 2, 34, 1, MUTE);
      const ties = d.ties, cols = 2, cw = 300;
      const x0 = (VIEW_W - (cols * cw + 16)) / 2;
      const per = Math.ceil(ties.length / cols);
      for (let i = 0; i < ties.length; i++) {
        const c = (i / per) | 0, r = i % per;
        const x = x0 + c * (cw + 16), y = 50 + r * 22 - ctrl.resScroll * 6;
        if (y < 44 || y > VIEW_H - 56) continue;
        const t = ties[i];
        const you = t.a === ctrl.road.youKey || t.b === ctrl.road.youKey;
        const leg = t.leg ? t.leg.sa + "-" + t.leg.sb : "-";
        const s = NATIONS[t.a].abbr + " " + leg + " " + NATIONS[t.b].abbr + "   (AGG " + t.agg[0] + "-" + t.agg[1] + ")";
        drawText(ctx, s, x, y, 1, you ? GREEN : "#aeb9d6");
      }
    } else if (d.kind === "bracket") {
      drawTextCentered(ctx, "CAF PLAY-OFF UPDATE", VIEW_W / 2, 40, 2, MUTE);
      drawMatchBracket(ctx, { semis: d.playoff.semis, final: d.playoff.final, finalLabel: "FINAL  -  WIN TO REACH THE PLAY-OFF" }, VIEW_W / 2, 64, ctrl.road.youKey);
    } else if (d.kind === "icp") {
      drawTextCentered(ctx, "INTER-CONFEDERATION PLAY-OFF", VIEW_W / 2, 36, 1, MUTE);
      drawIcpTournament(ctx, d.icp, VIEW_W / 2, 48, ctrl.road.youKey);
    }
    drawButtons(ctx);
    blink(blinkT, () => drawTextCentered(ctx, "CLICK CONTINUE FOR THE NEXT MATCHWEEK", VIEW_W / 2, VIEW_H - 52, 1, MUTE));
  }

  function renderRoadQualified(ctx, blinkT) {
    const q = ctrl.road;
    buildButtons();
    const flash = Math.floor(blinkT * 6) % 2 === 0;
    drawTextCentered(ctx, "QUALIFIED!", VIEW_W / 2, 70, 6, flash ? ACC : GREEN);
    drawKit(ctx, q.youKey, VIEW_W / 2, 150, 5, "home");
    NATIONS[q.youKey].drawFlag(ctx, q.youKey, VIEW_W / 2 - 30, 176, 60, 38);
    drawTextCentered(ctx, NATIONS[q.youKey].name + " ARE GOING TO THE WORLD CUP", VIEW_W / 2, 224, 2, GREEN);
    drawTextCentered(ctx, "EVERY CONFEDERATION'S QUALIFYING WAS SIMULATED -", VIEW_W / 2, 250, 1, MUTE);
    drawTextCentered(ctx, "THE 48-TEAM FIELD IS FRESHLY DRAWN, NOT THE REAL 2026 ONE", VIEW_W / 2, 262, 1, MUTE);
    drawButtons(ctx);
    blink(blinkT, () => drawTextCentered(ctx, "CONTINUE STRAIGHT INTO THE WORLD CUP", VIEW_W / 2, VIEW_H - 8, 1, MUTE));
  }

  function renderRoadEliminated(ctx, blinkT) {
    const q = ctrl.road;
    buildButtons();
    drawTextCentered(ctx, "DID NOT QUALIFY", VIEW_W / 2, 56, 5, "#ff7b7b");
    drawKit(ctx, q.youKey, VIEW_W / 2, 116, 3, "home");
    drawTextCentered(ctx, NATIONS[q.youKey].name + " ARE OUT IN " + (q.youOut || "QUALIFYING"), VIEW_W / 2, 142, 1, MUTE);
    // who's going from this confederation: the direct qualifiers, plus its
    // play-off rep(s) (whose fate is decided in the central ICP).
    const qs = ctrl.eng.qualifiers(q);
    const reps = qs.reps || [];
    const all = [...qs.direct, ...reps];
    drawTextCentered(ctx, ctrl.eng.region + " AT THE 2026 WORLD CUP", VIEW_W / 2, 164, 1, ACC);
    const cols = 3, cw = 180, x0 = (VIEW_W - cols * cw) / 2;
    for (let i = 0; i < all.length; i++) {
      const x = x0 + (i % cols) * cw, y = 180 + ((i / cols) | 0) * 18;
      drawKit(ctx, all[i], x + 8, y + 4, 0.9, "home");
      const isRep = reps.includes(all[i]);
      drawText(ctx, NATIONS[all[i]].name, x + 20, y, 1, isRep ? "#c0a24a" : TEXT);
      if (isRep) drawText(ctx, "(P-O)", x + 20 + textWidth(NATIONS[all[i]].name, 1) + 6, y, 1, "#6a7aa0");
    }
    drawButtons(ctx);
    blink(blinkT, () => drawTextCentered(ctx, "WATCH THE WORLD CUP PLAY OUT, OR START A NEW ROAD", VIEW_W / 2, VIEW_H - 8, 1, MUTE));
  }

  // Road buttons: tabs + play/sim/continue.
  function buildRoadButtons(b, cx) {
    const e = aEng(), o = aObj();
    const v = e.roadView(o);
    const rankTab = e.roadRankTab ? e.roadRankTab(o) : null;
    if (ctrl.roadTab === "rank" && !rankTab) ctrl.roadTab = "me";
    const allLabel = v.kind === "ties" ? "ALL TIES" : v.kind === "bracket" ? "PLAY-OFF"
      : v.kind === "icp" ? "PLAY-OFF" : (v.league ? "FULL TABLE" : "ALL GROUPS");
    const defs = [["rtabme", "MY ROAD", "me"], ["rtaball", allLabel, "all"]];
    if (rankTab) defs.push(["rtabrank", rankTab.tabLabel, "rank"]);
    const n = defs.length, tw = n === 3 ? 130 : 158, tg = 4;
    const tx0 = cx - Math.round((n * tw + (n - 1) * tg) / 2);
    defs.forEach((d, i) => b.push({
      id: d[0], x: tx0 + i * (tw + tg), y: 32, w: tw, h: 18, label: d[1], scale: 1,
      active: ctrl.roadTab === d[2], action: () => { ctrl.roadTab = d[2]; ctrl.allScroll = 0; },
    }));
    if (canSaveNow()) b.push({ id: "rsave", x: 6, y: 32, w: 64, h: 18, label: "SAVE", scale: 1, action: () => enterSlots("save", "road") });
    if (ctrl.roadTab === "me") {
      const f = e.playerFixture(o);
      if (f) {
        b.push({ id: "rplay", x: cx - 265, y: 344, w: 255, h: 38, label: "PLAY MATCH", scale: 3, primary: true, action: startRoadMatch });
        b.push({ id: "rsim",  x: cx + 10,  y: 344, w: 255, h: 38, label: "SIM MATCH",  scale: 2, subtitle: "AUTO-SIMULATE YOUR FIXTURE", action: simRoadMatch });
      } else {
        b.push({ id: "rcont", x: cx - 130, y: 344, w: 260, h: 38, label: "CONTINUE", scale: 2, primary: true, action: skipRoadWeek });
      }
    }
  }

  // --- Verification helpers (used by window.__wcj) ---
  ctrl.devStartTournament = function (key = "BRA") {
    ctrl.t = T.createTournament(key);
    ctrl.hubTab = "me";
    ctrl.view = "hub";
    ctrl.sel = 0;
    ctrl.activeSlot = -1;
  };
  // Save-file verification hooks (used by window.__wcj).
  ctrl.devSaveSlot = function (i) { doSaveSlot(i); return Save.listSlots(); };
  ctrl.devLoadSlot = function (i) { doLoadSlot(i); return ctrl.t ? ctrl.snapshot() : ctrl.roadSnapshot(); };
  ctrl.devListSlots = function () { return Save.listSlots(); };
  ctrl.devDeleteSlot = function (i) { doDeleteSlot(i); return Save.listSlots(); };
  // Fast-forward one matchweek by auto-simulating the player's own fixture
  // (same code path as a real result). Verification only.
  ctrl.devAdvance = function () {
    const t = ctrl.t;
    if (!t || t.stage === "done") return ctrl.snapshot();
    const you = t.youKey;
    if (t.youAlive && T.playerFixture(t)) {
      const f = T.playerFixture(t);
      const opp = f.a === you ? f.b : f.a;
      const r = T.simMatch(f.a, f.b, f.kind === "ko");
      const youScore = f.a === you ? r.a : r.b;
      const oppScore = f.a === you ? r.b : r.a;
      const pens = f.kind === "ko" && youScore === oppScore ? T.penShootout(you, opp) : null;
      T.recordPlayerMatch(t, youScore, oppScore, pens);
      T.advanceMatchweek(t);
      T.checkGroupElimination(t);
    } else {
      T.simToEnd(t);
    }
    if (t.stage === "done" || t.champion) ctrl.view = "champion";
    else if (!t.youAlive) ctrl.view = "eliminated";
    else ctrl.view = "hub";
    ctrl.sel = 0;
    return ctrl.snapshot();
  };
  ctrl.snapshot = function () {
    if (!ctrl.t) return { view: ctrl.view, t: null };
    const t = ctrl.t;
    const f = T.playerFixture(t);
    return {
      view: ctrl.view,
      stage: t.stage,
      matchday: t.matchday,
      koRound: t.koRound,
      youKey: t.youKey,
      youAlive: t.youAlive,
      youOut: t.youOut,
      champion: t.champion,
      fixture: f ? { a: f.a, b: f.b, kind: f.kind } : null,
    };
  };

  // --- Road verification helpers ---
  ctrl.devStartRoad = function (key = "JPN", confed) {
    ctrl.roadConfed = confed || (NATIONS[key] && ROAD_ENGINES[NATIONS[key].confed] ? NATIONS[key].confed : "AFC");
    startRoad(key);
    return ctrl.roadSnapshot();
  };
  // Launch the current road fixture as a live match (verification only).
  ctrl.devRoadPlay = function () { startRoadMatch(); };
  // Fast-forward one road matchweek (sims the human's own fixture, same path as
  // a real result), then runs the post-matchweek transition.
  ctrl.devRoadAdvance = function () {
    // At a terminal road screen, drive the hand-off into the World Cup.
    if (ctrl.view === "roadqualified") { handoffToWorldCup(false); return ctrl.roadSnapshot(); }
    if (ctrl.view === "roadeliminated") { handoffToWorldCup(true); return ctrl.roadSnapshot(); }
    const e = aEng(), o = aObj();
    if (!o) return ctrl.roadSnapshot();
    const f = e.playerFixture(o);
    if (!f) { skipRoadWeek(); return ctrl.roadSnapshot(); }
    const r = T.simMatch(f.youKey, f.oppKey, false);
    const out = e.preview(o, r.a, r.b);
    e.record(o, r.a, r.b, out.pens);
    continueAfterRoadResults();
    return ctrl.roadSnapshot();
  };
  ctrl.roadSnapshot = function () {
    const q = ctrl.road;
    if (!q) return { view: ctrl.view, road: null };
    const f = aEng().playerFixture(aObj());
    return {
      view: ctrl.view,
      confed: ctrl.roadConfed,
      stage: ctrl.icpActive ? "icp" : q.stage,
      icpActive: !!ctrl.icpActive,
      youKey: q.youKey,
      youStatus: q.youStatus,
      youOut: q.youOut,
      directCount: q.qualifiedDirect.length,
      reps: (q.icpReps || []).slice(),
      icpWinners: ctrl.icp && ctrl.icp.done ? ctrl.icp.winners.slice() : null,
      fixture: f ? { you: f.youKey, opp: f.oppKey, kind: f.kind, label: f.label } : null,
      tournamentReady: !!ctrl.t,
      tournamentYou: ctrl.t ? ctrl.t.youKey : null,
    };
  };

  return ctrl;
}

function dim(ctx, a) {
  ctx.fillStyle = `rgba(4,8,18,${a})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}
function blink(blinkT, fn) {
  if (Math.floor(blinkT * 2) % 2 === 0) fn();
}
