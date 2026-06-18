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
  // --- AFC qualification teams not in the 2026 WC field (Round 2 direct entrants) ---
  ["UAE", "UAE", "UAE", "#ffffff", "#000000", 74, { h: ["#00732f", "#ffffff", "#000000"], dot: "#ff0000" }],
  ["OMA", "OMAN", "OMA", "#db161b", "#ffffff", 72, { plain: "#db161b", dot: "#ffffff" }],
  ["BHR", "BAHRAIN", "BHR", "#ce1126", "#ffffff", 67, { plain: "#ce1126", dot: "#ffffff" }],
  ["SYR", "SYRIA", "SYR", "#ce1126", "#000000", 63, { h: ["#ce1126", "#ffffff", "#000000"], dot: "#007a3d" }],
  ["VIE", "VIETNAM", "VIE", "#da251d", "#da251d", 62, { plain: "#da251d", dot: "#ffff00" }],
  ["PLE", "PALESTINE", "PLE", "#ce1126", "#000000", 61, { h: ["#000000", "#ffffff", "#007a3d"], dot: "#ce1126" }],
  ["KGZ", "KYRGYZSTAN", "KGZ", "#e8112d", "#ffffff", 60, { plain: "#e8112d", dot: "#ffef00" }],
  ["LIB", "LEBANON", "LIB", "#ed1c24", "#ffffff", 57, { h: ["#ed1c24", "#ffffff", "#ed1c24"], dot: "#00a651" }],
  ["TJK", "TAJIKISTAN", "TJK", "#cc0000", "#ffffff", 55, { h: ["#cc0000", "#ffffff", "#006600"], dot: "#f8c300" }],
  ["THA", "THAILAND", "THA", "#1a3a8f", "#ffffff", 54, { h: ["#a51931", "#ffffff", "#241d4f"], dot: "#ffffff" }],
  ["PRK", "NORTH KOREA", "PRK", "#ed1c27", "#ffffff", 54, { plain: "#ed1c27", dot: "#ffffff" }],
  ["PHI", "PHILIPPINES", "PHI", "#0038a8", "#ffffff", 51, { h: ["#0038a8", "#ce1126"], dot: "#fcd116" }],
  ["MAS", "MALAYSIA", "MAS", "#fff200", "#000000", 50, { h: ["#cc0001", "#ffffff"], dot: "#fcd116" }],
  ["KUW", "KUWAIT", "KUW", "#1a5fb4", "#ffffff", 50, { h: ["#007a3d", "#ffffff", "#ce1126"], dot: "#000000" }],
  ["TKM", "TURKMENISTAN", "TKM", "#00843d", "#ffffff", 49, { plain: "#00843d", dot: "#ffffff" }],
  // --- AFC Round 1 teams (lowest-ranked entrants) ---
  ["HKG", "HONG KONG", "HKG", "#de2910", "#ffffff", 48, { plain: "#de2910", dot: "#ffffff" }],
  ["IDN", "INDONESIA", "IDN", "#ce1126", "#ffffff", 47, { h: ["#ce1126", "#ffffff"] }],
  ["TPE", "CHINESE TAIPEI", "TPE", "#003da5", "#ffffff", 47, { plain: "#fe0000", dot: "#000095" }],
  ["MDV", "MALDIVES", "MDV", "#d21034", "#ffffff", 46, { plain: "#d21034", dot: "#007e3a" }],
  ["YEM", "YEMEN", "YEM", "#ce1126", "#ffffff", 46, { h: ["#ce1126", "#ffffff", "#000000"] }],
  ["AFG", "AFGHANISTAN", "AFG", "#000000", "#d32011", 45, { v: ["#000000", "#d32011", "#007a36"], dot: "#ffffff" }],
  ["SGP", "SINGAPORE", "SGP", "#ef3340", "#ffffff", 45, { h: ["#ef3340", "#ffffff"], dot: "#ffffff" }],
  ["MYA", "MYANMAR", "MYA", "#ea2839", "#ffffff", 45, { h: ["#fecb00", "#34b233", "#ea2839"], dot: "#ffffff" }],
  ["NEP", "NEPAL", "NEP", "#dc143c", "#003893", 42, { plain: "#dc143c", dot: "#003893" }],
  ["CAM", "CAMBODIA", "CAM", "#e00025", "#032ea1", 42, { h: ["#032ea1", "#e00025", "#032ea1"], dot: "#ffffff" }],
  ["MAC", "MACAU", "MAC", "#00785e", "#ffffff", 41, { plain: "#00785e", dot: "#ffffff" }],
  ["MNG", "MONGOLIA", "MNG", "#c4272e", "#015197", 40, { v: ["#c4272e", "#015197", "#c4272e"], dot: "#ffd900" }],
  ["BHU", "BHUTAN", "BHU", "#ff7f00", "#ffd520", 40, { plain: "#ff4e12", dot: "#ffd520" }],
  ["LAO", "LAOS", "LAO", "#002868", "#ce1126", 39, { h: ["#ce1126", "#002868", "#ce1126"], dot: "#ffffff" }],
  ["BAN", "BANGLADESH", "BAN", "#006a4e", "#ffffff", 39, { plain: "#006a4e", dot: "#f42a41" }],
  ["BRU", "BRUNEI", "BRU", "#f7e017", "#000000", 38, { plain: "#f7e017", dot: "#000000" }],
  ["TLS", "TIMOR-LESTE", "TLS", "#dc241f", "#000000", 38, { plain: "#dc241f", dot: "#ffc726" }],
  ["PAK", "PAKISTAN", "PAK", "#01411c", "#ffffff", 37, { v: ["#ffffff", "#01411c"], dot: "#ffffff" }],
  ["GUM", "GUAM", "GUM", "#0033a0", "#ffffff", 36, { plain: "#0033a0", dot: "#c8102e" }],
  ["SRI", "SRI LANKA", "SRI", "#8d2029", "#eb7400", 36, { plain: "#8d2029", dot: "#eb7400" }],
  // --- Inter-confederation play-off opponents in the AFC team's path ---
  ["BOL", "BOLIVIA", "BOL", "#0a7d34", "#ffffff", 73, { h: ["#d52b1e", "#f9e300", "#007a33"] }],
  ["SUR", "SURINAME", "SUR", "#377e3b", "#ffffff", 67, { h: ["#377e3b", "#b40a2d", "#377e3b"], dot: "#ffd100" }],
  // --- CAF qualification teams not already listed (African road) ---
  ["BFA", "BURKINA FASO", "BFA", "#009639", "#ef2b2d", 76, { h: ["#ef2b2d", "#009e49"], dot: "#fcd116" }],
  ["GUI", "GUINEA", "GUI", "#ce1126", "#fcd116", 73, { v: ["#ce1126", "#fcd116", "#009460"] }],
  ["ZAM", "ZAMBIA", "ZAM", "#198a00", "#ff7900", 72, { plain: "#198a00", dot: "#ef7d00" }],
  ["GAB", "GABON", "GAB", "#3a75c4", "#fcd116", 72, { h: ["#009e60", "#fcd116", "#3a75c4"] }],
  ["EQG", "EQ GUINEA", "EQG", "#e32118", "#0073ce", 70, { h: ["#3e9a00", "#ffffff", "#e32118"], dot: "#0073ce" }],
  ["UGA", "UGANDA", "UGA", "#fcdc04", "#000000", 70, { h: ["#000000", "#fcdc04", "#d90000"], dot: "#ffffff" }],
  ["BEN", "BENIN", "BEN", "#008751", "#e8112d", 70, { h: ["#fcd116", "#e8112d"], dot: "#008751" }],
  ["MTN", "MAURITANIA", "MTN", "#006233", "#ffd700", 69, { plain: "#006233", dot: "#ffc400" }],
  ["KEN", "KENYA", "KEN", "#bb0000", "#006600", 68, { h: ["#000000", "#bb0000", "#006600"], dot: "#ffffff" }],
  ["CGO", "CONGO", "CGO", "#009543", "#dc241f", 68, { h: ["#009543", "#fbde4a", "#dc241f"] }],
  ["MAD", "MADAGASCAR", "MAD", "#fc3d32", "#007e3a", 68, { h: ["#fc3d32", "#007e3a"], dot: "#ffffff" }],
  ["GNB", "GUINEA-BISSAU", "GNB", "#ce1126", "#009e49", 68, { h: ["#fcd116", "#009e49"], dot: "#ce1126" }],
  ["NAM", "NAMIBIA", "NAM", "#003580", "#009543", 67, { plain: "#003580", dot: "#ffce00" }],
  ["ANG", "ANGOLA", "ANG", "#cc092f", "#000000", 69, { h: ["#cc092f", "#000000"], dot: "#ffcb00" }],
  ["MOZ", "MOZAMBIQUE", "MOZ", "#007168", "#000000", 67, { h: ["#007168", "#000000", "#ffd100"], dot: "#d21034" }],
  ["GAM", "GAMBIA", "GAM", "#3a7728", "#0c1c8c", 67, { h: ["#ce1126", "#ffffff", "#0c1c8c"], dot: "#3a7728" }],
  ["SLE", "SIERRA LEONE", "SLE", "#1eb53a", "#0072c6", 66, { h: ["#1eb53a", "#ffffff", "#0072c6"] }],
  ["TOG", "TOGO", "TOG", "#006a4e", "#ffce00", 66, { h: ["#006a4e", "#ffce00"], dot: "#d21034" }],
  ["TAN", "TANZANIA", "TAN", "#1eb53a", "#00a3dd", 66, { h: ["#1eb53a", "#000000", "#00a3dd"], dot: "#fcd116" }],
  ["ZIM", "ZIMBABWE", "ZIM", "#006400", "#ffd200", 66, { h: ["#006400", "#ffd200", "#d40000"], dot: "#000000" }],
  ["CTA", "CENTRAL AFRICAN REP", "CTA", "#003082", "#d21034", 65, { h: ["#0033a0", "#ffffff", "#289728"], dot: "#ffce00" }],
  ["MWI", "MALAWI", "MWI", "#000000", "#ce1126", 65, { h: ["#000000", "#ce1126", "#339e35"], dot: "#ce1126" }],
  ["LBY", "LIBYA", "LBY", "#239e46", "#000000", 66, { h: ["#e70013", "#000000", "#239e46"], dot: "#ffffff" }],
  ["NIG", "NIGER", "NIG", "#e05206", "#0db02b", 65, { h: ["#e05206", "#ffffff", "#0db02b"], dot: "#e05206" }],
  ["COM", "COMOROS", "COM", "#3d8e33", "#ffffff", 66, { plain: "#3d8e33", dot: "#ffffff" }],
  ["SDN", "SUDAN", "SDN", "#d21034", "#000000", 65, { h: ["#d21034", "#ffffff", "#000000"], dot: "#007229" }],
  ["RWA", "RWANDA", "RWA", "#00a1de", "#20603d", 64, { h: ["#00a1de", "#fad201", "#20603d"], dot: "#e5be01" }],
  ["BDI", "BURUNDI", "BDI", "#ce1126", "#1eb53a", 64, { plain: "#1eb53a", dot: "#ce1126" }],
  ["ETH", "ETHIOPIA", "ETH", "#078930", "#fcdd09", 63, { h: ["#078930", "#fcdd09", "#da121a"], dot: "#0f47af" }],
  ["SWZ", "ESWATINI", "SWZ", "#3e5eb9", "#ffd900", 62, { h: ["#3e5eb9", "#ffd900", "#b10c0c"], dot: "#000000" }],
  ["BOT", "BOTSWANA", "BOT", "#75aadb", "#000000", 63, { plain: "#75aadb", dot: "#000000" }],
  ["LBR", "LIBERIA", "LBR", "#bf0a30", "#002868", 63, { h: ["#bf0a30", "#ffffff"], dot: "#002868" }],
  ["LES", "LESOTHO", "LES", "#00209f", "#009543", 61, { h: ["#00209f", "#ffffff", "#009543"], dot: "#000000" }],
  ["SSD", "SOUTH SUDAN", "SSD", "#000000", "#0f47af", 59, { h: ["#000000", "#da121a", "#078930"], dot: "#0f47af" }],
  ["MRI", "MAURITIUS", "MRI", "#ea2839", "#1a206d", 58, { h: ["#ea2839", "#1a206d", "#ffd500", "#00a04d"] }],
  ["CHA", "CHAD", "CHA", "#002664", "#c60c30", 57, { v: ["#002664", "#fecb00", "#c60c30"] }],
  ["STP", "SAO TOME", "STP", "#12ad2b", "#d21034", 55, { h: ["#12ad2b", "#ffce00", "#12ad2b"], dot: "#d21034" }],
  ["DJI", "DJIBOUTI", "DJI", "#6ab2e7", "#12ad2b", 54, { h: ["#6ab2e7", "#12ad2b"], dot: "#ffffff" }],
  ["SEY", "SEYCHELLES", "SEY", "#003f87", "#fcd856", 53, { v: ["#003f87", "#fcd856", "#d62828", "#ffffff", "#007a3d"] }],
  ["ERI", "ERITREA", "ERI", "#4189dd", "#12ad2b", 54, { h: ["#12ad2b", "#4189dd"], dot: "#be0027" }],
  ["SOM", "SOMALIA", "SOM", "#4189dd", "#ffffff", 53, { plain: "#4189dd", dot: "#ffffff" }],
  // --- Inter-confederation play-off opponent in the CAF team's path (OFC) ---
  ["NCL", "NEW CALEDONIA", "NCL", "#ed1c24", "#009543", 60, { h: ["#009543", "#ed1c24", "#0035ad"], dot: "#fcd116" }],
  // --- CONMEBOL teams not in the 2026 WC field (South American road) ---
  ["VEN", "VENEZUELA", "VEN", "#7b1113", "#ffffff", 74, { h: ["#ffce00", "#0033a0", "#cf142b"] }],
  ["CHL", "CHILE", "CHL", "#d52b1e", "#0c2340", 78, { h: ["#ffffff", "#d52b1e"], dot: "#0039a6" }],
  ["PER", "PERU", "PER", "#ffffff", "#d91023", 78, { v: ["#d91023", "#ffffff", "#d91023"] }],
  // --- CONCACAF teams not already listed (Central/N American road; hosts excluded) ---
  ["HON", "HONDURAS", "HON", "#ffffff", "#0073cf", 73, { h: ["#0073cf", "#ffffff", "#0073cf"], dot: "#0073cf" }],
  ["GUA", "GUATEMALA", "GUA", "#4997d0", "#ffffff", 70, { v: ["#4997d0", "#ffffff", "#4997d0"], dot: "#4997d0" }],
  ["SLV", "EL SALVADOR", "SLV", "#0f47af", "#ffffff", 69, { h: ["#0f47af", "#ffffff", "#0f47af"], dot: "#0f47af" }],
  ["TRI", "TRINIDAD", "TRI", "#e00000", "#000000", 69, { plain: "#da1a35", dot: "#000000" }],
  ["NCA", "NICARAGUA", "NCA", "#0067c6", "#ffffff", 65, { h: ["#0067c6", "#ffffff", "#0067c6"], dot: "#0067c6" }],
  ["DOM", "DOMINICAN REP", "DOM", "#002d62", "#ce1126", 63, { h: ["#002d62", "#ffffff", "#ce1126"], dot: "#ffffff" }],
  ["GUY", "GUYANA", "GUY", "#009e49", "#000000", 62, { plain: "#009e49", dot: "#fcd116" }],
  ["PUR", "PUERTO RICO", "PUR", "#ed0000", "#0050a4", 61, { h: ["#ed0000", "#ffffff", "#ed0000"], dot: "#0050a4" }],
  ["SKN", "ST KITTS & NEVIS", "SKN", "#009e49", "#000000", 61, { plain: "#009e49", dot: "#ffd700" }],
  ["ATG", "ANTIGUA", "ATG", "#ce1126", "#000000", 60, { plain: "#ce1126", dot: "#ffd100" }],
  ["GRN", "GRENADA", "GRN", "#ce1126", "#007a3d", 60, { h: ["#ce1126", "#fcd116", "#007a3d"], dot: "#ce1126" }],
  ["CUB", "CUBA", "CUB", "#cf142b", "#002a8f", 60, { h: ["#002a8f", "#ffffff", "#002a8f"], dot: "#cf142b" }],
  ["LCA", "ST LUCIA", "LCA", "#66ccff", "#000000", 59, { plain: "#66ccff", dot: "#ffffff" }],
  ["BER", "BERMUDA", "BER", "#c8102e", "#002868", 59, { plain: "#c8102e", dot: "#002868" }],
  ["VIN", "ST VINCENT", "VIN", "#0072c6", "#fcd116", 58, { v: ["#0072c6", "#fcd116", "#1eb53a"] }],
  ["MSR", "MONTSERRAT", "MSR", "#006da4", "#ffffff", 57, { plain: "#006da4", dot: "#fcd116" }],
  ["BRB", "BARBADOS", "BRB", "#00267f", "#ffc726", 57, { v: ["#00267f", "#ffc726", "#00267f"], dot: "#000000" }],
  ["BLZ", "BELIZE", "BLZ", "#ce1126", "#003f87", 56, { plain: "#003f87", dot: "#ce1126" }],
  ["DMA", "DOMINICA", "DMA", "#006b3f", "#000000", 56, { plain: "#006b3f", dot: "#d41c30" }],
  ["ARU", "ARUBA", "ARU", "#418fde", "#f9d616", 55, { plain: "#418fde", dot: "#f9d616" }],
  ["CAY", "CAYMAN ISLANDS", "CAY", "#ba0c2f", "#00205b", 54, { plain: "#00205b", dot: "#ba0c2f" }],
  ["TCA", "TURKS & CAICOS", "TCA", "#003f87", "#ffffff", 52, { plain: "#003f87", dot: "#ffd100" }],
  ["BAH", "BAHAMAS", "BAH", "#00abc9", "#000000", 52, { h: ["#00abc9", "#ffc72c", "#00abc9"], dot: "#000000" }],
  ["VIR", "US VIRGIN IS", "VIR", "#0050a4", "#ffffff", 51, { plain: "#ffffff", dot: "#0050a4" }],
  ["VGB", "BRITISH VIRGIN IS", "VGB", "#012169", "#ffffff", 51, { plain: "#012169", dot: "#ffffff" }],
  ["AIA", "ANGUILLA", "AIA", "#ffffff", "#012169", 50, { plain: "#ffffff", dot: "#f47b20" }],
  // --- OFC teams not already listed (Oceania road; NZL/NCL already exist) ---
  ["SOL", "SOLOMON ISLANDS", "SOL", "#0051ba", "#215b33", 60, { plain: "#0051ba", dot: "#fcd116" }],
  ["FIJ", "FIJI", "FIJ", "#6cace4", "#ffffff", 60, { plain: "#6cace4", dot: "#ce1126" }],
  ["TAH", "TAHITI", "TAH", "#e8112d", "#ffffff", 59, { h: ["#e8112d", "#ffffff", "#e8112d"], dot: "#e8112d" }],
  ["VAN", "VANUATU", "VAN", "#d21034", "#000000", 58, { plain: "#009543", dot: "#fdce12" }],
  ["PNG", "PAPUA NEW GUINEA", "PNG", "#ce1126", "#000000", 57, { plain: "#ce1126", dot: "#fcd116" }],
  ["COK", "COOK ISLANDS", "COK", "#00966c", "#ffffff", 52, { plain: "#00247d", dot: "#ffffff" }],
  ["SAM", "SAMOA", "SAM", "#002b7f", "#ce1126", 52, { plain: "#002b7f", dot: "#ce1126" }],
  ["ASA", "AMERICAN SAMOA", "ASA", "#0050a4", "#ffffff", 50, { plain: "#0050a4", dot: "#ffffff" }],
  ["TGA", "TONGA", "TGA", "#c10000", "#ffffff", 50, { plain: "#c10000", dot: "#ffffff" }],
  // --- UEFA teams not already listed (European road; Russia excluded) ---
  ["SVK", "SLOVAKIA", "SVK", "#0b4ea2", "#ee1c25", 78, { h: ["#ffffff", "#0b4ea2", "#ee1c25"], dot: "#ee1c25" }],
  ["SVN", "SLOVENIA", "SVN", "#ffffff", "#005da4", 76, { h: ["#ffffff", "#005da4", "#ed1c24"], dot: "#005da4" }],
  ["NIR", "NORTHERN IRELAND", "NIR", "#00843d", "#ffffff", 73, { plain: "#00843d", dot: "#ffffff" }],
  ["NMK", "N MACEDONIA", "NMK", "#d20000", "#ffe600", 73, { plain: "#d20000", dot: "#ffe600" }],
  ["ALB", "ALBANIA", "ALB", "#e41e20", "#000000", 73, { plain: "#e41e20", dot: "#000000" }],
  ["GEO", "GEORGIA", "GEO", "#ffffff", "#da291c", 72, { plain: "#ffffff", dot: "#da291c" }],
  ["LUX", "LUXEMBOURG", "LUX", "#ed2939", "#ffffff", 68, { h: ["#ed2939", "#ffffff", "#00a1de"], dot: "#00a1de" }],
  ["MNE", "MONTENEGRO", "MNE", "#c40308", "#ffffff", 70, { plain: "#c40308", dot: "#d4af37" }],
  ["ARM", "ARMENIA", "ARM", "#d90012", "#0033a0", 66, { h: ["#d90012", "#0033a0", "#f2a800"] }],
  ["KVX", "KOSOVO", "KVX", "#244aa5", "#ffffff", 66, { plain: "#244aa5", dot: "#d0a650" }],
  ["AZE", "AZERBAIJAN", "AZE", "#00b5e2", "#ed2939", 62, { h: ["#00b5e2", "#ed2939", "#3f9c35"], dot: "#ffffff" }],
  ["BLR", "BELARUS", "BLR", "#d22730", "#007c30", 64, { h: ["#d22730", "#007c30"], dot: "#ffffff" }],
  ["KAZ", "KAZAKHSTAN", "KAZ", "#00afca", "#ffffff", 63, { plain: "#00afca", dot: "#fec50c" }],
  ["CYP", "CYPRUS", "CYP", "#ffffff", "#d57800", 63, { plain: "#ffffff", dot: "#d57800" }],
  ["LVA", "LATVIA", "LVA", "#9e3039", "#ffffff", 58, { h: ["#9e3039", "#ffffff", "#9e3039"], dot: "#9e3039" }],
  ["LTU", "LITHUANIA", "LTU", "#fdb913", "#006a44", 57, { h: ["#fdb913", "#006a44", "#c1272d"] }],
  ["EST", "ESTONIA", "EST", "#0072ce", "#000000", 60, { h: ["#0072ce", "#000000", "#ffffff"] }],
  ["FRO", "FAROE ISLANDS", "FRO", "#ffffff", "#0065bd", 56, { nordic: { field: "#ffffff", cross: "#0065bd", inner: "#ed2939" } }],
  ["MLT", "MALTA", "MLT", "#ffffff", "#cf142b", 54, { v: ["#ffffff", "#cf142b"], dot: "#cf142b" }],
  ["MDA", "MOLDOVA", "MDA", "#0046ae", "#ffd200", 56, { v: ["#0046ae", "#ffd200", "#cc092f"] }],
  ["AND", "ANDORRA", "AND", "#10069f", "#ffffff", 50, { v: ["#10069f", "#fedf00", "#d50032"] }],
  ["GIB", "GIBRALTAR", "GIB", "#da020e", "#ffffff", 50, { h: ["#ffffff", "#da020e"], dot: "#da020e" }],
  ["SMR", "SAN MARINO", "SMR", "#5eb6e4", "#ffffff", 48, { h: ["#ffffff", "#5eb6e4"], dot: "#5eb6e4" }],
  ["LIE", "LIECHTENSTEIN", "LIE", "#00237e", "#ce1126", 50, { h: ["#00237e", "#ce1126"], dot: "#ffd83d" }],
];

