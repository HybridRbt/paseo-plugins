import { settingsRpc, type RpcInput, type RpcOutput } from "@getpaseo/plugin";
import { MAX_PROMPTS, quickPromptsSettings, type PromptDisplay, type QuickPrompt, type QuickPromptsSettings } from "../shared/prompts";

export const settingsContract = settingsRpc(quickPromptsSettings.id);

/** Saved values with the revision they were read or written at. */
export interface SettingsDoc {
  values: QuickPromptsSettings;
  revision: string;
}

/** One change, applied to whichever values are latest. `null` means it no longer applies. */
export type Edit = (values: QuickPromptsSettings) => QuickPromptsSettings | null;

export function updatePrompt(id: string, field: "label" | "text", value: string): Edit {
  return (values) =>
    values.prompts.some((prompt) => prompt.id === id)
      ? { ...values, prompts: values.prompts.map((prompt) => (prompt.id === id ? { ...prompt, [field]: value } : prompt)) }
      : null;
}

export function movePrompt(id: string, offset: -1 | 1): Edit {
  return (values) => {
    const index = values.prompts.findIndex((prompt) => prompt.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= values.prompts.length) return null;
    const prompts = [...values.prompts];
    const [moved] = prompts.splice(index, 1);
    if (moved) prompts.splice(target, 0, moved);
    return { ...values, prompts };
  };
}

export function deletePrompt(id: string): Edit {
  return (values) =>
    values.prompts.some((prompt) => prompt.id === id)
      ? { ...values, prompts: values.prompts.filter((prompt) => prompt.id !== id) }
      : null;
}

export function addPrompt(prompt: QuickPrompt): Edit {
  return (values) => (values.prompts.length < MAX_PROMPTS ? { ...values, prompts: [...values.prompts, prompt] } : null);
}

export function setDisplay(display: PromptDisplay): Edit {
  return (values) => ({ ...values, display });
}

/** The edit applied to `values`, or `null` when it no longer applies or the result would not save. */
export function applyEdit(edit: Edit, values: QuickPromptsSettings): QuickPromptsSettings | null {
  const next = edit(values);
  return next ? (quickPromptsSettings.schema.safeParse(next).data ?? null) : null;
}

export interface SettingsIo {
  write(input: RpcInput<typeof settingsContract.write>): Promise<RpcOutput<typeof settingsContract.write>>;
  read(): Promise<RpcOutput<typeof settingsContract.read>>;
}

export type SaveOutcome =
  /** Saved; `doc` is what the host stored. */
  | { status: "saved"; doc: SettingsDoc }
  /** The edit does not apply to the values on screen, so nothing was sent. */
  | { status: "unchanged" }
  /** Another client's save got there first and the edit no longer applies; `doc` is the latest. */
  | { status: "stale"; doc: SettingsDoc }
  | { status: "failed"; error: unknown };

/**
 * Saves one edit against `base`. On a conflict it reads the latest values, applies the edit again
 * if it still makes sense, and retries once.
 */
export async function saveEdit(edit: Edit, base: SettingsDoc, io: SettingsIo): Promise<SaveOutcome> {
  try {
    let doc = base;
    for (let attempt = 0; ; attempt += 1) {
      const values = applyEdit(edit, doc.values);
      if (!values) return attempt === 0 ? { status: "unchanged" } : { status: "stale", doc };
      const result = await io.write({ revision: doc.revision, values });
      if (result.status === "saved") {
        return { status: "saved", doc: { values: quickPromptsSettings.schema.parse(result.values), revision: result.revision } };
      }
      if (result.status !== "conflict") return { status: "failed", error: new Error(result.error) };
      const latest = await io.read();
      const parsed = latest.status === "ready" ? quickPromptsSettings.schema.safeParse(latest.values) : undefined;
      if (!parsed?.success) return { status: "failed", error: new Error("The saved quick prompts cannot be read") };
      doc = { values: parsed.data, revision: latest.revision };
      if (attempt === 1) return { status: "stale", doc };
    }
  } catch (error) {
    return { status: "failed", error };
  }
}
