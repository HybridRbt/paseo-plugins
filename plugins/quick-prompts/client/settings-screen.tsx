import { usePaseo, useRpc, useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  LABEL_MAX_LENGTH,
  MAX_PROMPTS,
  QuickPromptSchema,
  quickPromptsSettings,
  type PromptDisplay,
  type QuickPrompt,
} from "../shared/prompts";
import { createAutosave, draftKey, orphanedDrafts, type Autosave, type AutosaveState, type Field } from "./autosave";
import { movePrompt, setDisplay, settingsContract, type SettingsDoc } from "./edits";
import { followPromptChanges } from "./follow";

type Settings = SettingsState<typeof quickPromptsSettings.schema>;
type Theme = PluginSurfaceProps["theme"];

const DISPLAY_OPTIONS: ReadonlyArray<{ label: string; value: PromptDisplay }> = [
  { label: "Separate pills", value: "pills" },
  { label: "One menu pill", value: "menu" },
];

const FIND_PROMPTS_PROMPT =
  "Look through my past Paseo agent sessions using the Paseo tools (list my agents and read their " +
  "activity) and find the follow-up messages I send most often. Suggest the 5 most useful quick prompts " +
  "for me. For each one give a short label (40 characters or fewer) and the full prompt text, written so " +
  "it works for any task. Do not change anything; just list them so I can add them in Quick prompts.";

/** The first validation message for one field, or `null` when it would save. */
function fieldError(field: Field, value: string): string | null {
  return QuickPromptSchema.shape[field].safeParse(value).error?.issues[0]?.message ?? null;
}

function useStyles(theme: Theme, compact: boolean) {
  return useMemo(
    () => ({
      intro: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 },
      message: { color: theme.colors.foreground },
      status: { color: theme.colors.foregroundMuted, fontSize: 13 },
      statusError: { color: theme.colors.statusDanger, fontSize: 13 },
      editor: { paddingHorizontal: compact ? 12 : 16, paddingVertical: compact ? 10 : 12 },
      input: {
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        color: theme.colors.foreground,
        fontSize: 14,
      },
      multiline: { minHeight: 88, textAlignVertical: "top" as const },
      buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      button: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      buttonDisabled: { opacity: 0.4 },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
      dangerText: { color: theme.colors.statusDanger, fontSize: 13 },
      tipPrompt: { color: theme.colors.foreground, fontSize: 13, lineHeight: 18 },
    }),
    [theme, compact],
  );
}

type Styles = ReturnType<typeof useStyles>;

