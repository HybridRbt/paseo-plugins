import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  LABEL_MAX_LENGTH,
  MAX_PROMPTS,
  newPromptId,
  quickPromptsSettings,
  TEXT_MAX_LENGTH,
  type PromptDisplay,
  type QuickPrompt,
  type QuickPromptsSettings,
} from "../shared/prompts";

type ReadySettings = Extract<SettingsState<typeof quickPromptsSettings.schema>, { status: "ready" }>;
type Theme = PluginSurfaceProps["theme"];
type Field = "label" | "text";

/** Unsaved edits with the revision they started from, so a save over another client's change conflicts. */
interface Draft {
  values: QuickPromptsSettings;
  revision: string;
}

const DISPLAY_OPTIONS: ReadonlyArray<{ label: string; value: PromptDisplay }> = [
  { label: "Separate pills", value: "pills" },
  { label: "One menu pill", value: "menu" },
];

const FIND_PROMPTS_PROMPT =
  "Look through my past Paseo agent sessions using the Paseo tools (list my agents and read their " +
  "activity) and find the follow-up messages I send most often. Suggest the 5 most useful quick prompts " +
  "for me. For each one give a short label (40 characters or fewer) and the full prompt text, written so " +
  "it works for any task. Do not change anything; just list them so I can add them in Quick prompts.";

interface Validation {
  valid: boolean;
  fields: Array<Partial<Record<Field, string>>>;
  list: string | null;
}

function validate(values: QuickPromptsSettings): Validation {
  const parsed = quickPromptsSettings.schema.safeParse(values);
  const fields: Validation["fields"] = values.prompts.map(() => ({}));
  let list: string | null = null;
  for (const issue of parsed.error?.issues ?? []) {
    const [, index, field] = issue.path;
    if (typeof index === "number" && (field === "label" || field === "text")) {
      fields[index] = { ...fields[index], [field]: fields[index]?.[field] ?? issue.message };
    } else {
      list ??= issue.message;
    }
  }
  return { valid: parsed.success, fields, list };
}