// Confederation membership for every nation. Used by the "Road to the World
// Cup" mode (each confederation runs its own qualification) and shown as a tag.
const CONFED = {
  // CONCACAF
  USA: "CONCACAF", MEX: "CONCACAF", CAN: "CONCACAF", PAN: "CONCACAF", HAI: "CONCACAF",
  CUW: "CONCACAF", CRC: "CONCACAF", JAM: "CONCACAF", SUR: "CONCACAF",
  HON: "CONCACAF", GUA: "CONCACAF", SLV: "CONCACAF", TRI: "CONCACAF", NCA: "CONCACAF",
  DOM: "CONCACAF", GUY: "CONCACAF", PUR: "CONCACAF", SKN: "CONCACAF", ATG: "CONCACAF",
  GRN: "CONCACAF", CUB: "CONCACAF", LCA: "CONCACAF", BER: "CONCACAF", VIN: "CONCACAF",
  MSR: "CONCACAF", BRB: "CONCACAF", BLZ: "CONCACAF", DMA: "CONCACAF", ARU: "CONCACAF",
  CAY: "CONCACAF", TCA: "CONCACAF", BAH: "CONCACAF", VIR: "CONCACAF", VGB: "CONCACAF",
  AIA: "CONCACAF",
  // CONMEBOL
  BRA: "CONMEBOL", ARG: "CONMEBOL", URU: "CONMEBOL", COL: "CONMEBOL", ECU: "CONMEBOL",
  PAR: "CONMEBOL", BOL: "CONMEBOL", VEN: "CONMEBOL", CHL: "CONMEBOL", PER: "CONMEBOL",
  // UEFA
  FRA: "UEFA", ESP: "UEFA", ENG: "UEFA", POR: "UEFA", NED: "UEFA", GER: "UEFA", BEL: "UEFA",
  CRO: "UEFA", SUI: "UEFA", NOR: "UEFA", AUT: "UEFA", SWE: "UEFA", TUR: "UEFA", CZE: "UEFA",
  SCO: "UEFA", BIH: "UEFA", ITA: "UEFA", DEN: "UEFA", SRB: "UEFA", POL: "UEFA", UKR: "UEFA",
  HUN: "UEFA", GRE: "UEFA", WAL: "UEFA", ROU: "UEFA", IRL: "UEFA", ISR: "UEFA", FIN: "UEFA",
  ISL: "UEFA", RUS: "UEFA", BUL: "UEFA",
  SVK: "UEFA", SVN: "UEFA", NIR: "UEFA", NMK: "UEFA", ALB: "UEFA", GEO: "UEFA",
  LUX: "UEFA", MNE: "UEFA", ARM: "UEFA", KVX: "UEFA", AZE: "UEFA", BLR: "UEFA",
  KAZ: "UEFA", CYP: "UEFA", LVA: "UEFA", LTU: "UEFA", EST: "UEFA", FRO: "UEFA",
  MLT: "UEFA", MDA: "UEFA", AND: "UEFA", GIB: "UEFA", SMR: "UEFA", LIE: "UEFA",
  // CAF
  MAR: "CAF", SEN: "CAF", ALG: "CAF", CIV: "CAF", EGY: "CAF", GHA: "CAF", TUN: "CAF",
  RSA: "CAF", COD: "CAF", CPV: "CAF", NGA: "CAF", CMR: "CAF", MLI: "CAF",
  BFA: "CAF", GUI: "CAF", ZAM: "CAF", GAB: "CAF", EQG: "CAF", UGA: "CAF", BEN: "CAF",
  MTN: "CAF", KEN: "CAF", CGO: "CAF", MAD: "CAF", GNB: "CAF", NAM: "CAF", ANG: "CAF",
  MOZ: "CAF", GAM: "CAF", SLE: "CAF", TOG: "CAF", TAN: "CAF", ZIM: "CAF", CTA: "CAF",
  MWI: "CAF", LBY: "CAF", NIG: "CAF", COM: "CAF", SDN: "CAF", RWA: "CAF", BDI: "CAF",
  ETH: "CAF", SWZ: "CAF", BOT: "CAF", LBR: "CAF", LES: "CAF", SSD: "CAF", MRI: "CAF",
  CHA: "CAF", STP: "CAF", DJI: "CAF", SEY: "CAF", ERI: "CAF", SOM: "CAF",
  // AFC
  JPN: "AFC", KOR: "AFC", AUS: "AFC", IRN: "AFC", KSA: "AFC", QAT: "AFC", IRQ: "AFC",
  UZB: "AFC", JOR: "AFC", CHN: "AFC", IND: "AFC", UAE: "AFC", OMA: "AFC", BHR: "AFC",
  SYR: "AFC", VIE: "AFC", PLE: "AFC", KGZ: "AFC", LIB: "AFC", TJK: "AFC", THA: "AFC",
  PRK: "AFC", PHI: "AFC", MAS: "AFC", KUW: "AFC", TKM: "AFC", HKG: "AFC", IDN: "AFC",
  TPE: "AFC", MDV: "AFC", YEM: "AFC", AFG: "AFC", SGP: "AFC", MYA: "AFC", NEP: "AFC",
  CAM: "AFC", MAC: "AFC", MNG: "AFC", BHU: "AFC", LAO: "AFC", BAN: "AFC", BRU: "AFC",
  TLS: "AFC", PAK: "AFC", GUM: "AFC", SRI: "AFC",
  // OFC
  NZL: "OFC", NCL: "OFC", SOL: "OFC", FIJ: "OFC", TAH: "OFC", VAN: "OFC",
  PNG: "OFC", COK: "OFC", SAM: "OFC", ASA: "OFC", TGA: "OFC",
};

