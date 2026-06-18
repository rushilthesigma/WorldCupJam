// ---------------------------------------------------------------------------
// CONMEBOL 2026 World Cup qualification entrant pool.
//
//   CONMEBOL_TEAMS — all 10 South American members play one big league (double
//                    round-robin, 18 matchdays). The top 6 qualify directly for
//                    the World Cup; 7th place goes to the inter-confederation
//                    play-off.
//   CONMEBOL_ICP   — the CONMEBOL team is UNSEEDED in its play-off path (Path 2):
//                    it plays Suriname in the single-match play-in, then (if it
//                    wins) the seed Iraq in the final. Win the final and it takes
//                    a World Cup berth (displacing the path's regular winner).
// ---------------------------------------------------------------------------

export const CONMEBOL_TEAMS = [
  "ARG", "BRA", "URU", "COL", "ECU", "PAR", "BOL", "VEN", "CHL", "PER",
];

export const CONMEBOL_ICP = {
  seeded: false,             // the CONMEBOL team plays its way through the path
  opponents: ["SUR", "IRQ"], // play-in vs Suriname, then the seed (Iraq) in the final
};
