/**
 * How a launch's update question settled. Every value means "go ahead and acquire
 * the camera": the one outcome that keeps holding, an update installing normally,
 * reloads the page out from under the promise instead of resolving.
 *
 * - `no-controller`: nothing controls the page, so no update can reload it.
 * - `current`: this launch is already the newest build.
 * - `check-timeout`: a check step outran its bound; assume current.
 * - `check-failed`: the check itself failed.
 * - `install-failed`: an update was found but its install died.
 * - `pending-timeout`: an update is still installing after the promised hold.
 */
export type UpdateSettledResult =
  | "no-controller"
  | "current"
  | "check-timeout"
  | "check-failed"
  | "install-failed"
  | "pending-timeout";
