/**
 * localStorage flag marking the `pwa_installed` analytics event as already
 * sent, so it fires at most once per install. Uses the app's `dashradar:` key
 * convention. On iOS an installed PWA gets storage isolated from Safari's tabs,
 * so a flag set while browsing never leaks into the installed app: the first
 * standalone launch always looks fresh.
 */
export const PWA_INSTALL_TRACKED_KEY = "dashradar:pwaInstalled";
