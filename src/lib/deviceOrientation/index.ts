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
 * `DeviceOrientationEvent.requestPermission`, bound and typed, where the
 * browser defines it. Apple's engines are the only ones that put an ask in
 * front of the sensors and the only ones that define this, so its presence is
 * the whole feature test: everywhere else `deviceorientation` fires unasked
 * and there is nothing to request. Read off the constructor rather than
 * branched on a user-agent check, because the question is whether this build
 * of the engine gates the sensors, not which brand of browser is running.
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
 * Whether this browser hands over the orientation sensors only after being
 * asked from inside a gesture. False everywhere the sensors are simply open,
 * which is every engine except Apple's, so a control whose only job is to
 * offer that gesture can stay off the screens that never needed one.
 */
export const orientationAccessGated = (): boolean =>
  orientationAccessAsk() !== undefined;

/**
 * Asks for the orientation sensors at the next tap or key press, and keeps
 * waiting for one until `stop`. On a browser that does not gate them it wires
 * up nothing at all.
 *
 * WebKit refuses the ask outside a gesture, and until it is answered no
 * `deviceorientation` event ever fires, which is why the scene camera follows
 * the phone on Android and sits still on iOS. Nothing on the way into the app
 * is a usable hook: the camera prompt is the browser's own, not a tap on the
 * page, and a driver returning to a view the app remembered reaches it through
 * no taps whatsoever. So the ask rides whatever the driver touches first while
 * the view that needs it is on screen, and `request` is there for a control
 * that offers the tap outright.
 *
 * `onAnswer` fires once the driver has answered, granted and denied alike,
 * since either way nothing more can be asked for on this page load. A rejected
 * ask is not an answer: that is the engine refusing a call that never reached
 * the driver, so the waiting continues and the next gesture is a fresh chance
 * at one.
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
