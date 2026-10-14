import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followAgentDirectory, type AgentDirectory, type AgentPage } from "../client/follow";
import type { PromptPills } from "../client/pills";

const pills = (): PromptPills & { agents: string[][] } => {
  const agents: string[][] = [];
  return {
    agents,
    setSettings: () => {},
    setAgents: (list) => void agents.push(list.map(({ id }) => id)),
    upsertAgent: () => {},
    removeAgent: () => {},
    removeAll: () => {},
  };
};

const page = (ids: string[], nextCursor: string | null): AgentPage => ({
  entries: ids.map((id) => ({ agent: { id, workspaceId: "w1" } })),
  pageInfo: { hasMore: nextCursor !== null, nextCursor },
});

/** A directory whose subscription delivers `first` and whose later pages come from `rest`. */
function directory(first: AgentPage, rest: (cursor: string) => Promise<AgentPage>) {
  const calls = { subscribe: 0 };
  const value: AgentDirectory = {
    subscribe: async () => {
      calls.subscribe += 1;
      return {
        subscription: {
          subscribe(observer) {
            observer.snapshot(first);
            return () => {};
          },
        },
      };
    },
    page: rest,
  };
  return { value, calls };
}

describe("followAgentDirectory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows agents from every page", async () => {
    const target = pills();
    const { value } = directory(page(["a"], "c1"), async () => page(["b"], null));
    followAgentDirectory(value, target, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(target.agents).toEqual([["a", "b"]]);
  });

  it("retries after 1, 5, 15, and 60 seconds when a later page keeps failing, then stops", async () => {
    const { value, calls } = directory(page(["a"], "c1"), async () => {
      throw new Error("offline");
    });
    const lifetime = new AbortController();
    followAgentDirectory(value, pills(), lifetime.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.subscribe).toBe(1);
    for (const [delay, expected] of [
      [1_000, 2],
      [5_000, 3],
      [15_000, 4],
      [60_000, 5],
    ] as const) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(calls.subscribe).toBe(expected - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls.subscribe).toBe(expected);
    }
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls.subscribe).toBe(5);
    lifetime.abort();
  });
});
