// Feature flags. Flip a value to turn a feature on across the whole game.
//
// teamSelect — the team-select / squad / OVR / substitutions experience.
//   While false the game is exactly the classic Brazil-vs-Argentina build:
//   title -> ENTER -> match. While true the title leads into picking your team
//   and the opponent, a pre-match squad screen, OVR-driven play, and in-match
//   substitutions. Kept OFF by design until it's deliberately switched on.
export const FEATURE = {
  teamSelect: true,
};