// FIFA Men's World Ranking (used to seed qualification draws — some rounds pot
// teams by rank). AFC values match the rankings used for the real 2026 draws.
const FIFA_RANK = {
  ARG: 1, ESP: 2, FRA: 3, ENG: 4, BRA: 5, POR: 6, NED: 7, BEL: 8, ITA: 9, GER: 10,
  CRO: 11, MAR: 12, COL: 13, URU: 14, USA: 15, MEX: 16, SEN: 17, SUI: 18, DEN: 19,
  JPN: 20, IRN: 22, ECU: 24, AUT: 23, AUS: 27, KOR: 28, SWE: 25, UKR: 26, TUR: 29,
  PAN: 30, POL: 31, RUS: 33, WAL: 34, ALG: 35, EGY: 36, HUN: 37, NOR: 38, TUN: 39,
  CIV: 40, NGA: 41, SCO: 42, CZE: 43, CMR: 44, GRE: 45, MLI: 46, ROU: 47, PAR: 48,
  KSA: 54, CRC: 55, COD: 56, RSA: 58, IRL: 59, ISR: 60, FIN: 66, CPV: 67, ISL: 72,
  BIH: 75, BOL: 76, HAI: 81, CUW: 82, BUL: 84, NZL: 89, JAM: 71,
  QAT: 59, IRQ: 70, UAE: 72, OMA: 73, UZB: 74, CHN: 80, JOR: 82, BHR: 86, SYR: 94,
  VIE: 95, PLE: 96, KGZ: 97, IND: 99, LIB: 100, TJK: 110, THA: 113, PRK: 115,
  PHI: 135, MAS: 136, KUW: 137, TKM: 138, HKG: 149, IDN: 150, TPE: 153, MDV: 155,
  YEM: 156, AFG: 157, SGP: 158, MYA: 160, NEP: 175, CAM: 176, MAC: 182, MNG: 183,
  BHU: 185, LAO: 187, BAN: 189, BRU: 190, TLS: 192, PAK: 201, GUM: 203, SRI: 204,
  SUR: 123, GHA: 59, VEN: 54, CHL: 40, PER: 32,
  // CONCACAF entrants (approx)
  HON: 65, GUA: 97, SLV: 100, TRI: 102, NCA: 131, DOM: 144, GUY: 150, PUR: 154,
  SKN: 155, ATG: 162, GRN: 163, CUB: 164, LCA: 166, BER: 167, VIN: 170, MSR: 176,
  BRB: 179, BLZ: 180, DMA: 182, ARU: 190, CAY: 197, TCA: 205, BAH: 207, VIR: 208,
  VGB: 209, AIA: 210,
  // CAF entrants (ranks around the 2023 draw)
  BFA: 55, GUI: 80, ZAM: 84, GAB: 85, EQG: 91, UGA: 92, BEN: 93, MTN: 99, KEN: 105,
  CGO: 106, MAD: 107, GNB: 111, NAM: 112, ANG: 114, MOZ: 117, GAM: 119, SLE: 120,
  TOG: 122, TAN: 123, ZIM: 124, CTA: 125, MWI: 126, LBY: 127, NIG: 128, COM: 130,
  SDN: 131, RWA: 139, BDI: 140, ETH: 143, SWZ: 146, BOT: 147, LBR: 148, LES: 152,
  SSD: 168, MRI: 180, CHA: 181, STP: 187, DJI: 193, SEY: 196, ERI: 198, SOM: 199,
  NCL: 149,
  // OFC entrants
  SOL: 153, FIJ: 154, TAH: 157, VAN: 160, PNG: 168, COK: 188, SAM: 190, ASA: 192, TGA: 199,
  // UEFA entrants (approx)
  SVK: 45, SVN: 55, NIR: 70, NMK: 65, ALB: 66, GEO: 75, LUX: 90, MNE: 75, ARM: 95,
  KVX: 96, AZE: 115, BLR: 98, KAZ: 100, CYP: 105, LVA: 135, LTU: 140, EST: 118,
  FRO: 136, MLT: 168, MDA: 155, AND: 150, GIB: 195, SMR: 210, LIE: 200,
};

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
    confed: CONFED[key] || "UEFA",
    fifaRank: FIFA_RANK[key] || 150,
    drawFlag,
    away: { shirt: awShirt, shirtDark: darken(awShirt), shorts: awShorts, gk: pickGk(awShirt) },
  };
}

