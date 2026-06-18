// ---------------------------------------------------------------------------
// How the 48 World Cup places (GROUPS_2026) break down by confederation, so the
// road can rebuild the WHOLE field from simulated qualifying instead of copying
// the real 2026 result.
//
//   CONFED_DIRECT_SLOTS — the keys each confederation fills by DIRECT qualifying.
//   ICP_SLOTS           — the 2 places decided by the inter-confederation
//                         play-off (in the real field these went to Iraq + DR
//                         Congo; here they go to whoever wins the simulated ICP).
//   HOST_SLOTS          — the 3 hosts: automatic, never substituted.
//
// 43 direct + 2 ICP + 3 hosts = 48.
// ---------------------------------------------------------------------------

export const CONFED_DIRECT_SLOTS = {
  AFC: ["JPN", "KOR", "AUS", "IRN", "KSA", "QAT", "UZB", "JOR"],
  CAF: ["MAR", "SEN", "ALG", "CIV", "EGY", "GHA", "TUN", "RSA", "CPV"],
  CONMEBOL: ["BRA", "ARG", "URU", "COL", "ECU", "PAR"],
  CONCACAF: ["PAN", "HAI", "CUW"],
  OFC: ["NZL"],
  UEFA: ["FRA", "ESP", "ENG", "POR", "NED", "GER", "BEL", "CRO", "SUI", "NOR", "AUT", "SWE", "TUR", "CZE", "SCO", "BIH"],
};

// The two inter-confederation play-off berths (slots in the 2026 field).
export const ICP_SLOTS = ["IRQ", "COD"];

// Confederations that send a representative to the inter-confederation play-off
// and how many (CONCACAF, as a host confederation, sends two).
export const ICP_REP_COUNT = { AFC: 1, CAF: 1, CONMEBOL: 1, CONCACAF: 2, OFC: 1, UEFA: 0 };

export const HOST_SLOTS = ["USA", "MEX", "CAN"];
