import { describe, expect, it, vi } from "vitest";

import {
  AI_PLAYER_ACTION_NAMES,
  buildActionSequence,
  isKnownGamepadAction,
  NEUTRAL_GAMEPAD_STATE,
  resolveGamepadAction,
} from "./aiPlayerActions";
import { parseAiPlayerDecision, buildObservationText } from "../../shared/aiPlayerPrompt";
import {
  describeDecisionFailure,
  runAiPlayerLoop,
  runAiPlayerRound,
  type AiPlayerPost,
} from "./aiPlayerLoop";
import type { AiPlayerDecideResponse } from "../../shared/aiPlayer";
import {
  GAMEPAD_A,
  GAMEPAD_B,
  GAMEPAD_DPAD_DOWN,
} from "../platforms/gfn/inputProtocol";

const OBSERVATION = {
  game: "Test Game",
  elapsedSeconds: 30,
  availableActions: ["a", "b", "dpad_down"],
};

describe("action mapping", () => {
  it("maps names to the documented button bits", () => {
    expect(resolveGamepadAction("a")?.buttons).toBe(GAMEPAD_A);
    expect(resolveGamepadAction("b")?.buttons).toBe(GAMEPAD_B);
    expect(resolveGamepadAction("dpad_down")?.buttons).toBe(GAMEPAD_DPAD_DOWN);
  });

  it("accepts Japanese aliases the model may answer with", () => {
    expect(resolveGamepadAction("決定")?.buttons).toBe(GAMEPAD_A);
    expect(resolveGamepadAction("戻る")?.buttons).toBe(GAMEPAD_B);
  });

  it("returns null for unknown names instead of pressing nothing", () => {
    expect(resolveGamepadAction("teleport")).toBeNull();
    expect(isKnownGamepadAction("teleport")).toBe(false);
    expect(isKnownGamepadAction("a")).toBe(true);
  });

  it("offers a non-empty action list without duplicates", () => {
    expect(AI_PLAYER_ACTION_NAMES.length).toBeGreaterThan(10);
    expect(new Set(AI_PLAYER_ACTION_NAMES).size).toBe(AI_PLAYER_ACTION_NAMES.length);
  });

  it("always releases after each press", () => {
    const sequence = buildActionSequence([{ action: "a", durationMs: 200 }]);
    expect(sequence).toHaveLength(2);
    expect(sequence[0].state.buttons).toBe(GAMEPAD_A);
    expect(sequence[1].state).toEqual(NEUTRAL_GAMEPAD_STATE);
  });

  it("drops unknown actions but keeps the rest", () => {
    const sequence = buildActionSequence([
      { action: "teleport", durationMs: 200 },
      { action: "b", durationMs: 200 },
    ]);
    expect(sequence).toHaveLength(2);
    expect(sequence[0].state.buttons).toBe(GAMEPAD_B);
  });
});

