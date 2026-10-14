import { useRpc, useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  LABEL_MAX_LENGTH,
  MAX_PROMPTS,
  newPromptId,
  QuickPromptSchema,
  quickPromptsSettings,
  TEXT_MAX_LENGTH,
  type PromptDisplay,
  type QuickPrompt,
} from "../shared/prompts";
import {
  addPrompt,
  deletePrompt,
  movePrompt,
  saveEdit,
  setDisplay,
  settingsContract,
  updatePrompt,
  type Edit,
  type SettingsDoc,
} from "./edits";

type ReadySettings = Extract<SettingsState<typeof quickPromptsSettings.schema>, { status: "ready" }>;
type Theme = PluginSurfaceProps["theme"];
type Field = "label" | "text";

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
      status: { color: theme.colors.foregroundMuted, fontSize: 13 },
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
          maxLength={isText ? TEXT_MAX_LENGTH : undefined}
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

/**
 * A saved prompt's field. Typed text stays local, so another client's save never replaces it, and
 * saves when the field loses focus or unmounts if it changed and is valid.
 */
function SavedField({
  saved,
  onCommit,
  ...props
}: Omit<FieldInputProps, "value" | "error" | "onChangeText" | "onBlur"> & {
  saved: string;
  onCommit(value: string): Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);

  const commit = async (): Promise<void> => {
    if (draft === null) return;
    const parsed = QuickPromptSchema.shape[props.field].safeParse(draft);
    if (!parsed.success) {
      setShowError(true);
      return;
    }
    if (parsed.data === saved || (await onCommit(parsed.data))) {
      // Keep text typed while the save was in flight.
      setDraft((current) => (current === draft ? null : current));
      setShowError(false);
    }
  };
  const latestCommit = useRef(commit);
  latestCommit.current = commit;
  useEffect(() => () => void latestCommit.current(), []);

  return (
    <FieldInput
      {...props}
      value={draft ?? saved}
      error={showError && draft !== null ? fieldError(props.field, draft) : null}
      onChangeText={setDraft}
      onBlur={() => void commit()}
    />
  );
}

function PromptEditor({
  prompt,
  index,
  count,
  theme,
  styles,
  commit,
}: {
  prompt: QuickPrompt;
  index: number;
  count: number;
  theme: Theme;
  styles: Styles;
  commit(edit: Edit): Promise<boolean>;
}) {
  const name = prompt.label || `quick prompt ${index + 1}`;
  return (
    <SettingsCard>
      <SavedField
        field="label"
        saved={prompt.label}
        accessibilityLabel={`Label for ${name}`}
        theme={theme}
        styles={styles}
        onCommit={(value) => commit(updatePrompt(prompt.id, "label", value))}
      />
      <SavedField
        field="text"
        saved={prompt.text}
        accessibilityLabel={`Prompt for ${name}`}
        theme={theme}
        styles={styles}
        onCommit={(value) => commit(updatePrompt(prompt.id, "text", value))}
      />
      <View style={[styles.editor, styles.buttons]}>
        <SmallButton
          label="Move up"
          accessibilityLabel={`Move ${name} up`}
          disabled={index === 0}
          styles={styles}
          onPress={() => void commit(movePrompt(prompt.id, -1))}
        />
        <SmallButton
          label="Move down"
          accessibilityLabel={`Move ${name} down`}
          disabled={index === count - 1}
          styles={styles}
          onPress={() => void commit(movePrompt(prompt.id, 1))}
        />
        <SmallButton
          label="Delete"
          accessibilityLabel={`Delete ${name}`}
          danger
          styles={styles}
          onPress={() => void commit(deletePrompt(prompt.id))}
        />
      </View>
    </SettingsCard>
  );
}

