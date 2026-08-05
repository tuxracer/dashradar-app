import { useSyncExternalStore } from "react";
import { DARK_SCENE_PALETTE, LIGHT_SCENE_PALETTE } from "./consts";

/** Media query for a phone whose OS is set to a light appearance. */
const LIGHT_SCHEME_QUERY = "(prefers-color-scheme: light)";

/** The query, or undefined where matchMedia does not exist (jsdom). */
const lightScheme = (): MediaQueryList | undefined =>
  typeof window.matchMedia === "function"
    ? window.matchMedia(LIGHT_SCHEME_QUERY)
    : undefined;

const subscribe = (onChange: () => void) => {
  const query = lightScheme();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};

const snapshot = () =>
  lightScheme()?.matches === true ? LIGHT_SCENE_PALETTE : DARK_SCENE_PALETTE;

/**
 * The scene's colors for the OS color scheme in force right now, tracked live
 * rather than read once at mount: a phone set to switch itself at sunset does
 * so mid-drive, and the scene is on screen for the whole drive. Only a scheme
 * the browser reports as light gets the light palette, so a browser that
 * cannot answer keeps the dark instrument this app is otherwise built as.
 * Palettes are shared constants, which is what makes the snapshot stable
 * enough for useSyncExternalStore.
 */
export const useScenePalette = () =>
  useSyncExternalStore(subscribe, snapshot, () => DARK_SCENE_PALETTE);