function useStyles(theme: Theme, compact: boolean) {
  return useMemo(
    () => ({
      intro: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 },
      message: { color: theme.colors.foreground },
      editor: { paddingHorizontal: compact ? 12 : 16, paddingVertical: compact ? 10 : 12 },
      textInput: {
        minHeight: 88,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        color: theme.colors.foreground,
        fontSize: 14,
        textAlignVertical: "top" as const,
      },
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

function PromptEditor({
  prompt,
  index,
  count,
  errors,
  inputKey,
  disabled,
  theme,
  styles,
  onChange,
  onMove,
  onDelete,
}: {
  prompt: QuickPrompt;
  index: number;
  count: number;
  errors: Partial<Record<Field, string>>;
  inputKey: string;
  disabled: boolean;
  theme: Theme;
  styles: Styles;
  onChange(field: Field, value: string): void;
  onMove(offset: -1 | 1): void;
  onDelete(): void;
}) {
  const name = prompt.label.trim() || `quick prompt ${index + 1}`;
  return (
    <SettingsCard>
      <SettingsInput
        key={inputKey}
        label="Label"
        hint="Shown on the pill."
        initialValue={prompt.label}
        placeholder="Review changes"
        error={errors.label}
        disabled={disabled}
        onChangeText={(text) => onChange("label", text)}
      />
      <SettingsRow label="Prompt" hint="Sent to the agent as your message." error={errors.text} />
      <View style={styles.editor}>
        <TextInput
          multiline
          accessibilityLabel={`Prompt for ${name}`}
          value={prompt.text}
          editable={!disabled}
          maxLength={TEXT_MAX_LENGTH}
          placeholder="Review the uncommitted changes and list any bugs."
          placeholderTextColor={theme.colors.foregroundMuted}
          onChangeText={(text) => onChange("text", text)}
          style={styles.textInput}
        />
      </View>
      <View style={[styles.editor, styles.buttons]}>
        <SmallButton
          label="Move up"
          accessibilityLabel={`Move ${name} up`}
          disabled={disabled || index === 0}
          styles={styles}
          onPress={() => onMove(-1)}
        />
        <SmallButton
          label="Move down"
          accessibilityLabel={`Move ${name} down`}
          disabled={disabled || index === count - 1}
          styles={styles}
          onPress={() => onMove(1)}
        />
        <SmallButton
          label="Delete"
          accessibilityLabel={`Delete ${name}`}
          danger
          disabled={disabled}
          styles={styles}
          onPress={onDelete}
        />
      </View>
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
  const [draft, setDraft] = useState<Draft | null>(null);
  // Remounts the label inputs, which own their text, when a draft is discarded.
  const [generation, setGeneration] = useState(0);

  const saved = settings.values;
  const isChanged = (candidate: Draft | null): candidate is Draft =>
    candidate !== null &&
    (candidate.values.display !== saved.display ||
      JSON.stringify(candidate.values.prompts) !== JSON.stringify(saved.prompts));
  // A draft edited back to the saved settings is no draft: show live values again.
  const editing = isChanged(draft) ? draft : null;
  const values = editing?.values ?? saved;
  const prompts = values.prompts;
  const validation = validate(values);
  const disabled = settings.saving;
  const inputKeyPrefix = `${editing?.revision ?? settings.revision}-${generation}`;

  const editValues = (change: (current: QuickPromptsSettings) => QuickPromptsSettings): void => {
    setDraft((current) => {
      const base = isChanged(current) ? current : { values: saved, revision: settings.revision };
      return { ...base, values: change(base.values) };
    });
  };
  const edit = (change: (current: QuickPrompt[]) => QuickPrompt[]): void =>
    editValues((current) => ({ ...current, prompts: change(current.prompts) }));

  const discard = (): void => {
    setDraft(null);
    setGeneration((value) => value + 1);
    void settings.reload();
  };

  const save = async (): Promise<void> => {
    if (!editing) return;
    const parsed = quickPromptsSettings.schema.safeParse(editing.values);
    if (!parsed.success) return;
    if (await settings.save(parsed.data, editing.revision)) setDraft(null);
  };

  return (
    <SettingsSection title="Quick prompts">
      <Text style={styles.intro}>
        Quick prompts appear above every agent's composer, as separate pills or in one Prompts menu. Choosing one
        sends the prompt to that agent as your message.
      </Text>
      {prompts.map((prompt, index) => (
        <PromptEditor
          key={prompt.id}
          prompt={prompt}
          index={index}
          count={prompts.length}
          errors={validation.fields[index] ?? {}}
          inputKey={`${prompt.id}-${inputKeyPrefix}`}
          disabled={disabled}
          theme={theme}
          styles={styles}
          onChange={(field, value) =>
            edit((current) => current.map((item) => (item.id === prompt.id ? { ...item, [field]: value } : item)))
          }
          onMove={(offset) =>
            edit((current) => {
              const next = [...current];
              const [moved] = next.splice(index, 1);
              if (moved) next.splice(index + offset, 0, moved);
              return next;
            })
          }
          onDelete={() => edit((current) => current.filter((item) => item.id !== prompt.id))}
        />
      ))}
      <SettingsCard>
        <SettingsAction
          label={prompts.length === 0 ? "No quick prompts yet" : `${prompts.length} of ${MAX_PROMPTS} quick prompts`}
          hint={`Labels can be up to ${LABEL_MAX_LENGTH} characters.`}
          actionLabel="Add quick prompt"
          disabled={disabled || prompts.length >= MAX_PROMPTS}
          onPress={() => edit((current) => [...current, { id: newPromptId(), label: "", text: "" }])}
        />
      </SettingsCard>
      <SettingsCard>
        <SettingsSelect
          label="Show prompts as"
          hint="Separate pills show one pill per prompt; one menu pill keeps them in a single menu."
          value={values.display}
          options={DISPLAY_OPTIONS}
          disabled={disabled}
          onValueChange={(display) => editValues((current) => ({ ...current, display }))}
        />
      </SettingsCard>
      {editing ? (
        <SettingsCard>
          <SettingsAction
            label="Unsaved changes"
            error={settings.saveError ?? validation.list}
            actionLabel={disabled ? "Saving…" : "Save"}
            disabled={disabled || !validation.valid}
            onPress={() => void save()}
          />
          <SettingsAction label="Discard changes" actionLabel="Discard" disabled={disabled} onPress={discard} />
        </SettingsCard>
      ) : null}
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
