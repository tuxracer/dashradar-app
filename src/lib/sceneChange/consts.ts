/**
 * Tiles per axis the frame's luma is reduced to. Per tile because the thing worth
 * scanning for is small: a patrol car far enough ahead to matter covers a few
 * dozen of 262,144 pixels, which vanishes into noise frame-wide.
 */
export const SCENE_GRID = 16;

/**
 * Sample every Nth pixel per axis. The gate has to cost much less than the
 * inference it skips; a quarter of the pixels is still 256 samples a tile, far
 * more averaging than the noise floor needs.
 */
export const SCENE_SAMPLE_STRIDE = 2;

/**
 * How far a tile's mean luma must move for the scene to count as changed. Low on
 * purpose: tripping when nothing happened costs one inference, while not tripping
 * costs a detection, so it sits near the noise floor rather than midway. Confirm
 * it on a device against the debug overlay's delta rather than deriving it.
 */
export const SCENE_CHANGE_THRESHOLD = 2;