function NewPromptCard({
  count,
  theme,
  styles,
  commit,
}: {
  count: number;
  theme: Theme;
  styles: Styles;
  commit(edit: Edit): Promise<boolean>;
}) {
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [adding, setAdding] = useState(false);

  const add = async (): Promise<void> => {
    const parsed = QuickPromptSchema.safeParse({ id: newPromptId(), label, text });
    if (!parsed.success) {
      setShowErrors(true);
      return;
    }
    setAdding(true);
    const added = await commit(addPrompt(parsed.data));
    setAdding(false);
    if (added) {
      setLabel("");
      setText("");
      setShowErrors(false);
    }
  };

  return (
    <SettingsCard>
      <FieldInput
        field="label"
        value={label}
        error={showErrors ? fieldError("label", label) : null}
        accessibilityLabel="Label for the new quick prompt"
        theme={theme}
        styles={styles}
        onChangeText={setLabel}
      />
      <FieldInput
        field="text"
        value={text}
        error={showErrors ? fieldError("text", text) : null}
        accessibilityLabel="Prompt for the new quick prompt"
        theme={theme}
        styles={styles}
        onChangeText={setText}
      />
      <SettingsAction
        label={count === 0 ? "No quick prompts yet" : `${count} of ${MAX_PROMPTS} quick prompts`}
        hint={`Labels can be up to ${LABEL_MAX_LENGTH} characters.`}
        actionLabel={adding ? "Adding…" : "Add quick prompt"}
        disabled={adding || count >= MAX_PROMPTS}
        onPress={() => void add()}
      />
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

function PromptLibrary({ settings, theme, layout }: { settings: ReadySettings } & PluginSurfaceProps) {
  const styles = useStyles(theme, layout.compact);
  const toast = useToast();
  const write = useRpc(settingsContract.write);
  const read = useRpc(settingsContract.read);
  const [doc, setDocState] = useState<SettingsDoc>({ values: settings.values, revision: settings.revision });
  // The latest known values and revision, which each queued save starts from.
  const latest = useRef(doc);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [pending, setPending] = useState(0);
  const [saved, setSaved] = useState(false);

  const setDoc = (next: SettingsDoc): void => {
    latest.current = next;
    setDocState(next);
  };

  // Another client's save or a reload. Fields being typed in keep their text.
  useEffect(() => {
    if (settings.revision !== latest.current.revision) {
      setDoc({ values: settings.values, revision: settings.revision });
    }
  }, [settings.revision]);

  /** Saves one change after any earlier ones; resolves whether it was saved. */
  const commit = (edit: Edit): Promise<boolean> => {
    setPending((count) => count + 1);
    const run = queue.current.then(async () => {
      const outcome = await saveEdit(edit, latest.current, { write, read: () => read({}) });
      setPending((count) => count - 1);
      switch (outcome.status) {
        case "saved":
          setDoc(outcome.doc);
          setSaved(true);
          return true;
        case "unchanged":
          return false;
        case "stale":
          setDoc(outcome.doc);
          toast.error("Quick prompts changed elsewhere, so this change was not saved.");
          return false;
        case "failed":
          console.error("[paseo-quick-prompts] failed to save quick prompts", outcome.error);
          toast.error("Could not save quick prompts. Try again.");
          return false;
      }
    });
    queue.current = run;
    return run;
  };

  const prompts = doc.values.prompts;
  const status = pending > 0 ? "Saving…" : saved ? "Saved" : null;

  return (
    <SettingsSection title="Quick prompts" trailing={status ? <Text style={styles.status}>{status}</Text> : undefined}>
      <Text style={styles.intro}>
        Quick prompts appear above every agent's composer, as separate pills or in one Prompts menu. Choosing one
        sends the prompt to that agent as your message. Changes save automatically.
      </Text>
      {prompts.map((prompt, index) => (
        <PromptEditor
          key={prompt.id}
          prompt={prompt}
          index={index}
          count={prompts.length}
          theme={theme}
          styles={styles}
          commit={commit}
        />
      ))}
      <NewPromptCard count={prompts.length} theme={theme} styles={styles} commit={commit} />
      <SettingsCard>
        <SettingsSelect
          label="Show prompts as"
          hint="Separate pills show one pill per prompt; one menu pill keeps them in a single menu."
          value={doc.values.display}
          options={DISPLAY_OPTIONS}
          onValueChange={(display) => void commit(setDisplay(display))}
        />
      </SettingsCard>
      <FindPromptsTip styles={styles} />
    </SettingsSection>
  );
}

export function QuickPromptsSettingsScreen(props: PluginSurfaceProps) {
  const settings = useSettings(quickPromptsSettings);
  const style = useMemo(() => ({ color: props.theme.colors.foreground }), [props.theme]);
  if (settings.status === "loading") return <Text style={style}>Loading quick prompts…</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Quick prompts">
        <Text style={style}>{settings.error}</Text>
        <SettingsCard>
          <SettingsAction label="Try again" actionLabel="Reload" onPress={() => void settings.reload()} />
          {settings.status === "invalid" ? (
            <SettingsAction
              label="Delete the saved quick prompts"
              hint="The stored data cannot be read."
              actionLabel="Reset"
              onPress={() => void settings.reset()}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    );
  }
  return <PromptLibrary settings={settings} {...props} />;
}
