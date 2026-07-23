type RecoveryOverlayProps = {
  /** Whether the camera feed is being re-acquired. */
  visible: boolean;
};

/**
 * Full-screen, high-contrast "reconnecting" state shown while the camera feed is
 * being re-acquired after a detected stall. Recovery is automatic, so there are
 * no controls: large glanceable text is all the driver needs to know why the
 * meter paused. Sits above the radar meter, below the error and model-load
 * screens.
 */
export const RecoveryOverlay = ({ visible }: RecoveryOverlayProps) => {
  if (!visible) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-surface/90">
      <p className="px-8 text-center text-2xl font-semibold uppercase tracking-widest text-white/85">
        Reconnecting camera...
      </p>
    </div>
  );
};
