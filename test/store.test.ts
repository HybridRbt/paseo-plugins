import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIOUS_RECAPS_KEPT, RecapStore, RECAP_RETENTION_MS } from "../server/store";
import { makeRecap } from "./fixtures";

async function tempPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "recap-store-")), "nested", "recaps.json");
}

describe("RecapStore", () => {
  it("persists, reloads, marks stale, and deletes", async () => {
    const path = await tempPath();
    const store = new RecapStore(path, () => undefined);
    await store.load();
    await store.set(makeRecap());
    await store.markStale("a");

    const reloaded = new RecapStore(path, () => undefined);
    await reloaded.load(Date.parse("2026-10-08T00:00:00.000Z"));
    expect(reloaded.get("a")).toEqual(makeRecap({ stale: true }));

    await reloaded.delete("a");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, agents: {} });
  });

  it("keeps a bounded history of earlier recaps, newest first", async () => {
    const store = new RecapStore(await tempPath(), () => undefined);
    for (let index = 0; index < PREVIOUS_RECAPS_KEPT + 3; index++) {
      await store.set(makeRecap({ summary: `recap ${index}`, revision: index }));
    }
    expect(store.get("a")?.summary).toBe(`recap ${PREVIOUS_RECAPS_KEPT + 2}`);
    const previous = store.previous("a");
    expect(previous).toHaveLength(PREVIOUS_RECAPS_KEPT);
    expect(previous[0]).toMatchObject({ summary: `recap ${PREVIOUS_RECAPS_KEPT + 1}`, stale: true });
  });

  it("drops recaps older than the retention window on load", async () => {
    const path = await tempPath();
    const store = new RecapStore(path, () => undefined);
    await store.set(makeRecap({ agentId: "old", generatedAt: "2026-01-01T00:00:00.000Z" }));
    await store.set(makeRecap({ agentId: "new", generatedAt: "2026-10-01T00:00:00.000Z" }));
    const reloaded = new RecapStore(path, () => undefined);
    await reloaded.load(Date.parse("2026-10-01T00:00:00.000Z") + RECAP_RETENTION_MS - 1);
    expect(reloaded.all().map((recap) => recap.agentId)).toEqual(["new"]);
  });

  it("starts empty on a corrupt file", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "recap-store-")), "recaps.json");
    await writeFile(path, "{not json");
    const logs: string[] = [];
    const store = new RecapStore(path, (message) => logs.push(message));
    await store.load();
    expect(store.all()).toEqual([]);
    expect(logs).toHaveLength(1);
  });
});
