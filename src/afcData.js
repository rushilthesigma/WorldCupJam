// ---------------------------------------------------------------------------
// AFC 2026 World Cup qualification entrant pools (verified against the real
// qualification record). All 46 AFC entrants; every key here exists in
// nations.js with confed:"AFC" and a fifaRank used for the seeded draws.
//
//   AFC_DIRECT  — the 26 highest-ranked teams: byes straight into Round 2.
//   AFC_ROUND1  — the 20 lowest-ranked teams: the Round 1 home-and-away knockout.
//   AFC_ICP     — the AFC team's inter-confederation play-off path. The AFC team
//                 is the seed; the play-in is Bolivia v Suriname and the seed
//                 plays the winner in a one-off final. (The other path —
//                 DR Congo's — is ignored and never touches an Asian slot.)
// ---------------------------------------------------------------------------

export const AFC_DIRECT = [
  "JPN", "IRN", "AUS", "KOR", "KSA", "QAT", "IRQ", "UAE", "OMA", "UZB",
  "CHN", "JOR", "BHR", "SYR", "VIE", "PLE", "KGZ", "IND", "LIB", "TJK",
  "THA", "PRK", "PHI", "MAS", "KUW", "TKM",
];

export const AFC_ROUND1 = [
  "HKG", "IDN", "TPE", "MDV", "YEM", "AFG", "SGP", "MYA", "NEP", "CAM",
  "MAC", "MNG", "BHU", "LAO", "BAN", "BRU", "TLS", "PAK", "GUM", "SRI",
];

export const AFC_ICP = {
  seeded: true,             // the AFC team is the seed (bye to the path final)
  opponents: ["BOL", "SUR"], // the play-in: Bolivia v Suriname; seed plays the winner
};
