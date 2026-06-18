// Every team is identified by its KIT (uniform), not a roster. Players are
// generic (position + shirt number) and all share one team-wide OVR that drives
// play but is never shown in-game. 64 nations: the 48-team 2026 World Cup field
// plus 16 big nations that aren't in it (Italy, China, India, ...).
//
// A team = { name, abbr, shirt, shirtDark, shorts, skin, gk, ovr, flag }.
// `flag` is a compact descriptor the renderer below understands:
//   { v:[...] } vertical equal bands   { h:[...] } horizontal equal bands
//   { plain:c } solid field            add { dot:c } for a centre emblem
//   { nordic:{field,cross,inner?} }    { sp:"KEY" } hand-drawn special

function darken(hex, f = 0.72) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
// Keeper kit that contrasts the shirt: dark slate over light shirts, neon green
// over dark ones.
function pickGk(shirt) {
  const n = parseInt(shirt.slice(1), 16);
  const lum = (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
  return lum > 0.5 ? "#23272f" : "#19c27a";
}

const DEF_SKIN = "#c08a55";

// Real-world away kit colours for notable nations; others auto-swap shirt/shorts.
const AWAY_OVERRIDES = {
  BRA: ["#ffffff", "#1f4fb0"],
  ARG: ["#1a2755", "#ffffff"],
  FRA: ["#ffffff", "#1e3a8a"],
  GER: ["#ce1126", "#1a1a1a"],
  ENG: ["#c8102e", "#1a237e"],
  ESP: ["#1a2a6c", "#ffd700"],
  POR: ["#ffffff", "#006b3f"],
  ITA: ["#ffffff", "#1d3a8f"],
  NED: ["#1a237e", "#ffffff"],
  URU: ["#ffffff", "#1a1a1a"],
  BEL: ["#1a1a1a", "#c8102e"],
  CRO: ["#1a237e", "#d52b1e"],
  MEX: ["#d52b1e", "#ffffff"],
  USA: ["#1a2a5e", "#ffffff"],
  COL: ["#003893", "#fcd116"],
  SEN: ["#00853f", "#ffffff"],
  NGA: ["#1a1a1a", "#008751"],
  JPN: ["#ffffff", "#1d3461"],
  KOR: ["#1a1a1a", "#c8102e"],
  MAR: ["#006233", "#c1272d"],
};

// [ key, name, abbr, shirt, shorts, ovr, flag ]
// The first 48 entries are the actual 2026 World Cup qualifiers (WC_KEYS = slice 0..48).
// Everything after is nations NOT in the 2026 World Cup (still available in Quick Play).
const TABLE = [
  // --- Hosts (3) ---
  ["USA", "USA", "USA", "#ffffff", "#1a2a5e", 80, { sp: "USA" }],
  ["MEX", "MEXICO", "MEX", "#0b6b3a", "#ffffff", 79, { v: ["#0b6b3a", "#ffffff", "#d52b1e"], dot: "#5a3a1a" }],
  ["CAN", "CANADA", "CAN", "#d52b1e", "#ffffff", 77, { sp: "CAN" }],
  // --- CONMEBOL (6) ---
  ["BRA", "BRAZIL", "BRA", "#f7d417", "#1f4fb0", 88, { sp: "BRA" }],
  ["ARG", "ARGENTINA", "ARG", "#7fbfe6", "#23335c", 89, { sp: "ARG" }],
  ["URU", "URUGUAY", "URU", "#5aa9e6", "#1a1a1a", 83, { plain: "#ffffff", dot: "#f5c518" }],
  ["COL", "COLOMBIA", "COL", "#fcd116", "#003893", 82, { h: ["#fcd116", "#003893", "#ce1126"] }],
  ["ECU", "ECUADOR", "ECU", "#ffd100", "#0a2472", 78, { h: ["#ffd100", "#0a2472", "#d52b1e"], dot: "#7a5a18" }],
  ["PAR", "PARAGUAY", "PAR", "#d52b1e", "#0038a8", 76, { h: ["#d52b1e", "#ffffff", "#0038a8"] }],
  // --- UEFA (16) ---
  ["FRA", "FRANCE", "FRA", "#1e3a8a", "#ffffff", 90, { v: ["#1e3a8a", "#ffffff", "#c8102e"] }],
  ["ESP", "SPAIN", "ESP", "#c8102e", "#1a2a6c", 88, { h: ["#c8102e", "#f1bf00", "#c8102e"], dot: "#9e0c24" }],
  ["ENG", "ENGLAND", "ENG", "#ffffff", "#1a237e", 87, { sp: "ENG" }],
  ["POR", "PORTUGAL", "POR", "#c1121f", "#1e6b2f", 86, { v: ["#1e6b2f", "#c1121f"], dot: "#f5c518" }],
  ["NED", "NETHERLANDS", "NED", "#f36c21", "#ffffff", 85, { h: ["#ae1c28", "#ffffff", "#21468b"] }],
  ["GER", "GERMANY", "GER", "#ffffff", "#1a1a1a", 85, { h: ["#000000", "#dd0000", "#ffce00"] }],
  ["BEL", "BELGIUM", "BEL", "#c8102e", "#1a1a1a", 83, { v: ["#000000", "#fae042", "#ed2939"] }],
  ["CRO", "CROATIA", "CRO", "#d52b1e", "#1a237e", 83, { h: ["#d52b1e", "#ffffff", "#171796"], dot: "#171796" }],
  ["SUI", "SWITZERLAND", "SUI", "#d52b1e", "#ffffff", 82, { sp: "SUI" }],
  ["NOR", "NORWAY", "NOR", "#ba0c2f", "#00205b", 82, { nordic: { field: "#ba0c2f", cross: "#ffffff", inner: "#00205b" } }],
  ["AUT", "AUSTRIA", "AUT", "#ed2939", "#ffffff", 81, { h: ["#ed2939", "#ffffff", "#ed2939"] }],
  ["SWE", "SWEDEN", "SWE", "#fecb00", "#005b99", 81, { nordic: { field: "#005b99", cross: "#fecb00" } }],
  ["TUR", "TURKIYE", "TUR", "#e30a17", "#ffffff", 80, { plain: "#e30a17", dot: "#ffffff" }],
  ["CZE", "CZECHIA", "CZE", "#d7141a", "#ffffff", 79, { h: ["#ffffff", "#d7141a"], dot: "#11457e" }],
  ["SCO", "SCOTLAND", "SCO", "#0065bf", "#ffffff", 78, { plain: "#0065bf", dot: "#ffffff" }],
  ["BIH", "BOSNIA", "BIH", "#002395", "#ffd700", 75, { plain: "#002395", dot: "#ffcd00" }],
  // --- CONCACAF non-host (3) ---
  ["PAN", "PANAMA", "PAN", "#db0a16", "#005293", 73, { plain: "#ffffff", dot: "#005293" }],
  ["HAI", "HAITI", "HAI", "#00209f", "#d21034", 69, { h: ["#00209f", "#d21034"] }],
  ["CUW", "CURACAO", "CUW", "#003da5", "#f8e11e", 67, { h: ["#003da5", "#f8e11e", "#003da5"], dot: "#ffffff" }],
  // --- CAF (10) ---
  ["MAR", "MOROCCO", "MAR", "#c1272d", "#006233", 82, { plain: "#c1272d", dot: "#006233" }],
  ["SEN", "SENEGAL", "SEN", "#ffffff", "#00853f", 82, { v: ["#00853f", "#fdef42", "#e31b23"], dot: "#00853f" }],
  ["ALG", "ALGERIA", "ALG", "#ffffff", "#006233", 80, { v: ["#006233", "#ffffff"], dot: "#d21034" }],
  ["CIV", "IVORY COAST", "CIV", "#f77f00", "#ffffff", 80, { v: ["#f77f00", "#ffffff", "#009e60"] }],
  ["EGY", "EGYPT", "EGY", "#ce1126", "#ffffff", 79, { h: ["#ce1126", "#ffffff", "#000000"], dot: "#c09300" }],
  ["GHA", "GHANA", "GHA", "#ffffff", "#ce1126", 78, { h: ["#ce1126", "#fcd116", "#006b3f"], dot: "#000000" }],
  ["TUN", "TUNISIA", "TUN", "#e70013", "#ffffff", 77, { plain: "#e70013", dot: "#ffffff" }],
  ["RSA", "SOUTH AFRICA", "RSA", "#007a4d", "#fcb913", 75, { h: ["#007a4d", "#ffffff", "#de3831"], dot: "#001489" }],
  ["COD", "DR CONGO", "COD", "#007fff", "#f7d618", 74, { v: ["#007fff", "#ce1021"], dot: "#f7d618" }],
  ["CPV", "CAPE VERDE", "CPV", "#003893", "#d21034", 70, { h: ["#003893", "#ffffff", "#d21034"], dot: "#ffcd00" }],
  // --- AFC (9) ---
  ["JPN", "JAPAN", "JPN", "#1d3461", "#ffffff", 82, { sp: "JPN" }],
  ["KOR", "SOUTH KOREA", "KOR", "#c8102e", "#1a1a1a", 82, { plain: "#ffffff", dot: "#cd2e3a" }],
  ["AUS", "AUSTRALIA", "AUS", "#fcd116", "#005c2e", 77, { plain: "#00843d", dot: "#fcd116" }],
  ["IRN", "IRAN", "IRN", "#ffffff", "#c8102e", 79, { h: ["#239f40", "#ffffff", "#da0000"], dot: "#da0000" }],
  ["KSA", "SAUDI ARABIA", "KSA", "#ffffff", "#006c35", 74, { plain: "#006c35", dot: "#ffffff" }],
  ["QAT", "QATAR", "QAT", "#8a1538", "#ffffff", 74, { v: ["#ffffff", "#8a1538"] }],
  ["IRQ", "IRAQ", "IRQ", "#1a8754", "#ffffff", 73, { h: ["#ce1126", "#ffffff", "#000000"], dot: "#007a3d" }],
  ["UZB", "UZBEKISTAN", "UZB", "#0099b5", "#ffffff", 75, { h: ["#0099b5", "#ffffff", "#1eb53a"], dot: "#ce1126" }],
  ["JOR", "JORDAN", "JOR", "#ce1126", "#ffffff", 72, { h: ["#000000", "#ffffff", "#007a3d"], dot: "#ce1126" }],
  // --- OFC (1) ---
  ["NZL", "NEW ZEALAND", "NZL", "#1a1a1a", "#ffffff", 72, { plain: "#00247d", dot: "#ffffff" }],
  // --- Nations NOT qualified for the 2026 World Cup ---
  ["ITA", "ITALY", "ITA", "#1d3a8f", "#ffffff", 86, { v: ["#009246", "#ffffff", "#ce2b37"] }],
  ["NGA", "NIGERIA", "NGA", "#008751", "#ffffff", 80, { v: ["#008751", "#ffffff", "#008751"] }],
  ["DEN", "DENMARK", "DEN", "#c60c30", "#ffffff", 82, { nordic: { field: "#c60c30", cross: "#ffffff" } }],
  ["SRB", "SERBIA", "SRB", "#c6363c", "#0c4076", 80, { h: ["#c6363c", "#0c4076", "#ffffff"], dot: "#c09300" }],
  ["POL", "POLAND", "POL", "#dc143c", "#ffffff", 80, { h: ["#ffffff", "#dc143c"] }],
  ["UKR", "UKRAINE", "UKR", "#ffd700", "#0057b7", 79, { h: ["#0057b7", "#ffd700"] }],
  ["CMR", "CAMEROON", "CMR", "#007a5e", "#ce1126", 79, { v: ["#007a5e", "#ce1126", "#fcd116"], dot: "#fcd116" }],
  ["HUN", "HUNGARY", "HUN", "#ce2939", "#ffffff", 77, { h: ["#ce2939", "#ffffff", "#477050"] }],
  ["GRE", "GREECE", "GRE", "#0d5eaf", "#ffffff", 77, { h: ["#0d5eaf", "#ffffff", "#0d5eaf"] }],
  ["MLI", "MALI", "MLI", "#14b53a", "#ffffff", 77, { v: ["#14b53a", "#fcd116", "#ce1126"] }],
  ["WAL", "WALES", "WAL", "#c8102e", "#1a1a1a", 77, { h: ["#ffffff", "#00ad36"], dot: "#c8102e" }],
  ["ROU", "ROMANIA", "ROU", "#fcd116", "#002b7f", 76, { v: ["#002b7f", "#fcd116", "#ce1126"] }],
  ["IRL", "IRELAND", "IRL", "#169b62", "#ffffff", 76, { v: ["#169b62", "#ffffff", "#ff883e"] }],
  ["CRC", "COSTA RICA", "CRC", "#c8102e", "#002b7f", 74, { h: ["#002b7f", "#ffffff", "#c8102e"] }],
  ["JAM", "JAMAICA", "JAM", "#fed100", "#1a1a1a", 74, { plain: "#009b3a", dot: "#fed100" }],
  ["ISR", "ISRAEL", "ISR", "#ffffff", "#0038b8", 74, { h: ["#ffffff", "#0038b8", "#ffffff"], dot: "#0038b8" }],
  ["FIN", "FINLAND", "FIN", "#ffffff", "#003580", 74, { nordic: { field: "#ffffff", cross: "#003580" } }],
  ["ISL", "ICELAND", "ISL", "#0048e0", "#ffffff", 74, { nordic: { field: "#0048e0", cross: "#ffffff", inner: "#dc1e35" } }],
  ["RUS", "RUSSIA", "RUS", "#ffffff", "#c8102e", 78, { h: ["#ffffff", "#0039a6", "#d52b1e"] }],
  ["CHN", "CHINA", "CHN", "#de2910", "#ffde00", 62, { plain: "#de2910", dot: "#ffde00" }],
  ["IND", "INDIA", "IND", "#5aa9e6", "#ffffff", 58, { h: ["#ff9933", "#ffffff", "#138808"], dot: "#000080" }],
  ["BUL", "BULGARIA", "BUL", "#ffffff", "#00966e", 72, { h: ["#ffffff", "#00966e", "#d62612"] }],
];

export const NATIONS = {};
export const NATION_KEYS = TABLE.map((t) => t[0]);
// The 48-team 2026 World Cup field: the first 48 entries of TABLE (everything
// before the "Big nations NOT at the World Cup" block). Used by the World Cup
// tournament mode for the draw.
export const WC_KEYS = NATION_KEYS.slice(0, 48);
for (const [key, name, abbr, shirt, shorts, ovr, flag] of TABLE) {
  const awOvr = AWAY_OVERRIDES[key];
  const awShirt = awOvr ? awOvr[0] : shorts;
  const awShorts = awOvr ? awOvr[1] : shirt;
  NATIONS[key] = {
    name,
    abbr,
    shirt,
    shirtDark: darken(shirt),
    shorts,
    skin: DEF_SKIN,
    gk: pickGk(shirt),
    ovr,
    flag,
    drawFlag,
    away: { shirt: awShirt, shirtDark: darken(awShirt), shorts: awShorts, gk: pickGk(awShirt) },
  };
}

export function teamOvr(key) {
  return NATIONS[key].ovr;
}

// ISO 3166-1 alpha-2 codes used by flagcdn.com
const ISO2 = {
  USA:"us", MEX:"mx", CAN:"ca",
  BRA:"br", ARG:"ar", URU:"uy", COL:"co", ECU:"ec", PAR:"py",
  FRA:"fr", ESP:"es", ENG:"gb-eng", POR:"pt", NED:"nl", GER:"de",
  BEL:"be", CRO:"hr", SUI:"ch", NOR:"no", AUT:"at", SWE:"se",
  TUR:"tr", CZE:"cz", SCO:"gb-sct", BIH:"ba",
  PAN:"pa", HAI:"ht", CUW:"cw",
  MAR:"ma", SEN:"sn", ALG:"dz", CIV:"ci", EGY:"eg", GHA:"gh",
  TUN:"tn", RSA:"za", COD:"cd", CPV:"cv",
  JPN:"jp", KOR:"kr", AUS:"au", IRN:"ir", KSA:"sa", QAT:"qa",
  IRQ:"iq", UZB:"uz", JOR:"jo", NZL:"nz",
  ITA:"it", NGA:"ng", DEN:"dk", SRB:"rs", POL:"pl", UKR:"ua",
  CMR:"cm", HUN:"hu", GRE:"gr", MLI:"ml", WAL:"gb-wls", ROU:"ro",
  IRL:"ie", CRC:"cr", JAM:"jm", ISR:"il", FIN:"fi", ISL:"is",
  RUS:"ru", CHN:"cn", IND:"in", BUL:"bg",
};

const flagImgs = {};
const flagLoading = new Set();

function startFlagLoad(key) {
  const code = ISO2[key];
  if (!code || flagImgs[key] || flagLoading.has(key)) return;
  flagLoading.add(key);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => { flagImgs[key] = img; flagLoading.delete(key); };
  img.onerror = () => flagLoading.delete(key);
  img.src = `https://flagcdn.com/w80/${code}.png`;
}

export function preloadFlags() {
  for (const key of NATION_KEYS) startFlagLoad(key);
}

function px(ctx, x, y, w, h, c) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
}

