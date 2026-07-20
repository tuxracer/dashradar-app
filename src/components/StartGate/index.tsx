import type { MotionPermission } from "@/lib/motionSensor";

/** True only while motion permission is still ungranted and promptable (iOS). */
export const shouldShowStartGate = (permission: MotionPermission): boolean =>
  permission === "prompt";

type StartGateProps = {
  /** Invoked on tap; requests iOS motion permission from the user gesture. */
  onStart: () => void;
};

/**
 * Full-screen tap-to-start overlay shown on iOS until motion permission is
 * granted. The tap is the user gesture iOS requires for
 * DeviceMotionEvent.requestPermission. Detection is already running underneath;
 * this only unlocks the gyroscope so stale boxes can be motion-compensated.
 */
export const StartGate = ({ onStart }: StartGateProps) => (
  <button
    type="button"
    onClick={onStart}
    className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 text-center backdrop-blur-sm"
  >
    <span className="text-3xl font-bold tracking-[0.3em] text-white">
      TAP TO START
    </span>
    <span className="max-w-xs text-sm font-medium tracking-wide text-white/70">
      Enables motion tracking so detections stay locked on as you drive.
    </span>
  </button>
);
