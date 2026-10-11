import { describe, expect, it, vi } from "vitest";
import { providersNearLimit, UsageGuard } from "../server/usage";

describe("providersNearLimit", () => {
  it("flags providers with any window at or above the threshold", () => {
    const near = providersNearLimit([
      { providerId: "claude", windows: [{ usedPct: 40 }, { usedPct: 95 }] },
      { providerId: "codex", windows: [{ usedPct: 89 }, { usedPct: null }] },
      { providerId: "opencode", windows: [] },
    ]);
    expect([...near]).toEqual(["claude"]);
  });
});

describe("UsageGuard", () => {
  it("caches usage and never blocks when usage cannot be read", async () => {
    let now = 0;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce([{ providerId: "claude", windows: [{ usedPct: 99 }] }])
      .mockRejectedValueOnce(new Error("offline"));
    const guard = new UsageGuard(fetch, () => now, () => undefined);
    expect([...(await guard.nearLimit())]).toEqual(["claude"]);
    now = 60_000;
    expect([...(await guard.nearLimit())]).toEqual(["claude"]);
    expect(fetch).toHaveBeenCalledOnce();
    now = 10 * 60_000;
    expect([...(await guard.nearLimit())]).toEqual([]);
  });
});