// Draw flag using a real image from flagcdn.com, with procedural fallback while loading.
function drawFlag(ctx, key, x, y, w, h) {
  if (flagImgs[key]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
    ctx.clip();
    ctx.drawImage(flagImgs[key], Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
    ctx.restore();
    return;
  }
  startFlagLoad(key);
  // Procedural placeholder while the image loads.
  const f = NATIONS[key].flag;
  if (f.sp) { drawSpecialFlag(ctx, f.sp, x, y, w, h); return; }
  if (f.nordic) { drawNordic(ctx, f.nordic, x, y, w, h); return; }
  if (f.v) {
    const n = f.v.length, bw = w / n;
    for (let i = 0; i < n; i++) px(ctx, x + i * bw, y, bw + 1, h, f.v[i]);
  } else if (f.h) {
    const n = f.h.length, bh = h / n;
    for (let i = 0; i < n; i++) px(ctx, x, y + i * bh, w, bh + 1, f.h[i]);
  } else if (f.plain) {
    px(ctx, x, y, w, h, f.plain);
  }
  if (f.dot) px(ctx, x + w / 2 - 1.5, y + h / 2 - 1.5, 3, 3, f.dot);
}

// A Nordic offset cross (Denmark / Sweden / Norway / Finland / Iceland style).
function drawNordic(ctx, cfg, x, y, w, h) {
  px(ctx, x, y, w, h, cfg.field);
  const vx = x + w * 0.34; // cross sits left of centre
  const cyy = y + h * 0.46;
  const vw = Math.max(2, w * 0.13);
  const hh = Math.max(2, h * 0.2);
  px(ctx, vx, y, vw, h, cfg.cross);
  px(ctx, x, cyy, w, hh, cfg.cross);
  if (cfg.inner) {
    const ivw = Math.max(1, vw * 0.4);
    const ihh = Math.max(1, hh * 0.4);
    px(ctx, vx + (vw - ivw) / 2, y, ivw, h, cfg.inner);
    px(ctx, x, cyy + (hh - ihh) / 2, w, ihh, cfg.inner);
  }
}

// Hand-drawn flags that don't reduce to bands.
function drawSpecialFlag(ctx, sp, x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (sp) {
    case "USA": {
      px(ctx, x, y, w, h, "#ffffff");
      const sh = h / 6;
      for (let i = 0; i < 6; i += 2) px(ctx, x, y + i * sh, w, sh, "#b22234");
      px(ctx, x, y, w * 0.45, h * 0.5, "#3c3b6e");
      ctx.fillStyle = "#ffffff";
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < 2; c++) ctx.fillRect(Math.round(x + 1 + c * 3), Math.round(y + 1 + r * 2), 1, 1);
      break;
    }
    case "CAN": {
      px(ctx, x, y, w, h, "#ffffff");
      px(ctx, x, y, w * 0.27, h, "#d52b1e");
      px(ctx, x + w - w * 0.27, y, w * 0.27, h, "#d52b1e");
      px(ctx, cx - 1.5, cy - 1.5, 3, 3, "#d52b1e");
      break;
    }
    case "ENG": {
      px(ctx, x, y, w, h, "#ffffff");
      px(ctx, cx - 1.5, y, 3, h, "#ce1126");
      px(ctx, x, cy - 1.5, w, 3, "#ce1126");
      break;
    }
    case "SUI": {
      px(ctx, x, y, w, h, "#d52b1e");
      px(ctx, cx - 1.5, cy - h * 0.28, 3, h * 0.56, "#ffffff");
      px(ctx, cx - w * 0.28, cy - 1.5, w * 0.56, 3, "#ffffff");
      break;
    }
    case "JPN": {
      px(ctx, x, y, w, h, "#ffffff");
      px(ctx, cx - 2, cy - 2, 4, 4, "#bc002d");
      break;
    }
    case "BRA": {
      px(ctx, x, y, w, h, "#1e9e4a");
      ctx.fillStyle = "#f7d417";
      const hw = w * 0.42;
      const hh = h * 0.42;
      ctx.beginPath();
      ctx.moveTo(cx, cy - hh);
      ctx.lineTo(cx + hw, cy);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx - hw, cy);
      ctx.closePath();
      ctx.fill();
      px(ctx, cx - h * 0.18, cy - h * 0.18, h * 0.36, h * 0.36, "#1f4fb0");
      break;
    }
    case "ARG": {
      const band = h / 3;
      px(ctx, x, y, w, band, "#7fbfe6");
      px(ctx, x, y + band, w, h - 2 * band, "#ffffff");
      px(ctx, x, y + h - band, w, band, "#7fbfe6");
      px(ctx, cx - 1, cy - 1, 2, 2, "#f2c200");
      break;
    }
    default:
      px(ctx, x, y, w, h, "#888");
  }
}

// A tiny pixel jersey (shirt + sleeves + shorts) centred at (cx, cy). Used on
// the team-select cards and the scoreboard so teams read by their kit.
export function drawKit(ctx, key, cx, cy, s = 1, kitType = "home") {
  const n = NATIONS[key];
  const t = kitType === "away" ? n.away : n;
  const rect = (dx, dy, dw, dh, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(cx + dx * s), Math.round(cy + dy * s), Math.ceil(dw * s), Math.ceil(dh * s));
  };
  rect(-5, -3, 2, 3, t.shirtDark); // left sleeve
  rect(3, -3, 2, 3, t.shirtDark); // right sleeve
  rect(-3, -4, 6, 7, t.shirt); // body
  rect(-1, -4, 2, 1, t.shirtDark); // collar
  rect(-2, 3, 4, 3, t.shorts); // shorts
}
