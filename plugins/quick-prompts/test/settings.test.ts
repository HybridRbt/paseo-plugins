import { describe, expect, it } from "vitest";
import { MAX_PROMPTS, promptsFromSettings, quickPromptsSettings } from "../shared/prompts";

const parse = (prompts: unknown) => quickPromptsSettings.schema.safeParse({ prompts });
const prompt = (id: string, label = "Review", text = "Review the changes.") => ({ id, label, text });

describe("quickPromptsSettings", () => {
  it("starts empty and trims saved labels and prompts", () => {
    expect(quickPromptsSettings.schema.parse({})).toEqual({ prompts: [] });
    expect(parse([prompt("a1", "  Review ", " Look again.\n")]).data?.prompts).toEqual([
      prompt("a1", "Review", "Look again."),
    ]);
  });

  it("rejects blank or long labels, blank prompts, and ids a pill id cannot carry", () => {
    expect(parse([prompt("a1", "   ")]).success).toBe(false);
    expect(parse([prompt("a1", "x".repeat(41))]).success).toBe(false);
    expect(parse([prompt("a1", "x".repeat(40))]).success).toBe(true);
    expect(parse([prompt("a1", "Review", " \n ")]).success).toBe(false);
    expect(parse([prompt("A-1")]).success).toBe(false);
  });

  it("rejects duplicate ids and more than the maximum count", () => {
    expect(parse([prompt("a1"), prompt("a1")]).success).toBe(false);
    const many = Array.from({ length: MAX_PROMPTS + 1 }, (_, index) => prompt(`p${index}`));
    expect(parse(many.slice(0, MAX_PROMPTS)).success).toBe(true);
    expect(parse(many).success).toBe(false);
  });

  it("treats invalid stored data as no prompts", () => {
    expect(promptsFromSettings({ status: "ready", values: { prompts: [prompt("a1")] } })).toEqual([prompt("a1")]);
    expect(promptsFromSettings({ status: "ready", values: { prompts: [prompt("a1", "")] } })).toEqual([]);
    expect(promptsFromSettings({ status: "invalid" })).toEqual([]);
  });
});
