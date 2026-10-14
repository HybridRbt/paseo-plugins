import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { quickPromptsSettings, settingsFromRead } from "../shared/prompts";
import type { PillAgent, PromptPills } from "./pills";

type Paseo = PluginClientContext["paseo"];
type Client = Pick<PluginClientContext, "paseo" | "rpc">;

/** The host's largest agent directory page, which is also its default. */
const PAGE_LIMIT = 200;
/** Waits before starting a failed observation again; after the last one it stops. */
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 60_000];

interface Attempt {
  /** Aborted when this attempt fails or the lifetime ends; releases its subscription. */
  signal: AbortSignal;
  /** The observation is fully up to date; later failures start the delays from the beginning. */
  ready(): void;
  failed(error: unknown): void;
}

/** Starts an observation and, after it fails, starts it again with bounded retries. */
function observeWithRetry(name: string, lifetime: AbortSignal, start: (attempt: Attempt) => void): void {
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  lifetime.addEventListener("abort", () => clearTimeout(timer), { once: true });
  const run = (): void => {
    if (lifetime.aborted) return;
    const controller = new AbortController();
    const stop = (): void => controller.abort();
    lifetime.addEventListener("abort", stop, { once: true });
    start({
      signal: controller.signal,
      ready: () => {
        failures = 0;
      },
      failed: (error) => {
        if (controller.signal.aborted) return;
        lifetime.removeEventListener("abort", stop);
        controller.abort();
        const delay = RETRY_DELAYS_MS[failures];
        failures += 1;
        if (delay === undefined) {
          console.error(`[paseo-quick-prompts] ${name} failed; not retrying`, error);
          return;
        }
        console.error(`[paseo-quick-prompts] ${name} failed; retrying in ${delay / 1000}s`, error);
        timer = setTimeout(run, delay);
      },
    });
  };
  run();
}

type AgentListResult = Awaited<ReturnType<Paseo["agents"]["list"]>>;
type AgentSubscription = NonNullable<AgentListResult["subscription"]>;
type AgentMessage = Parameters<Parameters<AgentSubscription["subscribe"]>[0]["update"]>[0];

/** One page of the agent directory, with only what the pills read. */
export interface AgentPage {
  entries: ReadonlyArray<{ agent: PillAgent }>;
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

/** The part of `paseo.agents` that following the directory uses. */
export interface AgentDirectory {
  /** A subscription that delivers the first page, then updates, and a fresh first page after a reconnect. */
  subscribe(signal: AbortSignal): Promise<{
    subscription: {
      subscribe(observer: {
        snapshot(page: AgentPage): void;
        update(message: AgentMessage): void;
        error(error: unknown): void;
      }): () => void;
    };
  }>;
  page(cursor: string): Promise<AgentPage>;
}

/** Follows every agent: all pages of existing agents first, then updates. */
export function followAgents(client: Client, pills: PromptPills, lifetime: AbortSignal): void {
  followAgentDirectory(
    {
      subscribe: (signal) => client.paseo.agents.list({ subscribe: {}, signal }),
      page: (cursor) => client.paseo.agents.list({ page: { limit: PAGE_LIMIT, cursor } }),
    },
    pills,
    lifetime,
  );
}

export function followAgentDirectory(directory: AgentDirectory, pills: PromptPills, lifetime: AbortSignal): void {
  observeWithRetry("agent observation", lifetime, ({ signal, ready, failed }) => {
    let bootstrap = 0;
    /** Agents updated or removed (null) while later pages load; they are newer than those pages. */
    let changed: Map<string, PillAgent | null> | null = null;

    const loadAll = async (generation: number, agents: PillAgent[], cursor: string | null): Promise<void> => {
      const updates = new Map<string, PillAgent | null>();
      changed = updates;
      while (cursor) {
        const page = await directory.page(cursor);
        if (signal.aborted || generation !== bootstrap) return;
        agents.push(...page.entries.map(({ agent }) => agent));
        cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
      }
      changed = null;
      const byId = new Map(agents.map((agent) => [agent.id, agent]));
      for (const [agentId, agent] of updates) {
        if (agent) byId.set(agentId, agent);
        else byId.delete(agentId);
      }
      pills.setAgents([...byId.values()]);
      ready();
    };

    directory
      .subscribe(signal)
      .then(({ subscription }) => {
        subscription.subscribe({
          snapshot: ({ entries, pageInfo }) => {
            const generation = ++bootstrap;
            const agents = entries.map(({ agent }) => agent);
            if (!pageInfo.hasMore) {
              changed = null;
              pills.setAgents(agents);
              ready();
              return;
            }
            loadAll(generation, agents, pageInfo.nextCursor).catch(failed);
          },
          update: (message) => {
            if (message.type !== "agent_update") return;
            const update = message.payload;
            if (update.kind === "remove") {
              changed?.set(update.agentId, null);
              pills.removeAgent(update.agentId);
            } else {
              changed?.set(update.agent.id, update.agent);
              pills.upsertAgent(update.agent);
            }
          },
          error: failed,
        });
        return undefined;
      })
      .catch(failed);
  });
}

/** Calls `onChange` now, after a reconnect, and whenever any client saves the quick prompts. */
export function followPromptChanges(paseo: Paseo, lifetime: AbortSignal, onChange: () => void): void {
  observeWithRetry("settings observation", lifetime, ({ signal, ready, failed }) => {
    paseo.observeEvents(["status.plugin_settings_changed"], { signal }).subscribe({
      snapshot: () => {
        ready();
        onChange();
      },
      update: (message) => {
        if (
          message.type === "status" &&
          message.payload.status === "plugin_settings_changed" &&
          message.payload.settingsId === quickPromptsSettings.id
        ) {
          onChange();
        }
      },
      error: failed,
    });
  });
}

/** Keeps the pills on the saved prompts. */
export function followPrompts(client: Client, pills: PromptPills, lifetime: AbortSignal): void {
  const { read } = settingsRpc(quickPromptsSettings.id);
  let latest = 0;
  const load = async (): Promise<void> => {
    const request = ++latest;
    try {
      const result = await client.rpc(read, {});
      if (!lifetime.aborted && request === latest) pills.setSettings(settingsFromRead(result));
    } catch (error) {
      if (!lifetime.aborted) console.error("[paseo-quick-prompts] failed to load quick prompts", error);
    }
  };
  followPromptChanges(client.paseo, lifetime, () => void load());
}
