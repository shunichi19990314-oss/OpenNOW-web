import { describe, expect, it, vi } from "vitest";

import {
  AI_PLAYER_ACTION_NAMES,
  buildActionSequence,
  isKnownGamepadAction,
  NEUTRAL_GAMEPAD_STATE,
  resolveGamepadAction,
} from "./aiPlayerActions";
import { parseAiPlayerDecision, buildAiPlayerPrompt } from "../../shared/aiPlayerPrompt";
import { runAiPlayerLoop, runAiPlayerRound } from "./aiPlayerLoop";
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
    expect(parseAiPlayerDecision("", OBSERVATION).problem).toBe("empty reply");
    expect(parseAiPlayerDecision("not json", OBSERVATION).problem).toBe("reply was not JSON");
    expect(parseAiPlayerDecision('{"unrelated":true}', OBSERVATION).problem).toBe("no plan and no usable actions");
  });

  it("builds a compact prompt", () => {
    const prompt = buildAiPlayerPrompt({ ...OBSERVATION, plan: "walk north", signals: ["low health"] });
    expect(prompt).toContain("Test Game");
    expect(prompt).toContain("walk north");
    expect(prompt).toContain("a, b, dpad_down");
  });
});

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("AI player round", () => {
  it("presses the decoded action and always releases", async () => {
    const sent: number[] = [];
    const decision = await runAiPlayerRound({
      observation: OBSERVATION,
      sink: { send: (state) => { sent.push(state.buttons); return true; } },
      fetchImpl: fakeFetch({ raw: '{"plan":"jump","actions":[{"action":"a","durationMs":120}]}' }),
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
      fetchImpl: fakeFetch({ raw: "I cannot do that." }),
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
      fetchImpl: fakeFetch({ raw: '{"plan":"x","actions":[{"action":"a","durationMs":100},{"action":"b","durationMs":100}]}' }),
      sleep: async () => {},
    });
    // First attempt fails, so the loop must not queue the remaining actions.
    expect(send).toHaveBeenCalledTimes(2); // one action attempt + the final neutral
  });

  it("explains a missing key from the proxy", async () => {
    const logs: string[] = [];
    await runAiPlayerRound({
      observation: OBSERVATION,
      sink: { send: () => true },
      fetchImpl: vi.fn(async () => ({
        ok: false,
        status: 503,
        headers: new Headers(),
        json: async () => ({ error: "missing_key", message: "no key" }),
      })) as unknown as typeof fetch,
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
      fetchImpl: vi.fn(async () => { throw new TypeError("failed to fetch"); }) as unknown as typeof fetch,
      sleep: async () => {},
      onLog: (entry) => logs.push(entry.message),
    });
    expect(logs.join(" ")).toContain("接続できません");
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
        fetchImpl: fakeFetch({ raw: '{"plan":"step","actions":[{"action":"a","durationMs":100}]}' }),
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
        fetchImpl: fakeFetch({}, 500),
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
