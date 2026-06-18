// ---------------------------------------------------------------------------
// Save files — localStorage-backed slots for World Cup / Road campaigns.
//
// A "campaign" is a multi-match run: a World Cup tournament (tournament.js `t`)
// or a Road to the World Cup qualification (afc.js `q`). Both are pure-data
// objects, so a save is just JSON. Single Quick Play / Autoplay matches aren't
// campaigns and aren't saved.
//
// Slots are fixed (SLOTS of them). Each holds one campaign plus a little summary
// (team + stage + timestamp) so the load screen can describe it without having
// to rebuild the whole tournament. `v` is a schema version: a slot written by an
// older/newer build is treated as empty rather than crashing the loader.
// ---------------------------------------------------------------------------

export const SLOTS = 3;
const KEY = "wcjam.saves";
const VERSION = 2;

// Read the raw slot array, always normalised to length SLOTS. Any failure
// (no localStorage, malformed JSON, private-mode write block) degrades to "no
// saves" instead of throwing.
function readAll() {
  const empty = () => new Array(SLOTS).fill(null);
  try {
    if (typeof localStorage === "undefined") return empty();
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return empty();
    const out = parsed.slice(0, SLOTS);
    while (out.length < SLOTS) out.push(null);
    // Drop slots from an incompatible schema version.
    return out.map((s) => (s && s.v === VERSION ? s : null));
  } catch {
    return empty();
  }
}

function writeAll(slots) {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(KEY, JSON.stringify(slots));
    return true;
  } catch {
    return false;
  }
}

// The current state of every slot (null = empty), for the load/save screen.
export function listSlots() {
  return readAll();
}

export function loadSlot(i) {
  if (i < 0 || i >= SLOTS) return null;
  return readAll()[i];
}

// payload: { kind, youKey, label, data } — see wc.js campaignSnapshot().
// Returns the stored record (with v/ts stamped) or null if the write failed.
export function saveSlot(i, payload) {
  if (i < 0 || i >= SLOTS) return null;
  const slots = readAll();
  const rec = { v: VERSION, ts: Date.now(), ...payload };
  slots[i] = rec;
  return writeAll(slots) ? rec : null;
}

export function deleteSlot(i) {
  if (i < 0 || i >= SLOTS) return;
  const slots = readAll();
  slots[i] = null;
  writeAll(slots);
}

export function hasAnySave() {
  return readAll().some(Boolean);
}

// Short "how long ago" label for a save timestamp. Browser-side, so Date.now()
// is fine here.
export function relTime(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "JUST NOW";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "M AGO";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "H AGO";
  const d = Math.floor(h / 24);
  return d + "D AGO";
}
