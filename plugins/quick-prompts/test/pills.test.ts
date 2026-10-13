import type { PluginButton, PluginComposerPillContribution } from "@getpaseo/plugin/client";
import { describe, expect, it } from "vitest";
import { createPromptPills } from "../client/pills";
import type { QuickPrompt } from "../shared/prompts";

interface FakePill {
  agentId: string;
  id: string;
  button: PluginButton;
  removed: boolean;
}

function setup() {
  const pills: FakePill[] = [];
  const sent: Array<[string, string]> = [];
  let settingsOpened = 0;
  const controller = createPromptPills({
    addComposerPill({ id, agentId, button }: PluginComposerPillContribution) {
      if (pills.some((pill) => !pill.removed && pill.agentId === agentId && pill.id === id)) {
        throw new Error(`Duplicate pill ${id}`);
      }
      const pill: FakePill = { agentId, id, button, removed: false };
      pills.push(pill);
      return {
        update: (patch) => {
          if (!pill.removed) pill.button = { ...pill.button, ...patch };
        },
        remove: () => {
          pill.removed = true;
        },
      };
    },
    send: async (agentId, text) => {
      sent.push([agentId, text]);
    },
    openSettings: () => {
      settingsOpened += 1;
    },
  });
  /** Live pill labels per agent, in registration (display) order. */
  const shown = () => {
    const result: Record<string, Array<string | undefined>> = {};
    for (const pill of pills.filter(({ removed }) => !removed)) {
      (result[pill.agentId] ??= []).push(pill.button.label);
    }
    return result;
  };
  const press = async (agentId: string, label: string) => {
    const pill = pills.find((item) => !item.removed && item.agentId === agentId && item.button.label === label);
    if (pill?.button.behavior.kind !== "action") throw new Error(`No action pill ${label} on ${agentId}`);
    await pill.button.behavior.onPress();
  };
  return { controller, pills, sent, shown, press, settingsOpened: () => settingsOpened };
}

const review: QuickPrompt = { id: "r1", label: "Review", text: "Review the changes." };
const tests: QuickPrompt = { id: "t1", label: "Tests", text: "Run the tests." };
const agent = (id: string, workspaceId: string | null = "w1", archivedAt: string | null = null) => ({
  id,
  workspaceId,
  archivedAt,
});

describe("createPromptPills", () => {
  it("adds nothing until prompts load, then one pill per prompt on agents with a workspace", () => {
    const { controller, shown } = setup();
    controller.setAgents([agent("a"), agent("b"), agent("no-workspace", null), agent("old", "w1", "2026-01-01")]);
    expect(shown()).toEqual({});
    controller.setPrompts([review, tests]);
    expect(shown()).toEqual({ a: ["Review", "Tests"], b: ["Review", "Tests"] });
  });

  it("sends the prompt text to the pill's agent and opens settings from the empty pill", async () => {
    const { controller, shown, sent, press, settingsOpened } = setup();
    controller.setPrompts([]);
    controller.setAgents([agent("a")]);
    expect(shown()).toEqual({ a: ["Add quick prompt"] });
    await press("a", "Add quick prompt");
    expect(settingsOpened()).toBe(1);

    controller.setPrompts([review]);
    expect(shown()).toEqual({ a: ["Review"] });
    await press("a", "Review");
    expect(sent).toEqual([["a", "Review the changes."]]);
  });

  it("follows prompt renames, edits, reorders, and removals", async () => {
    const { controller, pills, shown, sent, press } = setup();
    controller.setPrompts([review, tests]);
    controller.setAgents([agent("a")]);
    const registered = pills.length;

    controller.setPrompts([{ ...review, label: "Check", text: "Check again." }, tests]);
    expect(pills.length).toBe(registered);
    expect(shown()).toEqual({ a: ["Check", "Tests"] });
    await press("a", "Check");
    expect(sent).toEqual([["a", "Check again."]]);

    controller.setPrompts([tests, review]);
    expect(shown()).toEqual({ a: ["Tests", "Review"] });

    controller.setPrompts([tests]);
    expect(shown()).toEqual({ a: ["Tests"] });

    controller.setPrompts([]);
    expect(shown()).toEqual({ a: ["Add quick prompt"] });
  });

  it("follows agents appearing, being archived, moving, and being removed", () => {
    const { controller, shown } = setup();
    controller.setPrompts([review]);
    controller.setAgents([agent("a")]);

    controller.upsertAgent(agent("b"));
    controller.upsertAgent(agent("a"));
    expect(shown()).toEqual({ a: ["Review"], b: ["Review"] });

    controller.upsertAgent(agent("b", "w2"));
    expect(shown()).toEqual({ a: ["Review"], b: ["Review"] });

    controller.upsertAgent(agent("a", "w1", "2026-01-01"));
    expect(shown()).toEqual({ b: ["Review"] });

    controller.removeAgent("b");
    expect(shown()).toEqual({});
  });

  it("replaces agents on a new snapshot and removes everything on cleanup", () => {
    const { controller, shown } = setup();
    controller.setPrompts([review]);
    controller.setAgents([agent("a"), agent("b")]);
    controller.setAgents([agent("b"), agent("c")]);
    expect(shown()).toEqual({ b: ["Review"], c: ["Review"] });

    controller.removeAll();
    expect(shown()).toEqual({});
    controller.setPrompts([review, tests]);
    expect(shown()).toEqual({});
  });
});
