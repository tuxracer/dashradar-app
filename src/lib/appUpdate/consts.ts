/**
 * localStorage key holding the commit SHA of the last build that ran on this
 * device. Compared against the running build at every launch to spot an
 * update; a data reset clears it, so the launch after a reset looks like a
 * first run rather than an update.
 */
export const LAST_RUN_COMMIT_KEY = "lastRunCommit";

/**
 * What `__COMMIT_SHA__` holds when the build could not name its own commit
 * (no Vercel env, no git). Such a build stays out of the update metric.
 */
export const UNKNOWN_COMMIT_SHA = "unknown";
