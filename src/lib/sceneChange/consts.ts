/**
 * Tiles per axis the frame's luma is reduced to. The comparison is per tile
 * rather than over the whole frame because the thing worth scanning for is
 * small: a patrol car far enough ahead to be worth warning about covers a
 * dozen pixels of a 512x512 input, which is under a thousandth of it. Averaged
 * across the whole frame that vanishes into sensor noise, and the gate would
 * suppress precisely the scan that mattered. Averaged across a 32x32 tile the
 * same car moves that tile's mean by several levels, well clear of the noise
 * floor, so taking the largest tile change keeps a small object visible to the
 * gate while a frame-wide average still smooths per-pixel grain away.
 */
export const SCENE_GRID = 16;

/**
 * Sample every Nth pixel per axis when accumulating tile means. The gate has to
 * be much cheaper than the inference it skips or it defeats its own purpose, so
 * it reads a quarter of the pixels: 256 samples per tile is still far more
 * averaging than the noise floor needs, and it puts the whole signature under
 * the cost of the preprocessing pass a skip avoids.
 */
export const SCENE_SAMPLE_STRIDE = 2;

/**
 * How far a tile's mean luma (0-255) must move for the scene to count as
 * changed. Set low on purpose: the cost of tripping when nothing happened is
 * one inference the app was going to run anyway, while the cost of not
 * tripping is a missed detection, so the threshold sits close to the noise
 * floor rather than midway between the two.
 *
 * Averaging 256 samples puts per-tile shot noise well under one level even at
 * the high sensor gain of a night drive, so this leaves roughly a factor of
 * three of headroom above noise and more than an order of magnitude below what
 * a vehicle entering a tile produces. It is still a figure to confirm on a real
 * device rather than derive: the debug overlay reports the measured per-frame
 * delta so it can be read against a static scene and a moving one.
 */
export const SCENE_CHANGE_THRESHOLD = 2;
