import type { StreamTimeWarning } from "../platforms/gfn/webrtcClient";

export type StreamStatus = "idle" | "queue" | "setup" | "starting" | "connecting" | "streaming";
export type StreamLoadingStatus = "queue" | "setup" | "starting" | "connecting";

export type StreamWarningState = {
  code: StreamTimeWarning["code"];
  message: string;
  tone: "warn" | "critical";
  secondsLeft?: number;
};

export type LocalSessionTimerWarningState = {
  stage: "free-tier-30m" | "free-tier-15m" | "free-tier-final-minute";
  shownAtMs: number;
};

export type LaunchErrorState = {
  stage: StreamLoadingStatus;
  title: string;
  description: string;
  codeLabel?: string;
  /**
   * What the primary button does.
   *
   * `end-active-session` exists because the single most common launch failure is
   * a session still running on the account; telling the visitor to "close it
   * first" without offering the button leaves them stuck, since the home screen
   * may not even show that session.
   */
  action?: "persistent-storage-settings" | "end-active-session";
  actionLabel?: string;
  /** Raw upstream sentence, shown verbatim under the localized explanation. */
  detail?: string;
};
