// ---------------------------------------------------------------------------
// OFC (Oceania) 2026 World Cup qualification entrant pools (verified). 2026 was
// OFC's first ever DIRECT World Cup berth: 1 direct + 1 inter-confederation
// play-off berth.
//
//   OFC_R1        — the 4 lowest-ranked members: a preliminary 4-team knockout
//                   (2 semis + a final); 1 winner advances to Round 2.
//   OFC_R2_DIRECT — the 7 highest-ranked members: byes to Round 2.
//   Round 2 = 8 teams (7 + R1 winner) in 2 groups of 4, single round-robin; top
//   2 of each group (4) reach Round 3 — a 4-team single-leg knockout. The final
//   WINNER qualifies directly; the final LOSER goes to the ICP.
//
//   OFC_ICP — the OFC team is unseeded in Path 1: it plays Jamaica in the play-in
//   (semi-final) and the DR Congo seed in the final. Win the final to take a
//   World Cup berth (DR Congo's slot in the 2026 field).
// ---------------------------------------------------------------------------

export const OFC_R2_DIRECT = ["NZL", "NCL", "SOL", "FIJ", "TAH", "VAN", "PNG"];

export const OFC_R1 = ["COK", "SAM", "ASA", "TGA"];

export const OFC_ICP = {
  seeded: false,
  opponents: ["JAM", "COD"], // play-in vs Jamaica, then the DR Congo seed
  slot: "COD",
};