describe("decision parsing", () => {
  it("parses a plain JSON reply", () => {
    const { decision, problem } = parseAiPlayerDecision(
      '{"plan":"open menu","actions":[{"action":"a","durationMs":150}]}',
      OBSERVATION,
    );
    expect(problem).toBeUndefined();
    expect(decision?.plan).toBe("open menu");
    expect(decision?.actions).toEqual([{ action: "a", durationMs: 150, note: undefined }]);
  });

  it("tolerates fenced and chatty replies", () => {
    expect(parseAiPlayerDecision('```json\n{"plan":"x"}\n```', OBSERVATION).decision?.plan).toBe("x");
    expect(parseAiPlayerDecision('Sure! {"plan":"y"}', OBSERVATION).decision?.plan).toBe("y");
  });

  it("refuses actions the caller did not offer", () => {
    const { decision } = parseAiPlayerDecision(
      '{"plan":"cheat","actions":[{"action":"launch_missiles"}]}',
      OBSERVATION,
    );
    expect(decision?.actions).toEqual([]);
    // The plan is still useful for a log line.
    expect(decision?.plan).toBe("cheat");
  });

  it("clamps hold durations into a safe range", () => {
    const tooLong = parseAiPlayerDecision(
      '{"actions":[{"action":"a","durationMs":600000}]}',
      OBSERVATION,
    );
    expect(tooLong.decision?.actions[0].durationMs).toBe(2000);
    const tooShort = parseAiPlayerDecision(
      '{"actions":[{"action":"a","durationMs":1}]}',
      OBSERVATION,
    );
    expect(tooShort.decision?.actions[0].durationMs).toBe(30);
  });

  it("reports unusable replies instead of throwing", () => {
    // Messages are shown to the visitor, so they are Japanese like the rest of
    // the panel.
    expect(parseAiPlayerDecision("", OBSERVATION).problem).toBe("空の応答でした");
    expect(parseAiPlayerDecision("not json", OBSERVATION).problem).toContain("JSON");
    expect(parseAiPlayerDecision('{"unrelated":true}', OBSERVATION).problem).toContain("含まれていません");
  });

  it("builds a compact prompt", () => {
    const prompt = buildObservationText({ ...OBSERVATION, plan: "walk north", signals: ["low health"] });
    expect(prompt).toContain("Test Game");
    expect(prompt).toContain("walk north");
    expect(prompt).toContain("a, b, dpad_down");
  });
});

/**
 * Stands in for the proxy call.
 *
 * Mirrors `api()`: a non-2xx reply becomes a thrown Error carrying `httpStatus`,
 * which is what the round reads to explain the failure.
 */
function fakePost(body: unknown, status = 200): AiPlayerPost {
  const error = new Error(`Request failed (${status})`) as Error & { httpStatus?: number };
  error.httpStatus = status;
  return (async () => {
    if (status >= 200 && status < 300) return body as AiPlayerDecideResponse;
    throw error;
  }) as AiPlayerPost;
}

describe("AI player round", () => {
  it("presses the decoded action and always releases", async () => {
    const sent: number[] = [];
    const decision = await runAiPlayerRound({
      observation: OBSERVATION,
      sink: { send: (state) => { sent.push(state.buttons); return true; } },
      post: fakePost({ raw: '{"plan":"jump","actions":[{"action":"a","durationMs":120}]}' }),
      sleep: async () => {},
      now: () => 1000,
    });
    expect(decision?.plan).toBe("jump");
    // press -> release from the sequence -> the loop's own closing neutral.
    // The duplicate release is intentional: the loop cannot know whether the
    // last sequence step actually landed on the wire.
    expect(sent).toEqual([GAMEPAD_A, 0, 0]);
  });

  it("does not press anything when the reply is unusable", async () => {
    const send = vi.fn(() => true);
    const logs: string[] = [];
    await runAiPlayerRound({
      observation: OBSERVATION,
      sink: { send },
      post: fakePost({ raw: "I cannot do that." }),
      sleep: async () => {},
      onLog: (entry) => logs.push(entry.message),
    });
    expect(send).not.toHaveBeenCalled();
    expect(logs.join(" ")).toContain("AI の応答");
  });

  it("stops sending when the input channel is not ready", async () => {
    const send = vi.fn(() => false);
    await runAiPlayerRound({
      observation: OBSERVATION,
      sink: { send },
      post: fakePost({ raw: '{"plan":"x","actions":[{"action":"a","durationMs":100},{"action":"b","durationMs":100}]}' }),
      sleep: async () => {},
    });
    // First attempt fails, so the loop must not queue the remaining actions.
    expect(send).toHaveBeenCalledTimes(2); // one action attempt + the final neutral
  });

  it("explains a missing key from the proxy", async () => {
    const logs: string[] = [];
    const error = new Error("AI player is not configured: set NUMES_API_KEY on the server.") as Error & { httpStatus?: number };
    error.httpStatus = 503;
    await runAiPlayerRound({
      observation: OBSERVATION,
      sink: { send: () => true },
      post: vi.fn(async () => { throw error; }),
      sleep: async () => {},
      onLog: (entry) => logs.push(entry.message),
    });
    expect(logs.join(" ")).toContain("NUMES_API_KEY");
  });

  it("survives a network failure", async () => {
    const logs: string[] = [];
    await runAiPlayerRound({
      observation: OBSERVATION,
      sink: { send: () => true },
      post: vi.fn(async () => { throw new TypeError("failed to fetch"); }),
      sleep: async () => {},
      onLog: (entry) => logs.push(entry.message),
    });
    expect(logs.join(" ")).toContain("接続できません");
  });

  it("turns a 403 into sign-in guidance instead of a bare status", async () => {
    const logs: string[] = [];
    await runAiPlayerRound({
      observation: OBSERVATION,
      sink: { send: () => true },
      // Exactly what the same-origin guard produced before the fix.
      post: fakePost(null, 403),
      sleep: async () => {},
      onLog: (entry) => logs.push(entry.message),
    });
    const text = logs.join(" ");
    expect(text).toContain("403");
    expect(text).toContain("再読み込み");
    expect(text).not.toBe("AI リクエストが失敗しました (HTTP 403)。");
  });
});

