import { useCallback, useEffect, useRef, useState } from "react";
import {
  askForOrientationAccess,
  orientationAccessGated,
} from "@/lib/deviceOrientation";

/** What a view that reads the phone's attitude needs to know and to offer. */
type OrientationAccess = {
  /**
   * Whether the sensors are still waiting on a gesture, and so whether to
   * offer the driver a control that supplies one. False on every engine that
   * never gated them, and false again the moment readings start arriving or
   * the driver answers.
   */
  needsGesture: boolean;
  /** Ask now. Only meaningful from inside a tap handler. */
  request: () => void;
};

/**
 * The orientation sensors' availability while `active` holds: asks at the first
 * gesture and reports whether one is still awaited. Any reading settles it, since
 * an event arriving at all is proof the sensors are open, which on the engines
 * that never gated them happens a frame or two after mounting.
 */
export const useOrientationAccess = (active: boolean): OrientationAccess => {
  const [needsGesture, setNeedsGesture] = useState(orientationAccessGated);
  const requestRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active || !needsGesture) {
      return;
    }
    const settle = () => {
      setNeedsGesture(false);
    };
    window.addEventListener("deviceorientation", settle, { once: true });
    const ask = askForOrientationAccess(settle);
    requestRef.current = ask.request;
    return () => {
      window.removeEventListener("deviceorientation", settle);
      ask.stop();
      requestRef.current = () => {};
    };
  }, [active, needsGesture]);

  // Stable across renders, so a control can hold it without re-rendering: the
  // ask behind it is replaced whenever the effect re-runs.
  const request = useCallback(() => {
    requestRef.current();
  }, []);

  return { needsGesture: active && needsGesture, request };
};
