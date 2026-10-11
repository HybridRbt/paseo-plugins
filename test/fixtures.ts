import type { StoredRecap } from "../shared/recap";

export function makeRecap(overrides: Partial<StoredRecap> = {}): StoredRecap {
  return {
    agentId: "a",
    summary: "S",
    nextAction: null,
    generatedAt: "2026-10-07T00:00:00.000Z",
    revision: 1,
    turnCount: 3,
    stale: false,
    trigger: "auto",
    generator: { provider: "claude", model: "haiku" },
    agent: { title: "Agent", workspaceId: "ws", provider: "claude" },
    ...overrides,
  };
}
