// ---------------------------------------------------------------------------
// CAF 2026 World Cup qualification entrant pool (verified against the real
// qualification record). All 54 CAF members; every key exists in nations.js
// with confed:"CAF" and a fifaRank used for the seeded group draw.
//
//   CAF_TEAMS — the 54 entrants, drawn into 9 groups of 6 (double round-robin).
//               The 9 group winners qualify directly for the World Cup; the 4
//               best runners-up contest a single-elimination play-off (2 semis
//               + a final) and the winner takes CAF's inter-confederation
//               play-off berth.
//   CAF_ICP   — the CAF team's inter-confederation play-off path. The CAF team
//               is the seed (bye to the path final); the play-in is
//               Jamaica v New Caledonia and the seed plays the winner. (The
//               other path — Iraq's — is ignored and never touches a CAF slot.)
// ---------------------------------------------------------------------------

export const CAF_TEAMS = [
  "MAR", "SEN", "TUN", "ALG", "EGY", "NGA", "CMR", "MLI", "CIV", "BFA",
  "GHA", "RSA", "CPV", "COD", "GUI", "ZAM", "GAB", "EQG", "UGA", "BEN",
  "MTN", "KEN", "CGO", "MAD", "GNB", "NAM", "ANG", "MOZ", "GAM", "SLE",
  "TOG", "TAN", "ZIM", "CTA", "MWI", "LBY", "NIG", "COM", "SDN", "RWA",
  "BDI", "ETH", "SWZ", "BOT", "LBR", "LES", "SSD", "MRI", "CHA", "STP",
  "DJI", "SEY", "ERI", "SOM",
];

export const CAF_ICP = {
  seeded: true,              // the CAF team is the seed (bye to the path final)
  opponents: ["JAM", "NCL"], // the play-in: Jamaica v New Caledonia; seed plays the winner
};
