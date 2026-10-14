import type { PluginButton, PluginComposerPillContribution } from "@getpaseo/plugin/client";
import { describe, expect, it } from "vitest";
import { createPromptPills } from "../client/pills";
import type { PromptDisplay, QuickPrompt } from "../shared/prompts";

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
  /** Item titles of an agent's live menu pill. */
  const menu = (agentId: string) => {
    const pill = pills.find((item) => !item.removed && item.agentId === agentId);
    if (pill?.button.behavior.kind !== "menu") throw new Error(`No menu pill on ${agentId}`);
    return pill.button.behavior.items.map((item) => (item.kind === "item" ? item.title : "---"));
  };
  const choose = async (agentId: string, title: string) => {
    const pill = pills.find((item) => !item.removed && item.agentId === agentId);
    if (pill?.button.behavior.kind !== "menu") throw new Error(`No menu pill on ${agentId}`);
    const item = pill.button.behavior.items.find((entry) => entry.kind === "item" && entry.title === title);
    if (item?.kind !== "item" || item.behavior.kind !== "action") throw new Error(`No menu action ${title}`);
    await item.behavior.onPress();
  };
  return { controller, pills, sent, shown, press, menu, choose, settingsOpened: () => settingsOpened };
}

const review: QuickPrompt = { id: "r1", label: "Review", text: "Review the changes." };
const tests: QuickPrompt = { id: "t1", label: "Tests", text: "Run the tests." };
const library = (prompts: QuickPrompt[], display: PromptDisplay = "pills") => ({ prompts, display });
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
    controller.setSettings(library([review, tests]));
    expect(shown()).toEqual({ a: ["Review", "Tests"], b: ["Review", "Tests"] });
  });

  it("sends the prompt text to the pill's agent and opens settings from the empty pill", async () => {
    const { controller, shown, sent, press, settingsOpened } = setup();
    controller.setSettings(library([]));
    controller.setAgents([agent("a")]);
    expect(shown()).toEqual({ a: ["Add quick prompt"] });
    await press("a", "Add quick prompt");
    expect(settingsOpened()).toBe(1);

    controller.setSettings(library([review]));
    expect(shown()).toEqual({ a: ["Review"] });
    await press("a", "Review");
    expect(sent).toEqual([["a", "Review the changes."]]);
  });

  it("follows prompt renames, edits, reorders, and removals", async () => {
    const { controller, pills, shown, sent, press } = setup();
    controller.setSettings(library([review, tests]));
    controller.setAgents([agent("a")]);
    const registered = pills.length;

    controller.setSettings(library([{ ...review, label: "Check", text: "Check again." }, tests]));
    expect(pills.length).toBe(registered);
    expect(shown()).toEqual({ a: ["Check", "Tests"] });
    await press("a", "Check");
    expect(sent).toEqual([["a", "Check again."]]);

    controller.setSettings(library([tests, review]));
    expect(shown()).toEqual({ a: ["Tests", "Review"] });

    controller.setSettings(library([tests]));
    expect(shown()).toEqual({ a: ["Tests"] });

    controller.setSettings(library([]));
    expect(shown()).toEqual({ a: ["Add quick prompt"] });
  });

  it("follows agents appearing, being archived, moving, and being removed", () => {
    const { controller, shown } = setup();
    controller.setSettings(library([review]));
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
    controller.setSettings(library([review]));
    controller.setAgents([agent("a"), agent("b")]);
    controller.setAgents([agent("b"), agent("c")]);
    expect(shown()).toEqual({ b: ["Review"], c: ["Review"] });

    controller.removeAll();
    expect(shown()).toEqual({});
    controller.setSettings(library([review, tests]));
    expect(shown()).toEqual({});
  });

  it("shows one Prompts pill whose menu sends each prompt, and keeps the empty pill", async () => {
    const { controller, shown, menu, choose, sent, settingsOpened } = setup();
    controller.setAgents([agent("a")]);
    controller.setSettings(library([], "menu"));
    expect(shown()).toEqual({ a: ["Add quick prompt"] });

    controller.setSettings(library([review, tests], "menu"));
    expect(shown()).toEqual({ a: ["Prompts"] });
    expect(menu("a")).toEqual(["Review", "Tests", "---", "Manage prompts"]);
    await choose("a", "Tests");
    expect(sent).toEqual([["a", "Run the tests."]]);
    await choose("a", "Manage prompts");
    expect(settingsOpened()).toBe(1);
  });

  it("updates the menu in place as prompts change", async () => {
    const { controller, pills, shown, menu, choose, sent } = setup();
    controller.setSettings(library([review, tests], "menu"));
    controller.setAgents([agent("a")]);
    const registered = pills.length;

    const docs: QuickPrompt = { id: "d1", label: "Docs", text: "Update the docs." };
    controller.setSettings(library([tests, { ...review, label: "Check", text: "Check again." }, docs], "menu"));
    expect(pills.length).toBe(registered);
    expect(menu("a")).toEqual(["Tests", "Check", "Docs", "---", "Manage prompts"]);
    await choose("a", "Check");
    expect(sent).toEqual([["a", "Check again."]]);

    controller.setSettings(library([], "menu"));
    expect(shown()).toEqual({ a: ["Add quick prompt"] });
  });

  it("switches between separate pills and the menu without duplicates", () => {
    const { controller, shown } = setup();
    controller.setAgents([agent("a"), agent("b")]);
    controller.setSettings(library([review, tests]));
    expect(shown()).toEqual({ a: ["Review", "Tests"], b: ["Review", "Tests"] });

    controller.setSettings(library([review, tests], "menu"));
    expect(shown()).toEqual({ a: ["Prompts"], b: ["Prompts"] });

    controller.setSettings(library([review], "pills"));
    expect(shown()).toEqual({ a: ["Review"], b: ["Review"] });
  });
});
