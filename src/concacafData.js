// ---------------------------------------------------------------------------
// CONCACAF 2026 World Cup qualification entrant pools (verified). The 3 hosts
// (USA, Mexico, Canada) auto-qualified and DID NOT enter — they are excluded.
//
//   CONCACAF_R1        — the 4 lowest-ranked entrants, two two-legged ties.
//   CONCACAF_DIRECT_R2 — the 28 higher-ranked entrants: byes straight to Round 2.
//   Round 2 = 30 teams (28 + 2 R1 winners) in 6 groups of 5, single round-robin;
//   top 2 of each group (12) reach Round 3 — 3 groups of 4, double round-robin.
//   3 group winners qualify directly; the 2 best runners-up reach the ICP.
//
//   CONCACAF_ICP — CONCACAF has TWO play-off entrants, drawn into SEPARATE paths
//   (FIFA's confederation-separation). Both are unseeded play-in teams: the
//   higher-ranked best runner-up takes Path 1 (play-in vs New Caledonia, then the
//   DR Congo seed); the other takes Path 2 (play-in vs Bolivia, then the Iraq
//   seed). We play whichever path the human's team is in; the other is ignored.
// ---------------------------------------------------------------------------

export const CONCACAF_DIRECT_R2 = [
  "PAN", "CRC", "HON", "JAM", "CUW", "HAI", "GUA", "SLV", "TRI", "SUR",
  "NCA", "DOM", "GUY", "PUR", "SKN", "ATG", "GRN", "CUB", "LCA", "BER",
  "VIN", "MSR", "BRB", "BLZ", "DMA", "ARU", "CAY", "BAH",
];

export const CONCACAF_R1 = ["TCA", "VIR", "VGB", "AIA"];

export const CONCACAF_ICP = {
  // Path 1 = the higher-ranked best runner-up; Path 2 = the other.
  paths: [
    { opponents: ["NCL", "COD"], slot: "COD" }, // play-in vs New Caledonia, then DR Congo seed
    { opponents: ["BOL", "IRQ"], slot: "IRQ" }, // play-in vs Bolivia, then Iraq seed
  ],
};
