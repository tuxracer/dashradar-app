/**
 * Safety margin the auto zoom's fit check insets the 2x crop region by, as a
 * fraction of that region's side. A detection only counts as fitting the 2x
 * view when its box lies inside the inset region, so a vehicle near the edge
 * of the would-be crop stays at 1x: the next scan is about two seconds away
 * at the pacing floor, and an edge-hugging object would likely have moved out
 * of the tighter view by then.
 */
export const AUTO_ZOOM_FIT_MARGIN = 0.1;
