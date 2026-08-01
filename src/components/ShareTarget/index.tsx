import { Share } from "lucide-react";
import { canShareApp, ShareQr, shareApp } from "@/components/ShareCard";

/** Amber bloom on the lock-on corners, matching the intro scene's bracket. */
const CORNER_GLOW = "drop-shadow-[0_0_6px_rgba(255,179,64,0.8)]";

/**
 * Frames its child in the HUD's lock-on brackets, the same four amber corners
 * the intro scene snaps onto a contact. Applied to the QR card so the code
 * reads as a target the instrument has acquired rather than a white sticker
 * pasted onto a dark panel.
 */
const LockedTarget = ({ children }: { children: React.ReactNode }) => (
  <div className="relative animate-scope-in motion-reduce:animate-none">
    {children}
    <span
      className={`pointer-events-none absolute -left-2.5 -top-2.5 size-8 border-l-2 border-t-2 border-hud-amber ${CORNER_GLOW}`}
    />
    <span
      className={`pointer-events-none absolute -right-2.5 -top-2.5 size-8 border-r-2 border-t-2 border-hud-amber ${CORNER_GLOW}`}
    />
    <span
      className={`pointer-events-none absolute -bottom-2.5 -left-2.5 size-8 border-b-2 border-l-2 border-hud-amber ${CORNER_GLOW}`}
    />
    <span
      className={`pointer-events-none absolute -bottom-2.5 -right-2.5 size-8 border-b-2 border-r-2 border-hud-amber ${CORNER_GLOW}`}
    />
  </div>
);

/**
 * The full-screen handoff cluster: a SCAN TO OPEN annunciator, the QR framed
 * as an acquired target, and the native share button wherever the Web Share
 * API exists. Used by both places the app hands itself to another device, the
 * desktop intro and the unsupported-device screen, so the two cannot drift
 * apart visually the way they had before this was extracted.
 *
 * The QR is never conditional on the share sheet: the code hands off to a
 * second screen someone is holding and needs nothing from the browser, while
 * the share sheet hands off to a second device of your own, which is the only
 * one of the two that helps when the device in hand is the phone. They are
 * complements, so both appear whenever both are possible.
 *
 * Distinct from `ShareCard`, which is the compact settings row: this is the
 * hero treatment for a screen whose whole purpose is the handoff.
 */
export const ShareTarget = () => (
  <>
    <span className="text-[11px] font-semibold tracking-[0.28em] text-hud-amber">
      SCAN TO OPEN
    </span>
    <LockedTarget>
      <ShareQr />
    </LockedTarget>
    {canShareApp() && (
      <button
        type="button"
        onClick={shareApp}
        // mt clears the lock-on corners, which overhang the card by 10px:
        // without it the button crowds the bracket and the target stops
        // reading as one framed object.
        className="mt-3 inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-hud-amber px-10 text-base font-bold tracking-[0.24em] text-surface active:scale-95"
      >
        <Share className="h-5 w-5" strokeWidth={2.25} />
        SEND LINK
      </button>
    )}
  </>
);
