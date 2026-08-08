/**
 * Where the model's own page lives, said in words rather than named as a site:
 * the button leads somewhere public and off the device, which is the part worth
 * warning about before a tap.
 */
export const MORE_INFO_LABEL = "MORE INFO";

/**
 * Shown in place of the class list for a model that has neither run here nor says
 * what it is. A built-in always has its own sentence, so this is a last resort.
 */
export const UNKNOWN_CLASSES_MESSAGE =
  "Not known until this model has run once.";

/**
 * Said once on every card, because the answer is the same for every model and
 * it is the question a driver actually has about one.
 */
export const ON_DEVICE_MESSAGE =
  "Runs on this device. Nothing it sees is uploaded.";

/**
 * Gap between one section's entrance and the next, matching the stagger the
 * picker's rows arrive on, so backing in and out of a card reads as one screen
 * rather than two conventions.
 */
export const SECTION_ENTER_STAGGER_MS = 45;

/**
 * How much of a revision to show. A tag ("v1.0") is short and shown whole; a
 * commit sha is 40 characters of nothing anyone reads, so it is cut to the
 * length git itself abbreviates to.
 */
export const SHORT_REVISION_LENGTH = 7;
