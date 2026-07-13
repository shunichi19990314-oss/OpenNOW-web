import type { AuthUser, GameInfo, LoginProvider, SessionInfo, StreamRegion, SubscriptionInfo } from "@shared/gfn";

export interface BrowserSession {
  provider: LoginProvider;
  user: AuthUser;
}

export interface BootstrapData {
  session: BrowserSession;
  regions: StreamRegion[];
  subscription: SubscriptionInfo | null;
}

export interface QrChallenge {
  attemptId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: number;
  intervalSeconds: number;
}

export interface QrPollResult {
  status: "pending" | "slow_down" | "expired" | "access_denied" | "authorized" | "error";
  session?: BrowserSession;
  error?: string;
  intervalSeconds?: number;
}

export type AppView = "loading" | "login" | "catalog" | "queue" | "stream";
export type CatalogTab = "library" | "discover";
export type StreamRuntime = { game: GameInfo; session: SessionInfo };
