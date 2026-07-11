import type { AppErrorCode } from "./consts";
import { ERROR_COPY } from "./consts";

export * from "./consts";

type ErrorScreenProps = {
  code: AppErrorCode;
};

export const ErrorScreen = ({ code }: ErrorScreenProps) => {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-surface px-8 text-center">
      <span className="text-sm font-semibold tracking-[0.34em] text-white/85">
        DASHRADAR
      </span>
      <p data-testid="error-message" className="max-w-sm text-lg text-white/75">
        {ERROR_COPY[code]}
      </p>
      <button
        className="rounded-full border border-hud-amber px-6 py-2 text-sm font-semibold tracking-[0.18em] text-hud-amber"
        onClick={() => window.location.reload()}
      >
        TRY AGAIN
      </button>
    </div>
  );
};
