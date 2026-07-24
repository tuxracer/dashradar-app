import {
  BEAT_LOOP_MS,
  CONTACT_APPEAR_MS,
  CONTACT_EXIT_MS,
  CONTACT_LANE_X,
  CONTACT_PASS_Z,
  CONTACT_SPAWN_Z,
  LOCK_FAR_Z,
  LOCK_NEAR_Z,
} from "./consts";

/** Where the police contact is (if anywhere) at a given time within the loop. */
export type ContactState =
  | { present: false }
  | {
      present: true;
      x: number;
      z: number;
      lockOn: boolean;
      /** ms since the lock window opened this pass; drives the snap animation. */
      sinceLockMs: number;
    };

/** Pure timeline: contact position and lock status for a loop-relative time. */
export const contactStateAt = (loopMs: number): ContactState => {
  const t = ((loopMs % BEAT_LOOP_MS) + BEAT_LOOP_MS) % BEAT_LOOP_MS;
  if (t < CONTACT_APPEAR_MS || t > CONTACT_EXIT_MS) return { present: false };
  const progress =
    (t - CONTACT_APPEAR_MS) / (CONTACT_EXIT_MS - CONTACT_APPEAR_MS);
  const z = CONTACT_SPAWN_Z + progress * (CONTACT_PASS_Z - CONTACT_SPAWN_Z);
  const lockOn = z >= LOCK_FAR_Z && z <= LOCK_NEAR_Z;
  const lockProgress =
    (LOCK_FAR_Z - CONTACT_SPAWN_Z) / (CONTACT_PASS_Z - CONTACT_SPAWN_Z);
  const lockOpensAtMs =
    CONTACT_APPEAR_MS + lockProgress * (CONTACT_EXIT_MS - CONTACT_APPEAR_MS);
  return {
    present: true,
    x: CONTACT_LANE_X,
    z,
    lockOn,
    sinceLockMs: lockOn ? t - lockOpensAtMs : 0,
  };
};
