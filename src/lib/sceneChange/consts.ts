/**
 * Tiles per axis the frame's luma is reduced to. Per tile rather than per frame
 * because the thing worth scanning for is small: a patrol car far enough ahead
 * to matter covers a few dozen of 262,144 pixels, which vanishes into sensor
 * noise frame-wide but moves one tile's mean by several levels.
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
 * purpose: tripping when nothing happened costs one inference the app was going
 * to run anyway, while not tripping costs a detection, so it sits near the noise
 * floor rather than midway. Averaging 256 samples puts shot noise well under one
 * level even at a night drive's gain, leaving about 3x headroom above noise and
 * an order of magnitude below what a vehicle entering a tile produces. Confirm
 * it on a device against the debug overlay's reported delta rather than deriving
 * it.
 */
export const SCENE_CHANGE_THRESHOLD = 2;