export function teamOvr(key) {
  return NATIONS[key].ovr;
}

// All nation keys in a confederation, strongest (best FIFA rank) first.
export function keysByConfed(confed) {
  return NATION_KEYS.filter((k) => NATIONS[k].confed === confed).sort(
    (a, b) => NATIONS[a].fifaRank - NATIONS[b].fifaRank
  );
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
  UAE:"ae", OMA:"om", BHR:"bh", SYR:"sy", VIE:"vn", PLE:"ps", KGZ:"kg", LIB:"lb",
  TJK:"tj", THA:"th", PRK:"kp", PHI:"ph", MAS:"my", KUW:"kw", TKM:"tm",
  HKG:"hk", IDN:"id", TPE:"tw", MDV:"mv", YEM:"ye", AFG:"af", SGP:"sg", MYA:"mm",
  NEP:"np", CAM:"kh", MAC:"mo", MNG:"mn", BHU:"bt", LAO:"la", BAN:"bd", BRU:"bn",
  TLS:"tl", PAK:"pk", GUM:"gu", SRI:"lk", BOL:"bo", SUR:"sr",
  BFA:"bf", GUI:"gn", ZAM:"zm", GAB:"ga", EQG:"gq", UGA:"ug", BEN:"bj", MTN:"mr",
  KEN:"ke", CGO:"cg", MAD:"mg", GNB:"gw", NAM:"na", ANG:"ao", MOZ:"mz", GAM:"gm",
  SLE:"sl", TOG:"tg", TAN:"tz", ZIM:"zw", CTA:"cf", MWI:"mw", LBY:"ly", NIG:"ne",
  COM:"km", SDN:"sd", RWA:"rw", BDI:"bi", ETH:"et", SWZ:"sz", BOT:"bw", LBR:"lr",
  LES:"ls", SSD:"ss", MRI:"mu", CHA:"td", STP:"st", DJI:"dj", SEY:"sc", ERI:"er",
  SOM:"so", NCL:"nc", VEN:"ve", CHL:"cl", PER:"pe",
  HON:"hn", GUA:"gt", SLV:"sv", TRI:"tt", NCA:"ni", DOM:"do", GUY:"gy", PUR:"pr",
  SKN:"kn", ATG:"ag", GRN:"gd", CUB:"cu", LCA:"lc", BER:"bm", VIN:"vc", MSR:"ms",
  BRB:"bb", BLZ:"bz", DMA:"dm", ARU:"aw", CAY:"ky", TCA:"tc", BAH:"bs", VIR:"vi",
  VGB:"vg", AIA:"ai",
  SOL:"sb", FIJ:"fj", TAH:"pf", VAN:"vu", PNG:"pg", COK:"ck", SAM:"ws", ASA:"as", TGA:"to",
  SVK:"sk", SVN:"si", NIR:"gb-nir", NMK:"mk", ALB:"al", GEO:"ge", LUX:"lu", MNE:"me",
  ARM:"am", KVX:"xk", AZE:"az", BLR:"by", KAZ:"kz", CYP:"cy", LVA:"lv", LTU:"lt",
  EST:"ee", FRO:"fo", MLT:"mt", MDA:"md", AND:"ad", GIB:"gi", SMR:"sm", LIE:"li",
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
