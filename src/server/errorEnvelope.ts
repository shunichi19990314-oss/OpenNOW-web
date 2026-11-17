import type express from "express";

/**
 * Terminal error handler for the API.
 *
 * Two responsibilities, both load-bearing:
 *
 * 1. Never hand a CloudMatch protocol code (69 = SessionInQueueAbandoned,
 *    11 = SessionLimitExceeded, …) to `response.status()`. Those are not HTTP
 *    statuses; passing one throws a RangeError inside the handler, the response
 *    dies as an opaque non-JSON 500, and the visitor loses the human-readable
 *    message we carefully mapped. Only genuine HTTP statuses pass through;
 *    protocol codes are reported as 502 with the code in `upstreamCode`.
 *
 * 2. Ship a machine-readable classification (`code`), so the browser can tell
 *    "a session is already running" without pattern matching English prose. GFN
 *    answers `DuplicateSessionDetected` while the client used to look for
 *    `DUPLICATE SESSION`; that mismatch produced the actionless, "Unknown"-coded
 *    launch failure users reported.
 */
export function errorEnvelopeHandler(
  error: unknown,
  _request: express.Request,
  response: express.Response,
  _next: express.NextFunction,
): void {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : null;
  const rawStatus = typeof record?.statusCode === "number" ? record.statusCode : undefined;
  const isHttpStatus = rawStatus !== undefined
    && Number.isInteger(rawStatus)
    && rawStatus >= 400
    && rawStatus <= 599;
  const status = isHttpStatus ? (rawStatus as number) : 502;
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const upstreamCode = !isHttpStatus && rawStatus !== undefined ? rawStatus : undefined;
  if (status >= 500) console.error("[Server]", error);

  const errorType = typeof record?.errorType === "string" ? record.errorType : undefined;
  const statusDescription =
    typeof record?.statusDescription === "string" ? record.statusDescription : undefined;

  response.status(status).json({
    error: message,
    ...(upstreamCode === undefined ? {} : { upstreamCode }),
    ...(errorType ? { code: errorType } : {}),
    ...(statusDescription ? { statusDescription } : {}),
  });
}
