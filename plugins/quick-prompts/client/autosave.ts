import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { newPromptId, QuickPromptSchema, quickPromptsSettings } from "../shared/prompts";
import { addPrompt, applyEdit, deletePrompt, settingsContract, updatePrompt, type Edit, type SettingsDoc } from "./edits";

export type Field = "label" | "text";

/** Text typed into a saved prompt's field that the saved prompt does not have yet. */
export interface Draft {
  promptId: string;
  field: Field;
  text: string;
  /**
   * The latest save of this field that is queued or in flight. Its token tells its response apart
   * from earlier saves of the same text; its text keeps the same text from being sent twice.
   */
  pending: { token: number; text: string } | null;
  /** Set when the field loses focus with text that cannot be saved. */
  showError: boolean;
}

export interface AutosaveState {
  doc: SettingsDoc;
  /** By `draftKey`. */
  drafts: ReadonlyMap<string, Draft>;
  /** Prompts with a delete queued or in flight. */
  deleting: ReadonlySet<string>;
  /** The form for a new prompt; `showErrors` is set by an Add with text that cannot be saved. */
  newPrompt: { label: string; text: string; showErrors: boolean };
  adding: boolean;
  saving: boolean;
  /** How the latest save that reached the host ended. */
  last: "saved" | "failed" | null;
}

/** `unchanged`: nothing to send. `stale`: another client's change got there first and this one no longer applies. */
export type SaveResult = "saved" | "unchanged" | "stale" | "failed";

export interface SettingsIo {
  write(input: RpcInput<typeof settingsContract.write>): Promise<RpcOutput<typeof settingsContract.write>>;
  read(): Promise<RpcOutput<typeof settingsContract.read>>;
}

export interface Autosave {
  getState(): AutosaveState;
  subscribe(listener: () => void): () => void;
  /** Another client may have saved: read again once earlier work is done. */
  refresh(): void;
  /** Saves one change, applied to the latest values when its turn comes. */
  save(edit: Edit): Promise<SaveResult>;
  setDraft(promptId: string, field: Field, text: string): void;
  /** The field lost focus: save its text if it is valid and not already on its way. */
  submit(promptId: string, field: Field): void;
  remove(promptId: string): Promise<SaveResult>;
  setNewPrompt(field: Field, text: string): void;
  /** Adds the new prompt form's prompt; resolves `unchanged` when it cannot be saved or is already adding. */
  add(): Promise<SaveResult>;
  /** Forgets drafts whose prompt no longer exists. */
  dismissOrphans(): void;
  /** Submits every draft that can save; returns how many drafts cannot. */
  flush(): number;
}

export interface AutosaveOptions {
  io: SettingsIo;
  onProblem(problem: "stale" | "failed", error?: unknown): void;
}

export const draftKey = (promptId: string, field: Field): string => `${promptId}:${field}`;

const hasPrompt = (doc: SettingsDoc, promptId: string): boolean =>
  doc.values.prompts.some((prompt) => prompt.id === promptId);

/** Drafts whose prompt is gone, for example deleted on another device. */
export function orphanedDrafts(state: AutosaveState): Draft[] {
  return [...state.drafts.values()].filter(
    (draft) => !state.deleting.has(draft.promptId) && !hasPrompt(state.doc, draft.promptId),
  );
}

const parseField = (field: Field, text: string) => QuickPromptSchema.shape[field].safeParse(text);

/**
 * Owns the latest known settings document and saves changes to it one at a time. Reads and writes
 * share one queue, so a response always describes the document at least as new as the previous
 * one. Revisions are content hashes and can repeat, so they are only sent back, never compared.
 *
 * A factory rather than a class: Hermes rejects class syntax in plugin client bundles.
 */
