import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { recapListRpc, type RecapView } from "../shared/recap";
import { pillPresentation } from "./format";
import { makeRecapPopover } from "./recap-card";

const TICK_MS = 5_000;
const IDLE_POLL_MS = 30_000;
/** After agent activity, poll faster: a recap lands a few seconds after the idle delay. */
const ACTIVE_WINDOW_MS = 90_000;
const UPDATE_DEBOUNCE_MS = 1_000;

/**
 * Keeps one composer pill per agent in sync with daemon recaps. Recaps finish after an idle delay
 * without any agent update, so the list is also polled, faster right after agent activity.
 */
export class RecapPills {
  readonly #client: PluginClientContext;
  readonly #pills = new Map<string, PluginButtonRegistration>();
  readonly #lifetime = new AbortController();
  #views = new Map<string, RecapView>();
  #debounce: ReturnType<typeof setTimeout> | null = null;
  #poll: ReturnType<typeof setInterval> | null = null;
  #refreshing = false;
  #lastRefreshAt = 0;
  #activeUntil = 0;
  readonly #popover = makeRecapPopover(() => this.refresh());

  constructor(client: PluginClientContext) {
    this.#client = client;
  }

  start(): void {
    this.#client.paseo.agents
      .list({ subscribe: {}, signal: this.#lifetime.signal })
      .then(({ subscription }) => {
        subscription.subscribe({
          snapshot: ({ entries }) => {
            this.#removeAll();
            for (const { agent } of entries) this.#register(agent);
            this.#scheduleRefresh();
          },
          update: (message) => {
            if (message.type !== "agent_update") return;
            const update = message.payload;
            if (update.kind === "remove") this.#remove(update.agentId);
            else if (!this.#pills.has(update.agent.id)) this.#register(update.agent);
            this.#activeUntil = Date.now() + ACTIVE_WINDOW_MS;
            this.#scheduleRefresh();
          },
        });
      })
      .catch((error: unknown) => {
        if (!this.#lifetime.signal.aborted) console.error("[paseo-recap] agent observation failed", error);
      });
    this.#poll = setInterval(() => {
      const now = Date.now();
      if (now < this.#activeUntil || now - this.#lastRefreshAt >= IDLE_POLL_MS) void this.refresh();
    }, TICK_MS);
  }

  async refresh(): Promise<void> {
    if (this.#refreshing || this.#lifetime.signal.aborted) return;
    this.#refreshing = true;
    this.#lastRefreshAt = Date.now();
    try {
      const { recaps } = await this.#client.rpc(recapListRpc, {});
      this.#views = new Map(recaps.map((view) => [view.agentId, view]));
      this.#render();
    } catch (error) {
      console.error("[paseo-recap] failed to load recaps", error);
    } finally {
      this.#refreshing = false;
    }
  }

  stop(): void {
    this.#lifetime.abort();
    if (this.#debounce) clearTimeout(this.#debounce);
    if (this.#poll) clearInterval(this.#poll);
    this.#removeAll();
  }

  #register(agent: { id: string; workspaceId?: string | null }): void {
    if (this.#lifetime.signal.aborted || !agent.workspaceId) return;
    this.#pills.get(agent.id)?.remove();
    const presentation = pillPresentation(this.#views.get(agent.id), Date.now());
    const registration = this.#client.addComposerPill({
      id: "recap",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: {
        title: "Session recap",
        icon: presentation.icon,
        label: presentation.label,
        visible: presentation.visible,
        behavior: { kind: "popover", Content: this.#popover },
      },
    });
    this.#pills.set(agent.id, registration);
  }

  #render(): void {
    const now = Date.now();
    for (const [agentId, pill] of this.#pills) {
      const { visible, label, icon } = pillPresentation(this.#views.get(agentId), now);
      pill.update({ visible, label, icon });
    }
  }

  #scheduleRefresh(): void {
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      void this.refresh();
    }, UPDATE_DEBOUNCE_MS);
  }

  #remove(agentId: string): void {
    this.#pills.get(agentId)?.remove();
    this.#pills.delete(agentId);
  }

  #removeAll(): void {
    for (const pill of this.#pills.values()) pill.remove();
    this.#pills.clear();
  }
}
