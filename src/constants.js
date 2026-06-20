// Internal (pixel) resolution. Everything is drawn at this size then scaled up
// with nearest-neighbour sampling for a chunky retro look.
export const VIEW_W = 640;
export const VIEW_H = 416;

// Marked pitch rectangle. Sits inside a grass runoff which is itself ringed by
// the stadium stands. Proportions are close to a real ~105x68m pitch.
export const FIELD = {
  left: 48,
  top: 50,
  right: 592,
  bottom: 366,
};
FIELD.width = FIELD.right - FIELD.left; // 544
FIELD.height = FIELD.bottom - FIELD.top; // 316
FIELD.cx = (FIELD.left + FIELD.right) / 2;
FIELD.cy = (FIELD.top + FIELD.bottom) / 2;

export const RUNOFF = 13; // grass margin between the lines and the stands

// Goal mouth (vertical extent of the scoring zone on each end line).
export const GOAL_HALF = 26; // half-height of the goal mouth
export const GOAL_DEPTH = 13; // how far the net pokes out past the end line

// Pitch markings (pixels), proportioned from a real pitch.
export const CENTER_R = 41; // centre circle radius
export const PEN_BOX_DEPTH = 80; // 18-yard box depth from goal line
export const PEN_BOX_HALF = 90; // half-height of the 18-yard box
export const SIX_BOX_DEPTH = 26; // 6-yard box depth
export const SIX_BOX_HALF = 41; // half-height of the 6-yard box
export const PEN_SPOT_DIST = 53; // penalty spot distance from goal line
export const PEN_ARC_R = 41; // penalty arc ("D") radius
export const CORNER_R = 7; // corner arc radius

// Entity sizes (radii, in pixels).
export const PLAYER_R = 5.5;
export const BALL_R = 2.7;

// Ball control.
export const CONTROL_RADIUS = 12; // how close you must be to trap/dribble
export const GK_REACH = 16; // keeper claim radius — buffed a touch so dives reach the corner shots the smarter strikers now pick
export const GK_REACTION = 0.115; // seconds before a keeper commits to a struck shot — sharpened a little so keepers read a placed shot quicker, while a well-struck or well-placed one can still beat them
export const DRIBBLE_OFFSET = 9; // how far ahead of a carrier the ball sits
export const BALL_FRICTION = 0.974; // per-tick velocity decay (lets the ball glide)

// Movement speeds (pixels / second). Deliberate, real-football pace.
export const PLAYER_SPEED = 44;
export const SPRINT_MULT = 1.45;
export const GK_SPEED = 74; // keepers stay sharp so shots get saved — buffed a touch so they set and dive a hair quicker
export const PLAYER_ACCEL = 240; // px/s^2 — gives players weight/momentum

// Control / marking. On defense the human clicks the man they want (or flicks the
// kick toward him — see switchPick) — there is no automatic player switching.
export const MARK_DIST = 16; // how far goal-side a defender sits off their man

// Kicking. The human's mouse kick spans this whole range via charge: a light
// tap is a soft pass, a full charge is a rocket shot.
export const KICK_MIN = 140;
export const KICK_MAX = 300;
export const CHARGE_TIME = 0.6; // seconds for the meter to sweep one way; it then ping-pongs
export const KICK_FREE_TIME = 0.34; // ball is "loose" this long after a kick
export const PASS_POWER = 175; // AI base pass speed (scales up with distance)
export const PASS_POWER_MAX = 300;
// A kick aimed at a teammate is a pass: for this long after it's struck the ball
// resists being picked off by the other side (see the pass-interception guard).
export const PASS_GUARD_TIME = 1.6;
// Pass magnet — when YOU (the human side) pass, the intended receiver auto-pulls
// the ball to their feet within this radius, which grows with team OVR (a sharper
// side controls passes from further out). Classic mode uses the floor.
export const PASS_MAGNET_MIN = 16;
export const PASS_MAGNET_MAX = 42; // elite end trimmed (was 48) so a top side's passing edge is smaller; floor unchanged

// Stealing — a deliberate, committed lunge (the defender presses F), not the old
// passive auto-steal. Positioning + timing win the ball; whiff it and you're
// briefly committed (cooldown) while the carrier escapes. That trade is what
// makes a steal feel earned instead of random, and keeps possession on the pitch
// longer for both sides.
export const STEAL_RANGE = 18; // a lunge that lands within this of the carrier can win it
export const STEAL_LUNGE_TIME = 0.24; // active window of a lunge — the steal connects during this
export const STEAL_LUNGE_SPEED = 122; // forward burst speed while lunging (a real dart)
export const STEAL_COOLDOWN = 0.65; // wait before you can lunge again (a whiff costs you)
export const STEAL_CHANCE = 0.5; // a challenge in range is a coin flip — 50/50 win it or lose it
export const STEAL_FAIL_HOLD = 0.85; // lose the coin flip and the carrier is protected this long (can't be robbed again)
export const STEAL_PROMPT_RANGE = 65; // show the "press F" prompt when this close to the carrier
export const STEAL_MAX_CHANCE = 0.80; // ceiling on human steal success — perfect timing gives 80%
export const AI_LUNGE_RATE = 0.97; // AI lunge attempts per second when in range (lower = you keep the ball longer)
export const TACKLE_COOLDOWN = 0.4; // ball's grace window after any turnover
export const POSSESSION_GRACE = 0.45; // a fresh receiver can't be robbed this long

// Match.
export const MATCH_SECONDS = 120; // real seconds in a match
export const MATCH_MINUTES = 90; // displayed clock counts to this
export const GOAL_CELEBRATION = 1.8;
export const KICKOFF_PAUSE = 0.8;
export const SETPIECE_LABEL = 1.3; // how long a "THROW IN"/"CORNER" label shows
export const HALFTIME_DURATION = 3.5; // seconds the halftime screen is shown before auto-advancing
// Stoppage time added at full time: random range in real seconds (≈1–3 match minutes).
export const STOPPAGE_MIN = 1.5;
export const STOPPAGE_MAX = 4.5;

// Game states.
export const STATE = {
  TITLE: "title",
  TEAM_SELECT: "team_select", // pick your team, then the opponent (feature-gated)
  SQUAD: "squad", // pre-match lineup / OVR / substitutions (feature-gated)
  WC: "wc", // World Cup front-end: mode select, nation pick, tournament hub
  KICKOFF: "kickoff",
  PLAYING: "playing",
  GOAL: "goal",
  HALFTIME: "halftime",
  FULLTIME: "fulltime",
};

// How OVR (1-99) maps onto per-player ability. A neutral 78 sits near
// multiplier 1.0 so a mixed squad plays around classic pace; the spread is
// deliberately modest to keep matches competitive rather than blowouts.
export const OVR_MIN = 68; // floor of the useful rating band
export const OVR_MAX = 92; // ceiling of the useful rating band

// In-match substitutions allowed per side (real-football style).
export const MAX_SUBS = 5;
