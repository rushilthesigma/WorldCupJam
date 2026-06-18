# World Cup Jam ⚽

A retro pixel-art arcade football game. This first build is a complete, playable
single match between two national teams with full working controls.

**Brazil vs Argentina** — top-down pitch, goals left/right, real kit colours and
hand-drawn pixel flags (all art is generated in code, no external assets).

## Run

```bash
npm install
npm run dev
```

Then open the printed local URL and press **ENTER**.

## Controls

| Action | Keys |
| ------ | ---- |
| Move   | WASD or Arrow keys |
| Aim    | Mouse |
| Kick   | **Hold left-click** to charge along the arc — tap = pass, full charge = shot |
| Switch player | **E** (also auto-switches to the nearest defender) |
| Sprint | Shift (hold) |
| Pause  | **P** (or the on-screen button) |
| Start / replay | Enter |

You control the player on the ball. **Aim with the mouse** — a dotted arc shows
where your kick will go. A soft kick to a teammate is a pass (control follows the
receiver); a full-power kick is a shot. When defending, control auto-switches to
the player nearest the ball. Ball out of play gives **throw-ins, corners and goal
kicks**, like the real rules.

## What's implemented (mechanics)

- Fixed-timestep simulation (1/60s) with delta-time integration
- 6-a-side per team in a 2-2-1 formation (legal kickoff — everyone in own half)
- Ball possession: trap → dribble → pass / charged shot, with tackling turnovers
- Passing for both human and AI; a pass hands you control of the receiver
- Manual player switching + "control whoever has the ball" (no more flicker)
- AI roles: ball-presser, attacking off-ball runs, defensive shape that sits
  goal-side of the ball, dribble/shoot/pass decisions, and a keeper that
  distributes to an open teammate (no back-pass loop)
- Friction-tuned loose-ball physics with wall bounces
- Goal detection through the goal mouth, score + match-minute HUD, kickoff resets
- Match states: title → kickoff → playing → goal celebration → full time
- WebAudio sound effects (kick, pass, wall, goal, whistle) — no sound files
- 3×5 bitmap font for the scoreboard

## Saving your campaign

World Cup and Road to the World Cup runs can be saved to one of **3 named
slots** (single matches and Autoplay aren't campaigns, so they aren't saved).

- **Save** — hit **SAVE** in the tournament/road hub and pick a slot.
- **Load** — pick **LOAD GAME** on the mode screen to resume a saved run.
- Once a run is bound to a slot it **auto-saves** after every matchweek, so the
  slot always reflects your latest progress without re-saving by hand.

Saves live in `localStorage` (key `wcjam.saves`), so they survive a reload but
stay on the one device/browser. If storage is unavailable (private mode) the
game just keeps going without a save.

## Code map

- `src/constants.js` — pitch, speeds, timings, tuning
- `src/teams.js` — country kit colours + procedural pixel flags
- `src/font.js` — tiny bitmap font + text helpers
- `src/audio.js` — WebAudio blips
- `src/save.js` — localStorage save slots for campaigns
- `src/wc.js` — World Cup / Road front-end, hub screens, save/load UI
- `src/main.js` — input, entities, AI, physics, rendering, game loop

## Dev / testing hook

`window.__wcj` exposes `state`, `score`, `clock`, `ball`, `controlled`, plus
`start()`, `skipKickoff()`, `tick(n)`, `setFreeze(bool)`, `placeBall(x,y,vx,vy)`
for headless verification (the game advances via `requestAnimationFrame`, which
browsers throttle in background tabs).

Save slots also have hooks: `saveSlot(i)`, `loadSlot(i)`, `listSlots()`,
`deleteSlot(i)` (0-indexed).
