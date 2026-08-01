/**
 * How a launch's update question settled. Every value means "go ahead and
 * acquire the camera": the one outcome that keeps holding, an update
 * installing normally, ends in the page reloading out from under the
 * promise, so it never resolves at all.
 *
 * - `no-controller`: nothing controls the page, so no update can reload it
 *   (first visit, dev server, no service-worker support).
 * - `current`: the check completed and this launch is already the newest build.
 * - `check-timeout`: a check step outran its bound; assume current.
 * - `check-failed`: the check itself failed (offline, storage errors).
 * - `install-failed`: an update was found but its install died, so the
 *   reload is not coming.
 * - `pending-timeout`: an update is still installing after the promised hold.
 */
export type UpdateSettledResult =
  | "no-controller"
  | "current"
  | "check-timeout"
  | "check-failed"
  | "install-failed"
  | "pending-timeout";
