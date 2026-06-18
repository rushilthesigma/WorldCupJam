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
import { NATIONS, WC_KEYS, NATION_KEYS, drawKit } from "./nations.js";

// Fast lookup: which keys are actually in the 2026 World Cup field.
const WC_SET = new Set(WC_KEYS);
import { drawText, drawTextCentered, textWidth } from "./font.js";
import * as T from "./tournament.js";

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
    view: "mode", // mode | team | hub | results | eliminated | champion
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
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------
  ctrl.onWheel = function (dir) {
    if (ctrl.view === "team") {
      const maxS = Math.max(0, Math.ceil(NATION_KEYS.length / 4) - GRID.vis);
      ctrl.gridScroll = clamp(ctrl.gridScroll + dir, 0, maxS);
    } else if (ctrl.view === "hub" && ctrl.hubTab === "all") {
      ctrl.allScroll = clamp(ctrl.allScroll + dir, 0, 40);
    } else if (ctrl.view === "results") {
      ctrl.resScroll = clamp(ctrl.resScroll + dir, 0, 60);
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
      if (fire) {
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
    } else if (ctrl.view === "hub") {
      if (ctrl.hubTab === "all" || ctrl.hubTab === "thirds") ctrl.hubTab = "me";
    }
    // results / eliminated / champion ignore back (use the buttons).
  }

  // Build the focusable buttons for the current view (used by update + render).
  function buildButtons() {
    const b = [];
    const cx = VIEW_W / 2;
    if (ctrl.view === "mode") {
      b.push({ id: "quick", x: cx - 150, y: 124, w: 300, h: 50, label: "QUICK PLAY", scale: 3, subtitle: "ONE MATCH, ANY TWO TEAMS", action: () => hooks.quickPlay() });
      b.push({ id: "wc", x: cx - 150, y: 192, w: 300, h: 50, label: "WORLD CUP", scale: 3, primary: true, subtitle: "FULL 48-TEAM TOURNAMENT - PLAY ONE GAME EACH MATCHWEEK", action: enterTeamPick });
      b.push({ id: "auto", x: cx - 150, y: 260, w: 300, h: 50, label: "AUTOPLAY", scale: 3, subtitle: "WATCH AI VS AI", action: () => hooks.autoPlay() });
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
      if (ctrl.hubTab === "me" && T.playerFixture(ctrl.t)) {
        b.push({ id: "play", x: cx - 265, y: 340, w: 255, h: 42, label: "PLAY MATCH", scale: 3, primary: true, action: startPlayerMatch });
        b.push({ id: "sim", x: cx + 10, y: 340, w: 255, h: 42, label: "SIM MATCH", scale: 2, subtitle: "AUTO-SIMULATE YOUR FIXTURE", action: simPlayerMatch });
      }
    } else if (ctrl.view === "results") {
      b.push({ id: "continue", x: cx - 130, y: VIEW_H - 40, w: 260, h: 30, label: "CONTINUE", scale: 2, primary: true, action: continueAfterResults });
    } else if (ctrl.view === "eliminated") {
      b.push({ id: "sim", x: cx - 250, y: 250, w: 160, h: 38, label: "SIM TO END", scale: 2, primary: true, action: () => { T.simToEnd(ctrl.t); ctrl.view = "champion"; ctrl.sel = 0; } });
      b.push({ id: "new", x: cx - 80, y: 250, w: 160, h: 38, label: "NEW CUP", scale: 2, action: enterTeamPick });
      b.push({ id: "menu", x: cx + 90, y: 250, w: 160, h: 38, label: "MAIN MENU", scale: 2, action: () => { ctrl.t = null; hooks.toTitle(); } });
    } else if (ctrl.view === "champion") {
      b.push({ id: "new", x: cx - 168, y: VIEW_H - 56, w: 160, h: 38, label: "NEW CUP", scale: 2, primary: true, action: enterTeamPick });
      b.push({ id: "menu", x: cx + 8, y: VIEW_H - 56, w: 160, h: 38, label: "MAIN MENU", scale: 2, action: () => { ctrl.t = null; hooks.toTitle(); } });
    }
    ctrl.buttons = b;
    if (ctrl.sel >= b.length) ctrl.sel = 0;
  }

  function enterTeamPick() {
    ctrl.view = "team";
    ctrl.gridCursor = 0;
    ctrl.gridScroll = 0;
    ctrl.searchQuery = "";
    ctrl.searchFocused = false;
  }

  // ---- Team grid (all 64 nations, 4 cols, scrolling; non-WC teams greyed out) ----
  const GRID = { cols: 4, vis: 3, cw: 132, ch: 70, gx: 12, gy: 10, y0: 92 };
  GRID.x0 = Math.round((VIEW_W - (GRID.cols * GRID.cw + (GRID.cols - 1) * GRID.gx)) / 2);
  function getFilteredKeys() {
    if (!ctrl.searchQuery) return NATION_KEYS;
    const q = ctrl.searchQuery.toLowerCase();
    return NATION_KEYS.filter(k =>
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
    if (input.key("back")) { ctrl.view = "mode"; ctrl.sel = 1; return; }
    let confirm = input.key("start");
    if (input.click) {
      const h = gridHit(input.click.x, input.click.y);
      if (h >= 0) {
        ctrl.gridCursor = h;
        ctrl.searchFocused = false;
        if (WC_SET.has(filteredKeys[h])) confirm = true;
      }
    }
    const curKey = filteredKeys[ctrl.gridCursor];
    if (confirm && curKey && WC_SET.has(curKey)) {
      if (sfx.whistle) sfx.whistle();
      ctrl.t = T.createTournament(curKey);
      ctrl.hubTab = "me";
      ctrl.sel = 0;
      ctrl.view = "hub";
      if (input.consume) input.consume();
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  ctrl.render = function (ctx, blinkT) {
    dim(ctx, 0.78);
    if (ctrl.view === "mode") renderMode(ctx, blinkT);
    else if (ctrl.view === "team") renderTeam(ctx, blinkT);
    else if (ctrl.view === "hub") renderHub(ctx, blinkT);
    else if (ctrl.view === "results") renderResults(ctx, blinkT);
    else if (ctrl.view === "eliminated") renderEliminated(ctx, blinkT);
    else if (ctrl.view === "champion") renderChampion(ctx, blinkT);
  };

  function drawButtons(ctx) {
    for (let i = 0; i < ctrl.buttons.length; i++) {
      const r = ctrl.buttons[i];
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
    drawTextCentered(ctx, "WORLD CUP JAM", VIEW_W / 2, 58, 6, ACC);
    drawTextCentered(ctx, "CHOOSE A MODE", VIEW_W / 2, 110, 2, TEXT);
    drawButtons(ctx);
    blink(blinkT, () => drawTextCentered(ctx, "CLICK A MODE  -  ARROWS + ENTER  -  ESC BACK", VIEW_W / 2, VIEW_H - 14, 1, MUTE));
  }

  function renderTeam(ctx, blinkT) {
    drawTextCentered(ctx, "WORLD CUP", VIEW_W / 2, 16, 3, ACC);
    drawTextCentered(ctx, "PICK YOUR NATION", VIEW_W / 2, 48, 2, TEXT);
    drawTextCentered(ctx, "48 QUALIFIED TEAMS  -  GREYED = NOT IN WC 2026", VIEW_W / 2, 70, 1, MUTE);

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
      const qualified = WC_SET.has(key);
      const sel = i === ctrl.gridCursor;
      ctx.fillStyle = qualified ? PANEL : "rgba(14,18,28,0.92)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = sel ? (qualified ? ACC : "#666688") : (qualified ? LINE : "#28304a");
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.globalAlpha = qualified ? 1 : 0.3;
      NATIONS[key].drawFlag(ctx, key, r.x + 12, r.y + 10, 40, 26);
      drawKit(ctx, key, r.x + r.w - 26, r.y + 23, 1.5);
      ctx.globalAlpha = 1;
      const nameCol = sel ? (qualified ? ACC : "#888aaa") : (qualified ? TEXT : "#4a5070");
      drawTextCentered(ctx, NATIONS[key].name, r.x + r.w / 2, r.y + 44, 1, nameCol);
      if (qualified) {
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
    blink(blinkT, () => drawTextCentered(ctx, "CLICK QUALIFIED TEAM TO PICK  -  SCROLL TO SEE ALL  -  ESC BACK", VIEW_W / 2, VIEW_H - 12, 1, MUTE));
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

  // --- Verification helpers (used by window.__wcj) ---
  ctrl.devStartTournament = function (key = "BRA") {
    ctrl.t = T.createTournament(key);
    ctrl.hubTab = "me";
    ctrl.view = "hub";
    ctrl.sel = 0;
  };
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

  return ctrl;
}

function dim(ctx, a) {
  ctx.fillStyle = `rgba(4,8,18,${a})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}
function blink(blinkT, fn) {
  if (Math.floor(blinkT * 2) % 2 === 0) fn();
}