describe("AI player loop", () => {
  it("runs rounds until aborted and releases control on exit", async () => {
    const controller = new AbortController();
    const sent: number[] = [];
    let rounds = 0;
    const onState = vi.fn();

    await runAiPlayerLoop({
      sink: { send: (state) => { sent.push(state.buttons); return true; } },
      buildObservation: () => OBSERVATION,
      options: {
        signal: controller.signal,
        post: fakePost({ raw: '{"plan":"step","actions":[{"action":"a","durationMs":100}]}' }),
        now: () => 0,
        sleep: async () => {
          rounds += 1;
          if (rounds >= 2) controller.abort();
        },
      },
      onState,
    });

    expect(onState).toHaveBeenCalled();
    // Last state pushed must be neutral: the loop is the only writer.
    expect(sent[sent.length - 1]).toBe(0);
    expect(sent).toContain(GAMEPAD_A);
  });

  it("backs off and reports the error when every round fails", async () => {
    const controller = new AbortController();
    const states: Array<{ lastError: string | null; rounds: number }> = [];
    const sleeps: number[] = [];
    await runAiPlayerLoop({
      sink: { send: () => true },
      buildObservation: () => OBSERVATION,
      options: {
        signal: controller.signal,
        post: fakePost({}, 500),
        now: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
          controller.abort();
        },
      },
      onState: (state) => states.push({ lastError: state.lastError, rounds: state.rounds }),
    });
    expect(states.some((state) => state.lastError)).toBe(true);
    // Failure path waits longer than the normal interval.
    expect(sleeps[0]).toBeGreaterThan(1_500);
  });
});

describe("provider-refused frames", () => {
  it("says in Japanese that the screenshot was dropped and retried", async () => {
    const entries: Array<{ level: string; message: string; code?: string }> = [];
    let dropped = 0;
    const decision = await runAiPlayerRound({
      observation: OBSERVATION,
      sink: { send: () => true },
      sleep: async () => {},
      now: () => 0,
      onLog: (entry) => entries.push(entry),
      onFrameDropped: () => { dropped += 1; },
      post: async () => ({
        raw: '{"plan":"walk","actions":[]}',
        droppedFrame: true,
      }),
    });

    expect(decision?.plan).toBe("walk");
    expect(dropped).toBe(1);
    const warning = entries.find((entry) => entry.code === "frame_rejected");
    expect(warning?.level).toBe("warn");
    expect(warning?.message).toContain("文字情報だけ");
    // No English provider sentence reaches the log.
    expect(warning?.message).not.toMatch(/[A-Za-z]{4,}/);
  });

  it("counts dropped frames in the loop state", async () => {
    const controller = new AbortController();
    const states: Array<{ framesCaptured: number; framesDropped: number }> = [];
    let rounds = 0;
    await runAiPlayerLoop({
      sink: { send: () => true },
      buildObservation: () => OBSERVATION,
      options: {
        signal: controller.signal,
        captureFrame: () => ({ dataUrl: "data:image/jpeg;base64,AAAA", width: 960, height: 540 }),
        post: async () => ({ raw: '{"plan":"walk","actions":[]}', droppedFrame: true }),
        now: () => 0,
        intervalMs: 10,
        sleep: async () => {
          rounds += 1;
          if (rounds >= 2) controller.abort();
        },
      },
      onState: (state) => states.push({
        framesCaptured: state.framesCaptured,
        framesDropped: state.framesDropped,
      }),
    });
    const last = states[states.length - 1];
    expect(last.framesCaptured).toBeGreaterThan(0);
    expect(last.framesDropped).toBe(last.framesCaptured);
  });
});

