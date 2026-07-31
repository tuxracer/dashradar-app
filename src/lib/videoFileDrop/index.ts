/**
 * Picks the first video file out of a drag-and-drop payload, or null when the
 * drag carried none. Dragging anything else (an image, a folder, a link) must
 * leave the current feed alone, so callers treat null as "do nothing".
 */
export const pickVideoFile = (transfer: DataTransfer | null): File | null =>
  transfer
    ? (Array.from(transfer.files).find((file) =>
        file.type.startsWith("video/"),
      ) ?? null)
    : null;

/**
 * Wires drag-and-drop of a video file onto `target` and returns a teardown.
 * Both handlers cancel the event: without it the browser navigates away from
 * the app to the dropped file, which ends the session.
 */
export const attachVideoDropListeners = (
  target: EventTarget,
  onFile: (file: File) => void,
): (() => void) => {
  const handleDragOver = (event: Event) => {
    event.preventDefault();
  };
  const handleDrop = (event: Event) => {
    event.preventDefault();
    const file = pickVideoFile((event as DragEvent).dataTransfer);
    if (file) {
      onFile(file);
    }
  };
  target.addEventListener("dragover", handleDragOver);
  target.addEventListener("drop", handleDrop);
  return () => {
    target.removeEventListener("dragover", handleDragOver);
    target.removeEventListener("drop", handleDrop);
  };
};

/**
 * Whether dropping a video file is available. The dev server always allows it
 * so a local run needs no toggle hunting; a production build requires the
 * Developer options switch, which is persisted and therefore still readable on
 * the error screens that cannot reach the settings panel.
 */
export const isVideoDropEnabled = (
  dev: boolean,
  developerOptions: boolean,
): boolean => dev || developerOptions;
