import { isNonNull } from "remeda";
import { filter, fromEvent, ignoreElements, map, merge, tap } from "rxjs";
import type { Observable } from "rxjs";

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
 * Video files dropped onto `target` as a stream: subscribing claims drags over it
 * and unsubscribing releases them. Both events are cancelled, since the default
 * action navigates the browser to the dropped file and ends the session.
 */
export const videoFileDrops = (target: EventTarget): Observable<File> =>
  merge(
    // dragover exists only to claim the drop: a target that does not cancel it
    // is refusing the drag, and no drop event follows. It carries no file of
    // its own, which is what ignoreElements says.
    fromEvent<DragEvent>(target, "dragover").pipe(
      tap((event) => event.preventDefault()),
      ignoreElements(),
    ),
    fromEvent<DragEvent>(target, "drop").pipe(
      tap((event) => event.preventDefault()),
      map((event) => pickVideoFile(event.dataTransfer)),
      filter(isNonNull),
    ),
  );