describe("decision failure messages", () => {
  it("guides the visitor to re-authenticate on 401/403", () => {
    for (const status of [401, 403]) {
      const message = describeDecisionFailure(status, "Invalid same-origin request.");
      expect(message).toContain(String(status));
      expect(message).toContain("再読み込み");
    }
  });

  it("keeps the server's explanation for other statuses", () => {
    expect(describeDecisionFailure(503, "NUMES_API_KEY is not set.")).toBe("NUMES_API_KEY is not set.");
    expect(describeDecisionFailure(500, "")).toContain("HTTP 500");
  });

});

describe("controller heartbeat", () => {
  it("keeps the pad advertised while waiting between rounds", async () => {
    const controller = new AbortController();
    const keepAlive = vi.fn();
    const sleeps: number[] = [];
    await runAiPlayerLoop({
      sink: { send: () => true, keepAlive },
      buildObservation: () => OBSERVATION,
      options: {
        signal: controller.signal,
        post: fakePost({ raw: '{"plan":"wait","actions":[]}' }),
        intervalMs: 300,
        now: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
          if (sleeps.length >= 4) controller.abort();
        },
      },
    });
    // The 300 ms wait is split into heartbeat-sized slices, so a pad that would
    // otherwise go silent for a third of a second is refreshed three times.
    expect(sleeps.every((ms) => ms <= 100)).toBe(true);
    expect(keepAlive.mock.calls.length).toBeGreaterThan(0);
  });

  it("still works without a keepalive hook", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    await runAiPlayerLoop({
      sink: { send: () => true },
      buildObservation: () => OBSERVATION,
      options: {
        signal: controller.signal,
        post: fakePost({ raw: '{"plan":"wait","actions":[]}' }),
        intervalMs: 300,
        now: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
          // Let the round finish its own 60 ms settle before aborting, so the
          // inter-round wait is actually observed.
          if (ms >= 100) controller.abort();
        },
      },
    });
    // No slicing: the wait between rounds is one uninterrupted sleep. (The first entry
    // is the 60 ms release settle inside the round, so check that a full-length
    // interval of 300 ms appears rather than only heartbeat-sized slices.)
    expect(sleeps).toContain(300);
    expect(sleeps.filter((ms) => ms === 100)).toHaveLength(0);
  });

  it("survives a throwing heartbeat", async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(runAiPlayerLoop({
      sink: {
        send: () => true,
        keepAlive: () => {
          calls += 1;
          throw new Error("boom");
        },
      },
      buildObservation: () => OBSERVATION,
      options: {
        signal: controller.signal,
        post: fakePost({ raw: '{"plan":"wait","actions":[]}' }),
        intervalMs: 200,
        now: () => 0,
        sleep: async () => {
          if (calls >= 1) controller.abort();
        },
      },
    })).resolves.toBeUndefined();
    expect(calls).toBeGreaterThan(0);
  });
});

describe("input diagnostics", () => {
  it("logs the button bits it actually sent", async () => {
    const logs: string[] = [];
    await runAiPlayerRound({
      observation: OBSERVATION,
      sink: { send: () => true },
      post: fakePost({ raw: '{"actions":[{"action":"a","durationMs":80}]}' }),
      sleep: async () => {},
      onLog: (entry) => logs.push(entry.message),
    });
    // A session where the game ignores input can then be distinguished from one
    // where nothing was transmitted.
    expect(logs.join(" ")).toContain(`0x${GAMEPAD_A.toString(16)}`);
  });
});

