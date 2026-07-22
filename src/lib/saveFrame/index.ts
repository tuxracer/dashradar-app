import {
  FRAME_FILE_EXTENSION,
  FRAME_FILE_PREFIX,
  REVOKE_DELAY_MS,
} from "./consts";

export * from "./consts";

/** Zero-pads a date field to two digits. */
const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * Timestamped filename for a saved detection frame, from local time (never
 * UTC, which can land on the wrong day): dashradar-frame-YYYY-MM-DD-HHMMSS.jpg
 */
export const frameFilename = (date: Date): string => {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${FRAME_FILE_PREFIX}-${day}-${time}.${FRAME_FILE_EXTENSION}`;
};

/** Downloads a blob by clicking a temporary object-URL anchor. */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
};
