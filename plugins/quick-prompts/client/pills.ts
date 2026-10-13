import type {
  PluginButton,
  PluginButtonRegistration,
  PluginComposerPillContribution,
} from "@getpaseo/plugin/client";
import type { QuickPrompt } from "../shared/prompts";

const ADD_PILL_ID = "add-quick-prompt";

export interface PromptPillHost {
  addComposerPill(contribution: PluginComposerPillContribution): PluginButtonRegistration;
  send(agentId: string, text: string): Promise<void>;
  openSettings(): void;
}

export interface PillAgent {
  id: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
}

export interface PromptPills {
  setPrompts(prompts: readonly QuickPrompt[]): void;
  /** Replaces the agent list with a full snapshot. */
  setAgents(agents: readonly PillAgent[]): void;
  upsertAgent(agent: PillAgent): void;
  removeAgent(agentId: string): void;
  removeAll(): void;
}

interface Pill {
  id: string;
  prompt: QuickPrompt | null;
  registration: PluginButtonRegistration;
}

interface AgentPills {
  workspaceId: string;
  pills: Pill[];
}

function pillId(prompt: QuickPrompt | null): string {
  return prompt ? `prompt-${prompt.id}` : ADD_PILL_ID;
}

/**
 * Keeps one composer pill per saved prompt on every agent, or a single "Add quick prompt" pill
 * when none are saved. Pills whose order is unchanged update in place; a reorder, addition, or
 * removal re-registers that agent's pills, because registration order is display order.
 *
 * A factory rather than a class: plugin client bundles reach Hermes (iOS, Android) without Metro's
 * transforms, and Hermes rejects class syntax (getpaseo/paseo#5783).
 */
export function createPromptPills(host: PromptPillHost): PromptPills {
  /** Null until the first read, so agents do not flash the "Add quick prompt" pill. */
  let prompts: readonly QuickPrompt[] | null = null;
  /** Agents that get pills, by id, with their workspace. */
  const targets = new Map<string, string>();
  const registered = new Map<string, AgentPills>();

  const button = (agentId: string, prompt: QuickPrompt | null): PluginButton =>
    prompt
      ? {
          title: `Send quick prompt: ${prompt.label}`,
          icon: "Zap",
          label: prompt.label,
          // Paseo marks the pill busy until the send settles and shows a failure in a toast.
          behavior: { kind: "action", onPress: () => host.send(agentId, prompt.text) },
        }
      : {
          title: "Add a quick prompt in settings",
          icon: "Plus",
          label: "Add quick prompt",
          behavior: { kind: "action", onPress: () => host.openSettings() },
        };

  const clear = (agentId: string): void => {
    for (const pill of registered.get(agentId)?.pills ?? []) pill.registration.remove();
    registered.delete(agentId);
  };

  const sync = (agentId: string, workspaceId: string): void => {
    if (prompts === null) return;
    const next: Array<QuickPrompt | null> = prompts.length > 0 ? [...prompts] : [null];
    const current = registered.get(agentId);
    const sameOrder =
      current?.workspaceId === workspaceId &&
      current.pills.length === next.length &&
      current.pills.every((pill, index) => pill.id === pillId(next[index] ?? null));
    if (current && sameOrder) {
      current.pills.forEach((pill, index) => {
        const prompt = next[index] ?? null;
        if (pill.prompt?.label === prompt?.label && pill.prompt?.text === prompt?.text) return;
        pill.prompt = prompt;
        pill.registration.update(button(agentId, prompt));
      });
      return;
    }
    clear(agentId);
    registered.set(agentId, {
      workspaceId,
      pills: next.map((prompt) => {
        const id = pillId(prompt);
        const registration = host.addComposerPill({ id, workspaceId, agentId, button: button(agentId, prompt) });
        return { id, prompt, registration };
      }),
    });
  };

  const removeAgent = (agentId: string): void => {
    targets.delete(agentId);
    clear(agentId);
  };

  const upsertAgent = (agent: PillAgent): void => {
    if (!agent.workspaceId || agent.archivedAt) return removeAgent(agent.id);
    targets.set(agent.id, agent.workspaceId);
    sync(agent.id, agent.workspaceId);
  };

  return {
    setPrompts(next) {
      prompts = next;
      for (const [agentId, workspaceId] of targets) sync(agentId, workspaceId);
    },
    setAgents(list) {
      const ids = new Set(list.map(({ id }) => id));
      for (const agentId of [...targets.keys()]) if (!ids.has(agentId)) removeAgent(agentId);
      for (const agent of list) upsertAgent(agent);
    },
    upsertAgent,
    removeAgent,
    removeAll() {
      for (const agentId of [...targets.keys()]) removeAgent(agentId);
    },
  };
}
