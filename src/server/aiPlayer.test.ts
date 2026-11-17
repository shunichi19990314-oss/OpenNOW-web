import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildObservationText } from "@shared/aiPlayerPrompt";
import {
  AiPlayerError,
  buildChatCompletionRequest,
  describeUpstreamError,
  buildRequestForMode,
  modelSupportsVision,
  requestAiPlayerChat,
  sanitizeFrame,
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

  it("relays only a scrubbed reason from the provider's error body", async () => {
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
    // The key must never reach the visitor, even when the provider echoes it.
    expect(message).not.toContain("sk-test-key");
    expect(message).toContain("401");
    expect(message).toContain("invalid api key");
  });

  it("surfaces which field a 400 rejected", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(
      {
        error: {
          code: 400,
          message: "messages[0].content[1].image_url.url: unsupported media type",
          metadata: { error_type: "invalid_request" },
        },
      },
      { status: 400 },
    ));
    await expect(requestAiPlayerDecision(
      { observation: OBSERVATION },
      "user-1",
      { fetchImpl: fetchImpl as unknown as typeof fetch, config: CONFIG },
    )).rejects.toMatchObject({
      code: "upstream_error",
      statusCode: 502,
      message: expect.stringContaining("messages[0].content[1].image_url.url"),
    });
  });

  it("keeps the error text on one line and drops echoed image data", async () => {
    const detail = describeUpstreamError(
      {
        error: {
          message: `bad frame\n${"A".repeat(64)} data:image/jpeg;base64,${"B".repeat(500)}`,
          metadata: { error_type: "invalid_request" },
        },
      },
      "sk-test-key",
    );
    expect(detail).not.toContain("\n");
    expect(detail).not.toContain("BBBB");
    expect(detail).toContain("[image]");
    expect(detail).toContain("invalid_request");
    expect(detail.length).toBeLessThanOrEqual(240);
    expect(describeUpstreamError(null, "k")).toBe("");
  });

  it("retries text-only when the provider refuses the image", async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ body });
      const messages = body.messages as Array<{ content: unknown }>;
      const isVision = Array.isArray(messages[1].content);
      if (isVision) {
        return fakeResponse(
          { error: { message: "messages[1].content[1].image_url.url: no endpoint accepts image input" } },
          { status: 400 },
        );
      }
      return fakeResponse({ choices: [{ message: { content: '{"plan":"walk","actions":[]}' } }] });
    });

    const result = await requestAiPlayerDecision(
      {
        observation: {
          ...OBSERVATION,
          frame: { dataUrl: "data:image/jpeg;base64,AAAA", width: 960, height: 540 },
        } as unknown as typeof OBSERVATION,
      },
      "user-1",
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        config: { ...CONFIG, model: "qwen/qwen3.8-27b" },
      },
    );

    expect(result.droppedFrame).toBe(true);
    expect(result.raw).toContain("walk");
    expect(calls).toHaveLength(2);
    const secondMessages = calls[1].body.messages as Array<{ content: unknown }>;
    expect(typeof secondMessages[1].content).toBe("string");
  });

  it("does not retry a text-only round, so a broken request is not billed twice", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ error: { message: "no endpoint" } }, { status: 400 }));
    await expect(requestAiPlayerDecision(
      { observation: OBSERVATION },
      "user-1",
      { fetchImpl: fetchImpl as unknown as typeof fetch, config: CONFIG },
    )).rejects.toBeInstanceOf(AiPlayerError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

describe("vision frames", () => {
  const FRAME = {
    dataUrl: "data:image/jpeg;base64,AAAA",
    width: 960,
    height: 540,
  };

  it("accepts a JPEG data URL and rejects anything else", () => {
    expect(sanitizeFrame(FRAME)).toEqual(FRAME);
    // An arbitrary URL would make the server fetch a third-party resource with
    // the operator's key attached to the request chain; SVG can carry script.
    expect(sanitizeFrame({ ...FRAME, dataUrl: "https://evil.example/x.png" })).toBeUndefined();
    expect(sanitizeFrame({ ...FRAME, dataUrl: "data:image/svg+xml;base64,AAAA" })).toBeUndefined();
    expect(sanitizeFrame(null)).toBeUndefined();
    expect(sanitizeFrame({ dataUrl: FRAME.dataUrl, width: 0, height: 0 })).toBeUndefined();
  });

  it("refuses an oversized frame instead of truncating it", () => {
    const huge = `data:image/jpeg;base64,${"A".repeat(3_000_000)}`;
    expect(() => sanitizeFrame({ ...FRAME, dataUrl: huge })).toThrow(AiPlayerError);
  });

  it("attaches the image only when the model can read it", () => {
    const withVision = buildRequestForMode("auto", "z-ai/glm-5.3", { ...OBSERVATION, frame: FRAME }, true);
    const userMessage = withVision.messages[1].content as unknown as Array<{ type: string }>;
    expect(Array.isArray(userMessage)).toBe(true);
    expect(userMessage.some((part) => part.type === "image_url")).toBe(true);

    const withoutVision = buildRequestForMode("auto", "deepseek/deepseek-v4.1-flash", { ...OBSERVATION, frame: FRAME }, false);
    // Text-only models get a string; sending parts would be a 400 from most
    // providers, and the tokens would be billed for nothing.
    expect(typeof withoutVision.messages[1].content).toBe("string");
  });

  it("reports vision support in the status payload", () => {
    // The regression behind the endless HTTP 400: z-ai/glm-5.3 is text-only in
    // the Numes catalogue, so attaching a frame to it is a rejected request.
    expect(modelSupportsVision("z-ai/glm-5.3")).toBe(false);
    expect(modelSupportsVision("deepseek/deepseek-v4.1-flash")).toBe(false);
    expect(modelSupportsVision("qwen/qwen3.8-27b")).toBe(true);
    expect(modelSupportsVision("uniboshi/kimi-k3-abliterated-v1")).toBe(true);
    // The default model is text-only, so the status must say so.
    expect(describeAiPlayerStatus(CONFIG).vision).toBe(false);
    expect(describeAiPlayerStatus({ ...CONFIG, model: "qwen/qwen3.8-27b" }).vision).toBe(true);
  });

  it("tells the model what it just did and that it is repeating", () => {
    const text = buildObservationText({
      ...OBSERVATION,
      lastActions: ["a"],
      repeatCount: 4,
      frame: FRAME,
    });
    expect(text).toContain("前回の操作: a");
    expect(text).toContain("同じ操作を 4 回");
    expect(text).toContain("画面画像を添付");
  });
});

describe("chat mode", () => {
  it("uses the chat prompt and carries the instruction", () => {
    const request = buildRequestForMode(
      "chat",
      "z-ai/glm-5.3",
      { ...OBSERVATION, instruction: "左の扉を開けて" },
      true,
    );
    expect(request.messages[0].content).toContain("会話");
    const text = request.messages[1].content as unknown as Array<{ type: string; text?: string }>;
    const joined = Array.isArray(text) ? text.map((part) => part.text ?? "").join(" ") : String(text);
    expect(joined).toContain("左の扉を開けて");
  });

  it("rejects an empty chat message before spending a request", async () => {
    const fetchImpl = vi.fn();
    await expect(requestAiPlayerChat(
      { observation: OBSERVATION, message: "   " },
      "user-1",
      { fetchImpl: fetchImpl as unknown as typeof fetch, config: CONFIG },
    )).rejects.toMatchObject({ code: "invalid_response", statusCode: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("routes a chat turn through the same transport", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({
      choices: [{ message: { content: '{"reply":"了解しました","actions":[]}' } }],
    }));
    const result = await requestAiPlayerChat(
      { observation: OBSERVATION, message: "こんにちは", includeFrame: false },
      "user-1",
      { fetchImpl: fetchImpl as unknown as typeof fetch, config: CONFIG },
    );
    expect(result.raw).toContain("了解しました");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("こんにちは");
  });
});

