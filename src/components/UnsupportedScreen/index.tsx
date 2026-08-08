import { IntroScene } from "@/components/IntroScene";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { ShareTarget } from "@/components/ShareTarget";
import { WORDMARK } from "@/lib/branding";

/**
 * Shown when the GPU probe finds nothing that can run inference. Deliberately not
 * an `ErrorScreen`: nothing is recoverable here, so the only useful job is moving
 * someone to a device that works rather than telling them theirs is inadequate.
 * It borrows the intro's composition for that, with the fact stated plainly in
 * the body rather than as the headline.
 */
export const UnsupportedScreen = () => {
  return (
    <main className="fixed inset-0 overflow-y-auto bg-surface">
      <div className="relative flex min-h-full flex-col items-center justify-center gap-8 px-8 py-8 landscape:flex-row landscape:gap-14">
        <RadarBackdrop />
        <IntroScene />

        <div className="relative flex max-w-sm flex-col items-center gap-4 text-center landscape:items-start landscape:text-left">
          <span className="animate-rise-in text-[13px] font-semibold tracking-[0.34em] text-white/85 [animation-delay:120ms] motion-reduce:animate-none">
            {WORDMARK}
          </span>
          {/* The instruction, not the diagnosis. Most people here are already
              holding a phone, so "it runs on your phone" contradicts what they
              are looking at, and "a newer phone" both insults their device and
              misstates the requirement, which is GPU support rather than age. */}
          <h1 className="animate-rise-in text-4xl font-bold uppercase leading-[0.95] tracking-wide text-white/95 [animation-delay:200ms] motion-reduce:animate-none landscape:text-5xl">
            <span>Open it on</span>{" "}
            <span className="block text-hud-amber">another phone</span>
          </h1>
          {/* One fact, then stop. No "browser" or "GPU acceleration", which name
              machinery rather than anything actionable, and no softening clause
              about how many phones fall short: the sentence has to be accurate
              and unhurtful, not kind. */}
          <p
            data-testid="unsupported-message"
            className="animate-rise-in text-base font-medium leading-snug text-white/65 [animation-delay:280ms] motion-reduce:animate-none"
          >
            This device&rsquo;s graphics chip can&rsquo;t run the detection.
          </p>
        </div>

        <div className="relative flex shrink-0 animate-rise-in flex-col items-center gap-4 [animation-delay:400ms] motion-reduce:animate-none">
          <ShareTarget />
        </div>
      </div>
    </main>
  );
};
