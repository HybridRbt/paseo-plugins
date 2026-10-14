import { describe, expect, it } from "vitest";
import {
  addPrompt,
  applyEdit,
  deletePrompt,
  movePrompt,
  saveEdit,
  setDisplay,
  updatePrompt,
  type SettingsDoc,
  type SettingsIo,
} from "../client/edits";
import { MAX_PROMPTS, quickPromptsSettings, type QuickPromptsSettings } from "../shared/prompts";

const prompt = (id: string, label = `Label ${id}`, text = `Text ${id}`) => ({ id, label, text });
const values = (...ids: string[]): QuickPromptsSettings => ({ prompts: ids.map((id) => prompt(id)), display: "pills" });
const ids = (settings: QuickPromptsSettings | null) => settings?.prompts.map(({ id }) => id);

/** A host that stores one document and rejects writes against any other revision. */
function host(stored: SettingsDoc) {
  const remote = { stored, writes: [] as string[] };
  const io: SettingsIo = {
    async write({ revision, values: written }) {
      remote.writes.push(revision);
      if (revision !== remote.stored.revision) return { status: "conflict", error: "Settings changed" };
      remote.stored = { values: quickPromptsSettings.schema.parse(written), revision: `saved-${remote.writes.length}` };
      return { status: "saved", ...remote.stored };
    },
    async read() {
      return { status: "ready", ...remote.stored };
    },
  };
  return Object.assign(remote, { io });
}

describe("edits", () => {
  it("update, move, and delete prompts by id", () => {
    expect(applyEdit(updatePrompt("b", "label", "New"), values("a", "b"))?.prompts[1]).toEqual(prompt("b", "New"));
    expect(ids(applyEdit(movePrompt("b", -1), values("a", "b", "c")))).toEqual(["b", "a", "c"]);
    expect(ids(applyEdit(movePrompt("b", 1), values("a", "b", "c")))).toEqual(["a", "c", "b"]);
    expect(ids(applyEdit(deletePrompt("a"), values("a", "b")))).toEqual(["b"]);
    expect(applyEdit(setDisplay("menu"), values("a"))?.display).toBe("menu");
  });

  it("do not apply to a missing prompt, past either end, or over the maximum", () => {
    expect(applyEdit(updatePrompt("x", "text", "New"), values("a"))).toBeNull();
    expect(applyEdit(deletePrompt("x"), values("a"))).toBeNull();
    expect(applyEdit(movePrompt("a", -1), values("a", "b"))).toBeNull();
    expect(applyEdit(movePrompt("b", 1), values("a", "b"))).toBeNull();
    const full = values(...Array.from({ length: MAX_PROMPTS }, (_, index) => `p${index}`));
    expect(applyEdit(addPrompt(prompt("new")), full)).toBeNull();
  });

  it("do not apply when the result would not save", () => {
    expect(applyEdit(updatePrompt("a", "label", "  "), values("a"))).toBeNull();
    expect(applyEdit(addPrompt(prompt("a")), values("a"))).toBeNull();
  });
});

describe("saveEdit", () => {
  it("saves against the given revision", async () => {
    const remote = host({ values: values("a", "b"), revision: "1" });
    const outcome = await saveEdit(deletePrompt("a"), remote.stored, remote.io);
    expect(outcome).toEqual({ status: "saved", doc: remote.stored });
    expect(ids(remote.stored.values)).toEqual(["b"]);
  });

  it("sends nothing when the edit does not apply to the values on screen", async () => {
    const remote = host({ values: values("a"), revision: "1" });
    expect(await saveEdit(deletePrompt("x"), remote.stored, remote.io)).toEqual({ status: "unchanged" });
    expect(remote.writes).toEqual([]);
  });

  it("applies the edit again to another client's newer values after a conflict", async () => {
    const remote = host({ values: values("a", "b"), revision: "1" });
    const onScreen = remote.stored;
    remote.stored = { values: values("a", "b", "c"), revision: "2" };
    const outcome = await saveEdit(updatePrompt("b", "text", "Mine"), onScreen, remote.io);
    expect(outcome.status).toBe("saved");
    expect(remote.writes).toEqual(["1", "2"]);
    expect(remote.stored.values.prompts).toEqual([prompt("a"), prompt("b", "Label b", "Mine"), prompt("c")]);
  });

  it("returns the latest values when another client's change makes the edit inapplicable", async () => {
    const remote = host({ values: values("a", "b"), revision: "1" });
    const onScreen = remote.stored;
    remote.stored = { values: values("a"), revision: "2" };
    const outcome = await saveEdit(updatePrompt("b", "text", "Mine"), onScreen, remote.io);
    expect(outcome).toEqual({ status: "stale", doc: { values: values("a"), revision: "2" } });
    expect(remote.writes).toEqual(["1"]);
  });

  it("retries only once", async () => {
    let reads = 0;
    const io: SettingsIo = {
      write: async () => ({ status: "conflict", error: "Settings changed" }),
      read: async () => ({ status: "ready", values: values("a"), revision: `${(reads += 1)}` }),
    };
    const outcome = await saveEdit(setDisplay("menu"), { values: values("a"), revision: "0" }, io);
    expect(outcome).toEqual({ status: "stale", doc: { values: values("a"), revision: "2" } });
  });

  it("fails without throwing when the host cannot be reached", async () => {
    const io: SettingsIo = {
      write: async () => {
        throw new Error("offline");
      },
      read: async () => ({ status: "ready", values: values(), revision: "1" }),
    };
    const outcome = await saveEdit(setDisplay("menu"), { values: values(), revision: "1" }, io);
    expect(outcome.status).toBe("failed");
  });
});