describe("vision in the loop", () => {
  const FRAME = { dataUrl: "data:image/jpeg;base64,AAAA", width: 640, height: 360 };

  it("captures a frame every round and attaches it to the observation", async () => {
    const controller = new AbortController();
    const frames = [FRAME, { ...FRAME, width: 320 }];
    let calls = 0;
    const seen: Array<number | undefined> = [];
    await runAiPlayerLoop({
      sink: { send: () => true },
      buildObservation: (state) => {
        seen.push(state.frame?.width);
        return OBSERVATION;
      },
      options: {
        signal: controller.signal,
        // A stale screenshot would make the model act on a situation that no
        // longer exists, so a fresh one per round is the contract.
        captureFrame: () => frames[calls++] ?? null,
        post: fakePost({ raw: '{"plan":"look","actions":[]}' }),
        now: () => 0,
        intervalMs: 60,
        sleep: async () => {
          if (calls >= 2) controller.abort();
        },
      },
      onState: (state) => {
        if (!state.running) expect(state.framesCaptured).toBeGreaterThan(0);
      },
    });
    expect(seen[0]).toBe(640);
    expect(seen[1]).toBe(320);
  });

  it("runs blind when capture fails, without stalling", async () => {
    const controller = new AbortController();
    let rounds = 0;
    await runAiPlayerLoop({
      sink: { send: () => true },
      buildObservation: (state) => {
        expect(state.frame).toBeNull();
        return OBSERVATION;
      },
      options: {
        signal: controller.signal,
        captureFrame: () => null,
        post: fakePost({ raw: '{"plan":"blind","actions":[]}' }),
        now: () => 0,
        intervalMs: 60,
        sleep: async () => {
          rounds += 1;
          controller.abort();
        },
      },
    });
    expect(rounds).toBeGreaterThan(0);
  });
});

describe("chat mode", () => {
  it("sends the instruction and stops after one round", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const post: AiPlayerPost<never> = async (path, body) => {
      calls.push({ path, body });
      return { raw: '{"reply":"了解しました。決定を押します","actions":[{"action":"a","durationMs":80}]}' };
    };
    const replies: string[] = [];
    const log: string[] = [];
    await runAiPlayerLoop({
      sink: { send: () => true },
      buildObservation: () => OBSERVATION,
      options: {
        mode: "chat",
        maxRounds: 1,
        instruction: "決定を押して",
        // Cast: the test double ignores the body type.
        post: post as unknown as AiPlayerPost,
        now: () => 0,
        sleep: async () => {},
        onRound: (decision, entry) => {
          log.push(entry.message);
          if (decision?.reply) replies.push(decision.reply);
        },
      },
    });
    // Hits the chat route, not the auto one.
    expect(calls[0].path).toContain("/chat");
    expect(String((calls[0].body as { message?: string }).message)).toBe("決定を押して");
    expect(replies.join(" ")).toContain("了解しました");
    expect(log.join(" ")).toContain("了解しました");
  });

  it("does not repeat a consumed instruction on the next round", async () => {
    const messages: Array<string | undefined> = [];
    const post: AiPlayerPost<never> = async (_path, body) => {
      messages.push((body as { message?: string }).message);
      return { raw: '{"reply":"はい","actions":[]}' };
    };
    const controller = new AbortController();
    let sleeps = 0;
    await runAiPlayerLoop({
      sink: { send: () => true },
      buildObservation: () => OBSERVATION,
      options: {
        mode: "chat",
        instruction: "一回だけ",
        post: post as unknown as AiPlayerPost,
        signal: controller.signal,
        now: () => 0,
        intervalMs: 60,
        sleep: async () => {
          sleeps += 1;
          if (sleeps >= 2) controller.abort();
        },
      },
    });
    expect(messages[0]).toBe("一回だけ");
    // Later rounds carry no instruction: repeating it would turn one request
    // into a permanent command.
    expect(messages.slice(1).every((message) => message === undefined)).toBe(true);
  });
});
