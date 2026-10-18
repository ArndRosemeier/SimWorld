/**
 * What the signs read of the town, per place (index = PlaceId of the planner's graph): the sim's
 * town face (`TownFace`, src/sim/view.ts) once it comes, the planner's places before. No three.js,
 * so the town workers can send the first facts. New in SimWorld.
 */
import type { Hours } from '../sim/places';

export interface SignFacts {
  /** What each place is now, an index into PLACE_KINDS. */
  kind: ArrayLike<number>;
  /** Its name now ('' for none). */
  name: readonly string[];
  /** LOOK_* flags (to let, for sale, new, struggling; src/sim/economy.ts). */
  flags: ArrayLike<number>;
  /** Its opening hours now. */
  hours: readonly (readonly Hours[])[];
}
