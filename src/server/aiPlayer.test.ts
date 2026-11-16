import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AiPlayerError,
  buildChatCompletionRequest,
  describeAiPlayerStatus,
  extractAssistantText,
  aiPlayerInternals,
  requestAiPlayerDecision,
  reserveDailyRequest,
  resolveAiPlayerConfig,
  resolveRequestModel,
  sanitizeObservation,
} from "./aiPlayer";
import type { AiPlayerConfig } from "./aiPlayer";

const CONFIG: AiPlayerConfig = {
  apiKey: "sk-test-key",
  baseUrl: "https://api.numes.ai/api/v1",
  model: "z-ai/glm-5.3",
  dailyRequestCap: 0,
};

const OBSERVATION = {
  game: "Test Game",
  elapsedSeconds: 42,
  availableActions: ["a", "b"],
};

function fakeResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init.headers ?? {}),
    json: async () => body,
  } as unknown as Response;
}

describe("AI player configuration", () => {
  it("reads the key, base URL and model from the environment", () => {
    const config = resolveAiPlayerConfig({
      NUMES_API_KEY: "  sk-env  ",
      NUMES_BASE_URL: "https://proxy.example/api/v1/",
      AI_PLAYER_MODEL: "deepseek/deepseek-v4.1-flash",
      AI_PLAYER_DAILY_REQUESTS: "25",
    } as NodeJS.ProcessEnv);
    expect(config.apiKey).toBe("sk-env");
    // Trailing slash removed so "/chat/completions" does not double up.
    expect(config.baseUrl).toBe("https://proxy.example/api/v1");
    expect(config.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(config.dailyRequestCap).toBe(25);
  });

  it("defaults to Numes and reports the key as missing when unset", () => {
    const config = resolveAiPlayerConfig({} as NodeJS.ProcessEnv);
    expect(config.baseUrl).toBe("https://api.numes.ai/api/v1");
    const status = describeAiPlayerStatus(config);
    expect(status.configured).toBe(false);
    expect(status.reason).toBe("missing_key");
    // The status payload is served to the browser: it must never carry secrets.
    expect(JSON.stringify(status)).not.toContain("apiKey");
  });

  it("treats a negative or unparsable cap as unlimited", () => {
    for (const raw of ["-5", "abc", ""]) {
      const config = resolveAiPlayerConfig({ AI_PLAYER_DAILY_REQUESTS: raw } as NodeJS.ProcessEnv);
      expect(config.dailyRequestCap).toBe(0);
    }
  });
});

describe("AI player request validation", () => {
  it("bounds every observation field", () => {
    const observation = sanitizeObservation({
      game: "x".repeat(500),
      elapsedSeconds: Number.POSITIVE_INFINITY,
      plan: "y".repeat(5_000),
      signals: Array.from({ length: 40 }, (_, index) => `signal-${index}`),
      availableActions: Array.from({ length: 100 }, (_, index) => `action-${index}`),
    });
    expect(observation.game.length).toBeLessThanOrEqual(120);
    expect(observation.elapsedSeconds).toBe(0);
    expect(observation.plan?.length).toBeLessThanOrEqual(400);
    expect(observation.signals?.length).toBe(6);
    expect(observation.availableActions.length).toBe(40);
  });

  it("rejects a non-object observation", () => {
    expect(() => sanitizeObservation(null)).toThrow(AiPlayerError);
  });

  it("accepts author/model ids and refuses anything else", () => {
    expect(resolveRequestModel("deepseek/deepseek-v4.1-flash", CONFIG)).toBe("deepseek/deepseek-v4.1-flash");
    expect(resolveRequestModel(undefined, CONFIG)).toBe(CONFIG.model);
    // A URL or a path traversal must not be passable as a model id.
    for (const bad of ["https://evil.example/x", "..", "../admin", "model only", "a/b/c"]) {
      expect(() => resolveRequestModel(bad, CONFIG)).toThrow(AiPlayerError);
    }
  });

  it("builds a bounded chat request", () => {
    const request = buildChatCompletionRequest("z-ai/glm-5.3", [{ role: "user", content: "hi" }]);
    expect(request.model).toBe("z-ai/glm-5.3");
    expect(request.max_tokens).toBe(400);
  });
});

describe("AI player daily cap", () => {
  beforeEach(() => {
    aiPlayerInternals.clearUsage();
  });

  it("is unlimited when the cap is zero", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(reserveDailyRequest("user", 0, Date.UTC(2026, 0, 1, 12))).toBeNull();
    }
  });

  it("counts per user and reports the reset in seconds", () => {
    const now = Date.UTC(2026, 0, 1, 23, 0, 0);
    expect(reserveDailyRequest("alice", 1, now)).toBeNull();
    const retryAfter = reserveDailyRequest("alice", 1, now);
    expect(retryAfter).toBe(3_600);
    // A different account is unaffected.
    expect(reserveDailyRequest("bob", 1, now)).toBeNull();
  });

  it("resets on the next UTC day", () => {
    const day1 = Date.UTC(2026, 0, 1, 12);
    expect(reserveDailyRequest("alice", 1, day1)).toBeNull();
    expect(reserveDailyRequest("alice", 1, day1)).not.toBeNull();
    expect(reserveDailyRequest("alice", 1, day1 + 24 * 60 * 60 * 1000)).toBeNull();
  });
});

