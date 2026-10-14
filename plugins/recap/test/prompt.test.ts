import { describe, expect, it } from "vitest";
import { byteLength } from "../server/history";
import { historyBudget, parseRecapOutput, PROMPT_MAX_BYTES, renderPrompt } from "../server/prompt";

describe("renderPrompt", () => {
  it("includes goal and task hints on one line each", () => {
    const prompt = renderPrompt("User: hi", { goal: "Ship\nrecaps", activeTask: "Write tests" });
    expect(prompt).toContain("Overall goal: Ship recaps\nActive task: Write tests");
    expect(prompt.endsWith("Conversation:\nUser: hi")).toBe(true);
  });

  it("budgets history so the whole prompt fits", () => {
    const context = { goal: "g", activeTask: null };
    const history = "x".repeat(historyBudget(context));
    expect(byteLength(renderPrompt(history, context))).toBe(PROMPT_MAX_BYTES);
  });
});

describe("parseRecapOutput", () => {
  it("accepts objects and fenced JSON text", () => {
    expect(parseRecapOutput({ summary: " Done. ", next_action: "" })).toEqual({
      summary: "Done.",
      nextAction: null,
    });
    expect(parseRecapOutput('```json\n{"summary":"S","next_action":"Ask"}\n```')).toEqual({
      summary: "S",
      nextAction: "Ask",
    });
  });

  it("rejects missing, empty, or oversized fields", () => {
    expect(parseRecapOutput("not json")).toBeNull();
    expect(parseRecapOutput({ summary: "" , next_action: null })).toBeNull();
    expect(parseRecapOutput({ summary: "s".repeat(701), next_action: null })).toBeNull();
    expect(parseRecapOutput({ summary: "s", next_action: "n".repeat(201) })).toBeNull();
    expect(parseRecapOutput({ summary: "s" })).toBeNull();
  });
});