function SmallButton({
  label,
  accessibilityLabel,
  danger,
  disabled,
  styles,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  danger?: boolean;
  disabled?: boolean;
  styles: Styles;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={disabled ? [styles.button, styles.buttonDisabled] : styles.button}
    >
      <Text style={danger ? styles.dangerText : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

interface FieldInputProps {
  field: Field;
  value: string;
  error: string | null;
  accessibilityLabel: string;
  theme: Theme;
  styles: Styles;
  onChangeText(text: string): void;
  onBlur?(): void;
}

function FieldInput({ field, value, error, accessibilityLabel, theme, styles, onChangeText, onBlur }: FieldInputProps) {
  const isText = field === "text";
  return (
    <>
      <SettingsRow
        label={isText ? "Prompt" : "Label"}
        hint={isText ? "Sent to the agent as your message." : "Shown on the pill."}
        error={error}
      />
      <View style={styles.editor}>
        <TextInput
          multiline={isText}
          accessibilityLabel={accessibilityLabel}
          value={value}
          placeholder={isText ? "Review the uncommitted changes and list any bugs." : "Review changes"}
          placeholderTextColor={theme.colors.foregroundMuted}
          onChangeText={onChangeText}
          onBlur={onBlur}
          style={isText ? [styles.input, styles.multiline] : styles.input}
        />
      </View>
    </>
  );
}

function PromptEditor({
  prompt,
  index,
  count,
  state,
  store,
  theme,
  styles,
}: {
  prompt: QuickPrompt;
  index: number;
  count: number;
  state: AutosaveState;
  store: Autosave;
  theme: Theme;
  styles: Styles;
}) {
  const name = prompt.label || `quick prompt ${index + 1}`;
  const deleting = state.deleting.has(prompt.id);
  const field = (field: Field, accessibilityLabel: string) => {
    const draft = state.drafts.get(draftKey(prompt.id, field));
    return (
      <FieldInput
        field={field}
        value={draft?.text ?? prompt[field]}
        error={draft?.showError ? fieldError(field, draft.text) : null}
        accessibilityLabel={accessibilityLabel}
        theme={theme}
        styles={styles}
        onChangeText={(text) => store.setDraft(prompt.id, field, text)}
        onBlur={() => store.submit(prompt.id, field)}
      />
    );
  };
  return (
    <SettingsCard>
      {field("label", `Label for ${name}`)}
      {field("text", `Prompt for ${name}`)}
      <View style={[styles.editor, styles.buttons]}>
        <SmallButton
          label="Move up"
          accessibilityLabel={`Move ${name} up`}
          disabled={index === 0}
          styles={styles}
          onPress={() => void store.save(movePrompt(prompt.id, -1))}
        />
        <SmallButton
          label="Move down"
          accessibilityLabel={`Move ${name} down`}
          disabled={index === count - 1}
          styles={styles}
          onPress={() => void store.save(movePrompt(prompt.id, 1))}
        />
        <SmallButton
          label={deleting ? "Deleting…" : "Delete"}
          accessibilityLabel={`Delete ${name}`}
          danger
          disabled={deleting}
          styles={styles}
          onPress={() => void store.remove(prompt.id)}
        />
      </View>
    </SettingsCard>
  );
}

function NewPromptCard({
  count,
  state,
  store,
  theme,
  styles,
}: {
  count: number;
  state: AutosaveState;
  store: Autosave;
  theme: Theme;
  styles: Styles;
}) {
  const { label, text, showErrors } = state.newPrompt;
  return (
    <SettingsCard>
      <FieldInput
        field="label"
        value={label}
        error={showErrors ? fieldError("label", label) : null}
        accessibilityLabel="Label for the new quick prompt"
        theme={theme}
        styles={styles}
        onChangeText={(value) => store.setNewPrompt("label", value)}
      />
      <FieldInput
        field="text"
        value={text}
        error={showErrors ? fieldError("text", text) : null}
        accessibilityLabel="Prompt for the new quick prompt"
        theme={theme}
        styles={styles}
        onChangeText={(value) => store.setNewPrompt("text", value)}
      />
      <SettingsAction
        label={count === 0 ? "No quick prompts yet" : `${count} of ${MAX_PROMPTS} quick prompts`}
        hint={`Labels can be up to ${LABEL_MAX_LENGTH} characters.`}
        actionLabel={state.adding ? "Adding…" : "Add quick prompt"}
        disabled={state.adding || count >= MAX_PROMPTS}
        onPress={() => void store.add()}
      />
    </SettingsCard>
  );
}

/** Text typed into prompts that were deleted on another device, kept until copied or dismissed. */
function UnsavedEdits({ state, store, styles }: { state: AutosaveState; store: Autosave; styles: Styles }) {
  const toast = useToast();
  const orphans = orphanedDrafts(state);
  if (orphans.length === 0) return null;
  const promptIds = [...new Set(orphans.map(({ promptId }) => promptId))];
  const text = promptIds
    .map((promptId) =>
      orphans
        .filter((draft) => draft.promptId === promptId)
        .map((draft) => `${draft.field === "label" ? "Label" : "Prompt"}: ${draft.text}`)
        .join("\n"),
    )
    .join("\n\n");
  const copy = async (): Promise<void> => {
    try {
      await copyText(text);
      toast.show("Copied", { variant: "success" });
    } catch {
      toast.error("Could not copy. Select the text and use Copy.");
    }
  };
  return (
    <SettingsCard>
      <SettingsAction
        label="Unsaved edits"
        hint="These prompts were deleted on another device before your edits were saved."
        actionLabel="Copy"
        onPress={() => void copy()}
      />
      <View style={styles.editor}>
        <Text selectable style={styles.tipPrompt}>
          {text}
        </Text>
      </View>
      <SettingsAction label="Discard these edits" actionLabel="Dismiss" onPress={() => store.dismissOrphans()} />
    </SettingsCard>
  );
}

function FindPromptsTip({ styles }: { styles: Styles }) {
  const toast = useToast();
  const copy = async (): Promise<void> => {
    try {
      await copyText(FIND_PROMPTS_PROMPT);
      toast.show("Copied", { variant: "success" });
    } catch {
      toast.error("Could not copy. Select the text and use Copy.");
    }
  };
  return (
    <SettingsCard>
      <SettingsAction
        label="Not sure what to add?"
        hint="Ask an agent to look through your past sessions and suggest your most useful quick prompts."
        actionLabel="Copy prompt"
        onPress={() => void copy()}
      />
      <View style={styles.editor}>
        <Text selectable style={styles.tipPrompt}>
          {FIND_PROMPTS_PROMPT}
        </Text>
      </View>
    </SettingsCard>
  );
}

/** A failed or unreadable settings read, with a way to read again or reset. */
function LoadProblem({ settings, styles, onReload }: { settings: Settings; styles: Styles; onReload(): void }) {
  const toast = useToast();
  if (settings.status !== "error" && settings.status !== "invalid") return null;
  const reset = async (): Promise<void> => {
    if (!(await settings.reset())) toast.error("Could not reset quick prompts. Try again.");
  };
  return (
    <>
      <Text style={styles.message}>{settings.error}</Text>
      <SettingsCard>
        <SettingsAction label="Try again" actionLabel="Reload" onPress={onReload} />
        {settings.status === "invalid" ? (
          <SettingsAction
            label="Delete the saved quick prompts"
            hint="The stored data cannot be read."
            actionLabel={settings.saving ? "Resetting…" : "Reset"}
            disabled={settings.saving}
            onPress={() => void reset()}
          />
        ) : null}
      </SettingsCard>
    </>
  );
}

function PromptLibrary({
  initial,
  settings,
  theme,
  layout,
}: { initial: SettingsDoc; settings: Settings } & PluginSurfaceProps) {
  const styles = useStyles(theme, layout.compact);
  const toast = useToast();
  const paseo = usePaseo();
  // The store outlives renders; it reaches the current RPCs and toast through this ref.
  const write = useRpc(settingsContract.write);
  const read = useRpc(settingsContract.read);
  const host = useRef({ write, read, toast });
  host.current = { write, read, toast };
  const [store] = useState(() =>
    createAutosave(initial, {
      io: { write: (input) => host.current.write(input), read: () => host.current.read({}) },
      onProblem(problem, error) {
        if (problem === "stale") {
          host.current.toast.error("Quick prompts changed elsewhere, so this change was not saved.");
          return;
        }
        console.error("[paseo-quick-prompts] failed to save quick prompts", error);
        host.current.toast.error("Could not save quick prompts. Try again.");
      },
    }),
  );
  const state = useSyncExternalStore(store.subscribe, store.getState);

  // Read again whenever any client saves.
  useEffect(() => {
    const lifetime = new AbortController();
    followPromptChanges(paseo, lifetime.signal, () => store.refresh());
    return () => lifetime.abort();
  }, [paseo, store]);

  // Closing the screen saves what can be saved and says when something could not be.
  useEffect(
    () => () => {
      if (store.flush() > 0) host.current.toast.error("Some quick prompt edits could not be saved.");
    },
    [store],
  );

  const prompts = state.doc.values.prompts;
  const status = state.saving ? "Saving…" : state.last === "saved" ? "Saved" : state.last === "failed" ? "Not saved" : null;

  return (
    <SettingsSection
      title="Quick prompts"
      trailing={
        status ? <Text style={state.last === "failed" && !state.saving ? styles.statusError : styles.status}>{status}</Text> : undefined
      }
    >
      <Text style={styles.intro}>
        Quick prompts appear above every agent's composer, as separate pills or in one Prompts menu. Choosing one
        sends the prompt to that agent as your message. Changes save automatically.
      </Text>
      <LoadProblem
        settings={settings}
        styles={styles}
        onReload={() => {
          void settings.reload();
          store.refresh();
        }}
      />
      <UnsavedEdits state={state} store={store} styles={styles} />
      {prompts.map((prompt, index) => (
        <PromptEditor
          key={prompt.id}
          prompt={prompt}
          index={index}
          count={prompts.length}
          state={state}
          store={store}
          theme={theme}
          styles={styles}
        />
      ))}
      <NewPromptCard count={prompts.length} state={state} store={store} theme={theme} styles={styles} />
      <SettingsCard>
        <SettingsSelect
          label="Show prompts as"
          hint="Separate pills show one pill per prompt; one menu pill keeps them in a single menu."
          value={state.doc.values.display}
          options={DISPLAY_OPTIONS}
          onValueChange={(display) => void store.save(setDisplay(display))}
        />
      </SettingsCard>
      <FindPromptsTip styles={styles} />
    </SettingsSection>
  );
}

export function QuickPromptsSettingsScreen(props: PluginSurfaceProps) {
  const settings = useSettings(quickPromptsSettings);
  const styles = useStyles(props.theme, props.layout.compact);
  // The editor starts from the first successful read and then stays mounted, so a later failed
  // read does not take typed text with it.
  const initial = useRef<SettingsDoc | null>(null);
  if (!initial.current && settings.status === "ready") {
    initial.current = { values: settings.values, revision: settings.revision };
  }
  if (initial.current) return <PromptLibrary initial={initial.current} settings={settings} {...props} />;
  if (settings.status === "loading") return <Text style={styles.message}>Loading quick prompts…</Text>;
  return (
    <SettingsSection title="Quick prompts">
      <LoadProblem settings={settings} styles={styles} onReload={() => void settings.reload()} />
    </SettingsSection>
  );
}