describe("assistant text extraction", () => {
  it("reads the usual message shapes", () => {
    expect(extractAssistantText({ choices: [{ message: { content: "hello" } }] })).toBe("hello");
    expect(extractAssistantText({
      choices: [{ message: { content: [{ type: "text", text: "par" }, { text: "ts" }] } }],
    })).toBe("parts");
    expect(extractAssistantText({ choices: [{ message: { reasoning: "thought" } }] })).toBe("thought");
    expect(extractAssistantText({ output_text: "bare" })).toBe("bare");
    expect(extractAssistantText(null)).toBe("");
    expect(extractAssistantText({ choices: [] })).toBe("");
  });
});

describe("AI player proxy round trip", () => {
  it("sends the key only in the Authorization header and returns the raw text", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({
      choices: [{ message: { content: '{"plan":"attack","actions":[{"action":"a"}]}' } }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }));

    const result = await requestAiPlayerDecision(
      { observation: OBSERVATION },
      "user-1",
      { fetchImpl: fetchImpl as unknown as typeof fetch, config: CONFIG, now: () => 0 },
    );

    expect(result.raw).toContain("attack");
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.numes.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-key");
    // The key must not leak into the URL or body.
    expect(url).not.toContain("sk-test-key");
    expect(String(init.body)).not.toContain("sk-test-key");
  });

  it("refuses to call the provider when no key is configured", async () => {
    const fetchImpl = vi.fn();
    await expect(requestAiPlayerDecision(
      { observation: OBSERVATION },
      "user-1",
      { fetchImpl: fetchImpl as unknown as typeof fetch, config: { ...CONFIG, apiKey: "" } },
    )).rejects.toMatchObject({ code: "missing_key", statusCode: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps an upstream 429 to a rate-limit error with Retry-After", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({}, { status: 429, headers: { "retry-after": "17" } }));
    await expect(requestAiPlayerDecision(
      { observation: OBSERVATION },
      "user-1",
      { fetchImpl: fetchImpl as unknown as typeof fetch, config: CONFIG },
    )).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 17 });
  });

  it("does not relay the provider's error body", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(
      { error: "invalid api key sk-test-key" },
      { status: 401 },
    ));
    let failure: unknown;
    try {
      await requestAiPlayerDecision(
        { observation: OBSERVATION },
        "user-1",
        { fetchImpl: fetchImpl as unknown as typeof fetch, config: CONFIG },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AiPlayerError);
    const message = (failure as AiPlayerError).message;
    expect(message).not.toContain("sk-test-key");
    expect(message).toContain("401");
  });

  it("reports an empty reply instead of returning a blank plan", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ choices: [{ message: { content: "  " } }] }));
    await expect(requestAiPlayerDecision(
      { observation: OBSERVATION },
      "user-1",
      { fetchImpl: fetchImpl as unknown as typeof fetch, config: CONFIG },
    )).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("enforces the daily cap before spending a request", async () => {
    aiPlayerInternals.clearUsage();
    const fetchImpl = vi.fn(async () => fakeResponse({ choices: [{ message: { content: "{}" } }] }));
    const config: AiPlayerConfig = { ...CONFIG, dailyRequestCap: 1 };
    await expect(requestAiPlayerDecision(
      { observation: OBSERVATION },
      "user-2",
      { fetchImpl: fetchImpl as unknown as typeof fetch, config },
    )).resolves.toBeTruthy();
    await expect(requestAiPlayerDecision(
      { observation: OBSERVATION },
      "user-2",
      { fetchImpl: fetchImpl as unknown as typeof fetch, config },
    )).rejects.toMatchObject({ code: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    aiPlayerInternals.clearUsage();
  });

  afterEach(() => {
    aiPlayerInternals.clearUsage();
  });
});
