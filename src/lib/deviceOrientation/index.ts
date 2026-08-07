import { isFunction } from "remeda";

/** WebKit's gesture-scoped ask for the motion and orientation sensors. */
type OrientationAccessAsk = () => Promise<"granted" | "denied">;

/** An ask waiting on a gesture: one way to make it now, one to stop waiting. */
type PendingOrientationAsk = {
  /** Ask right now, from inside the handler of a tap the driver just made. */
  request: () => void;
  /** Stop waiting for a gesture. */
  stop: () => void;
};

/**
 * `DeviceOrientationEvent.requestPermission`, bound and typed, where it exists.
 * Its presence is the whole feature test, since the only engines that gate the
 * sensors are the ones that define it. Read off the constructor rather than a
 * user-agent branch, because the question is whether this build gates them.
 */
const orientationAccessAsk = (): OrientationAccessAsk | undefined => {
  if (typeof DeviceOrientationEvent === "undefined") {
    return undefined;
  }
  const ask: unknown = Reflect.get(DeviceOrientationEvent, "requestPermission");
  return isFunction(ask)
    ? (ask.bind(DeviceOrientationEvent) as OrientationAccessAsk)
    : undefined;
};

/**
 * Whether this browser hands over the orientation sensors only after a
 * gesture-scoped ask, so a control whose only job is to offer that gesture can
 * stay off the screens that never needed one.
 */
export const orientationAccessGated = (): boolean =>
  orientationAccessAsk() !== undefined;

/**
 * Asks for the orientation sensors at the next tap or key press and keeps waiting
 * until `stop`; wires up nothing where they are not gated.
 *
 * WebKit refuses the ask outside a gesture and fires no event until it is
 * answered, which is why the scene camera follows the phone on Android and sits
 * still on iOS. Nothing on the way into the app is a usable hook, since the
 * camera prompt is the browser's own and a returning driver reaches the view
 * through no taps at all, so the ask rides whatever they touch first.
 *
 * `onAnswer` fires on any answer, granted or denied, since nothing more can be
 * asked this page load either way. A rejected ask is not an answer: that is the
 * engine refusing a call that never reached the driver, so waiting continues.
 */
export const askForOrientationAccess = (
  onAnswer: () => void,
): PendingOrientationAsk => {
  const ask = orientationAccessAsk();
  if (!ask) {
    return { request: () => {}, stop: () => {} };
  }
  const gestures = new AbortController();
  let asking = false;
  const request = () => {
    if (asking) {
      return;
    }
    asking = true;
    void ask().then(
      () => {
        gestures.abort();
        onAnswer();
      },
      () => {
        asking = false;
      },
    );
  };
  window.addEventListener("click", request, { signal: gestures.signal });
  window.addEventListener("keydown", request, { signal: gestures.signal });
  return {
    request,
    stop: () => {
      gestures.abort();
    },
  };
};