export function createAutosave(initial: SettingsDoc, { io, onProblem }: AutosaveOptions): Autosave {
  let state: AutosaveState = {
    doc: initial,
    drafts: new Map(),
    deleting: new Set(),
    newPrompt: { label: "", text: "", showErrors: false },
    adding: false,
    saving: false,
    last: null,
  };
  const listeners = new Set<() => void>();
  let queue: Promise<unknown> = Promise.resolve();
  /** Counts change notifications; `readAt` is the count when the latest successful read started. */
  let notified = 0;
  let readAt = 0;
  let submissions = 0;

  const set = (patch: Partial<AutosaveState>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const setDoc = (doc: SettingsDoc): void => set({ doc });

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  const read = async (): Promise<void> => {
    const startedAt = notified;
    const result = await io.read();
    const parsed = result.status === "ready" ? quickPromptsSettings.schema.safeParse(result.values) : undefined;
    if (!parsed?.success) throw new Error("The saved quick prompts cannot be read");
    readAt = startedAt;
    setDoc({ values: parsed.data, revision: result.revision });
  };

  /** Applies `edit` to the latest values and writes it, reading and retrying once after a conflict. */
  const write = async (edit: Edit): Promise<SaveResult> => {
    for (let attempt = 0; ; attempt += 1) {
      const values = applyEdit(edit, state.doc.values);
      if (!values) return attempt === 0 ? "unchanged" : "stale";
      if (JSON.stringify(values) === JSON.stringify(state.doc.values)) return "unchanged";
      const startedAt = notified;
      set({ saving: true });
      const result = await io.write({ revision: state.doc.revision, values });
      if (result.status === "saved") {
        const saved = { values: quickPromptsSettings.schema.parse(result.values), revision: result.revision };
        // Another client saved while this write was in flight: show the latest, not this older result.
        if (notified === startedAt) setDoc(saved);
        else await read().catch(() => setDoc(saved));
        return "saved";
      }
      if (result.status === "invalid") throw new Error(result.error);
      await read();
      if (attempt === 1) return "stale";
    }
  };

  const save = (edit: Edit): Promise<SaveResult> =>
    enqueue(async () => {
      let result: SaveResult;
      try {
        result = await write(edit);
      } catch (error) {
        result = "failed";
        onProblem("failed", error);
      }
      if (result === "stale") onProblem("stale");
      const last = result === "saved" ? "saved" : result === "unchanged" ? state.last : "failed";
      set({ saving: false, last });
      return result;
    });

  const setDraftEntry = (key: string, draft: Draft | null): void => {
    const drafts = new Map(state.drafts);
    if (draft) drafts.set(key, draft);
    else drafts.delete(key);
    set({ drafts });
  };

  const submit = (promptId: string, field: Field): void => {
    const key = draftKey(promptId, field);
    const draft = state.drafts.get(key);
    if (!draft || draft.pending?.text === draft.text) return;
    const parsed = parseField(field, draft.text);
    if (!parsed.success) {
      setDraftEntry(key, { ...draft, showError: true });
      return;
    }
    const text = draft.text;
    const token = ++submissions;
    setDraftEntry(key, { ...draft, pending: { token, text }, showError: false });
    void save(updatePrompt(promptId, field, parsed.data)).then((result) => {
      const current = state.drafts.get(key);
      // A later save of this field decides what happens to the draft.
      if (current?.pending?.token !== token) return undefined;
      const next = new Map(state.drafts);
      const stored = result === "saved" || (result === "unchanged" && hasPrompt(state.doc, promptId));
      // Saved as typed: a later change from another client wins. Otherwise a later blur may send it again.
      if (stored && current.text === text) next.delete(key);
      else next.set(key, { ...current, pending: null });
      set({ drafts: next });
      return undefined;
    });
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh() {
      const at = ++notified;
      void enqueue(async () => {
        // A read that started after this notification already brought the latest values.
        if (readAt >= at) return;
        await read().catch((error: unknown) => console.error("[paseo-quick-prompts] failed to read quick prompts", error));
      });
    },
    save,
    setDraft(promptId, field, text) {
      const key = draftKey(promptId, field);
      const draft = state.drafts.get(key);
      setDraftEntry(key, { promptId, field, text, pending: draft?.pending ?? null, showError: draft?.showError ?? false });
    },
    submit,
    async remove(promptId) {
      if (state.deleting.has(promptId)) return "unchanged";
      set({ deleting: new Set(state.deleting).add(promptId) });
      const result = await save(deletePrompt(promptId));
      const deleting = new Set(state.deleting);
      deleting.delete(promptId);
      // Typed text goes with a prompt deleted here, but only once it is gone.
      const drafts = hasPrompt(state.doc, promptId)
        ? state.drafts
        : new Map([...state.drafts].filter(([, draft]) => draft.promptId !== promptId));
      set({ deleting, drafts });
      return result;
    },
    setNewPrompt(field, text) {
      set({ newPrompt: { ...state.newPrompt, [field]: text } });
    },
    async add() {
      if (state.adding) return "unchanged";
      const { label, text } = state.newPrompt;
      const parsed = QuickPromptSchema.safeParse({ id: newPromptId(), label, text });
      if (!parsed.success) {
        set({ newPrompt: { ...state.newPrompt, showErrors: true } });
        return "unchanged";
      }
      set({ adding: true });
      const result = await save(addPrompt(parsed.data));
      const current = state.newPrompt;
      // Keep anything typed while the prompt was being added.
      const newPrompt =
        result === "saved"
          ? { label: current.label === label ? "" : current.label, text: current.text === text ? "" : current.text, showErrors: false }
          : current;
      set({ adding: false, newPrompt });
      return result;
    },
    dismissOrphans() {
      const orphans = new Set(orphanedDrafts(state));
      set({ drafts: new Map([...state.drafts].filter(([, draft]) => !orphans.has(draft))) });
    },
    flush() {
      let unsaved = 0;
      for (const draft of state.drafts.values()) {
        if (state.deleting.has(draft.promptId)) continue;
        if (!hasPrompt(state.doc, draft.promptId) || !parseField(draft.field, draft.text).success) unsaved += 1;
        else submit(draft.promptId, draft.field);
      }
      return unsaved;
    },
  };
}
