import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { quickPromptsSettings, settingsFromRead } from "../shared/prompts";
import type { PromptPills } from "./pills";

type Client = Pick<PluginClientContext, "paseo" | "rpc">;

/** Follows the agent directory: existing agents first, then updates, and a fresh snapshot after a reconnect. */
export function followAgents(client: Client, pills: PromptPills, signal: AbortSignal): void {
  client.paseo.agents
    .list({ subscribe: {}, signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => pills.setAgents(entries.map(({ agent }) => agent)),
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") pills.removeAgent(update.agentId);
          else pills.upsertAgent(update.agent);
        },
      });
    })
    .catch((error: unknown) => {
      if (!signal.aborted) console.error("[paseo-quick-prompts] agent observation failed", error);
    });
}

/** Reads the saved prompts now, after a reconnect, and whenever any client saves them. */
export function followPrompts(client: Client, pills: PromptPills, signal: AbortSignal): void {
  const { read } = settingsRpc(quickPromptsSettings.id);
  let latest = 0;
  const load = async (): Promise<void> => {
    const request = ++latest;
    try {
      const result = await client.rpc(read, {});
      if (!signal.aborted && request === latest) pills.setSettings(settingsFromRead(result));
    } catch (error) {
      if (!signal.aborted) console.error("[paseo-quick-prompts] failed to load quick prompts", error);
    }
  };
  client.paseo.observeEvents(["status.plugin_settings_changed"], { signal }).subscribe({
    snapshot: () => void load(),
    update: (message) => {
      if (
        message.type === "status" &&
        message.payload.status === "plugin_settings_changed" &&
        message.payload.settingsId === quickPromptsSettings.id
      ) {
        void load();
      }
    },
  });
}
