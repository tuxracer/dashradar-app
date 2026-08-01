import { Share } from "lucide-react";
import { IntroScene } from "@/components/IntroScene";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { canShareApp, ShareQr, shareApp } from "@/components/ShareCard";
import { WORDMARK } from "@/lib/branding";

/** Amber bloom on the lock-on corners, matching the intro scene's bracket. */
const CORNER_GLOW = "drop-shadow-[0_0_6px_rgba(255,179,64,0.8)]";

/**
 * Frames its child in the HUD's lock-on brackets, the same four amber corners
 * the intro scene snaps onto a contact. Applied to the QR card so the code
 * reads as a target the instrument has acquired rather than a white sticker
 * pasted onto the panel: on this screen the thing worth locking onto is the
 * phone that can actually run the detector.
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
 * Shown when the GPU probe finds no device that can run inference
 * (WEBGPU_UNSUPPORTED). Deliberately not an `ErrorScreen`: nothing here is
 * recoverable on the device in hand, so a fault report with a warning glyph
 * would spend the moment telling someone their phone is inadequate. Whoever
 * reaches this screen opened the app on purpose and cannot use it yet, which
 * makes the only useful job moving them to a device that works.
 *
 * So it borrows the intro's composition instead of the error family's: the
 * live night-drive scene runs behind the copy, showing the detector doing the
 * thing they came for, and the QR sits inside lock-on brackets as the acquired
 * target. The fact is still stated plainly in the body, just not as the
 * headline. The scene pauses when the page is hidden, renders one static frame
 * under reduced motion, and this screen is terminal (no pump, no inference),
 * so the rAF loop costs nothing the intro does not already spend.
 */
export const UnsupportedScreen = () => {
  const shareable = canShareApp();
  return (
    <main className="fixed inset-0 overflow-y-auto bg-surface">
      <div className="relative flex min-h-full flex-col items-center justify-center gap-8 px-8 py-8 landscape:flex-row landscape:gap-14">
        <RadarBackdrop />
        <IntroScene />

        <div className="relative flex max-w-sm flex-col items-center gap-4 text-center landscape:items-start landscape:text-left">
          <span className="animate-rise-in text-[13px] font-semibold tracking-[0.34em] text-white/85 [animation-delay:120ms] motion-reduce:animate-none">
            {WORDMARK}
          </span>
          {/* The headline is the instruction, not the diagnosis. Most people
              who reach this screen are already holding a phone, so anything
              phrased as "it runs on your phone" reads as a contradiction of
              what they are looking at. "Another phone" also says nothing about
              the one they have: "a newer phone" both insults the reader's
              device and misstates the requirement, since what matters is the
              GPU's feature support and not the phone's age. */}
          <h1 className="animate-rise-in text-4xl font-bold uppercase leading-[0.95] tracking-wide text-white/95 [animation-delay:200ms] motion-reduce:animate-none landscape:text-5xl">
            <span>Open it on</span>{" "}
            <span className="block text-hud-amber">another phone</span>
          </h1>
          {/* One fact, then stop. No "browser" or "GPU acceleration", which
              name the machinery rather than anything the reader can act on,
              and no softening clause about how plenty of phones fall short
              either: reassurance nobody asked for is its own kind of
              condescension, and the sentence only has to be accurate and
              unhurtful, not kind. */}
          <p
            data-testid="unsupported-message"
            className="animate-rise-in text-base font-medium leading-snug text-white/65 [animation-delay:280ms] motion-reduce:animate-none"
          >
            This device&rsquo;s graphics chip can&rsquo;t run the detection.
          </p>
        </div>

        <div className="relative flex shrink-0 animate-rise-in flex-col items-center gap-4 [animation-delay:400ms] motion-reduce:animate-none">
          <span className="text-[11px] font-semibold tracking-[0.28em] text-hud-amber">
            SCAN TO OPEN
          </span>
          <LockedTarget>
            <ShareQr />
          </LockedTarget>
          {shareable && (
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
        </div>
      </div>
    </main>
  );
};
