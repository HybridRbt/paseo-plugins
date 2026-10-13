import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const MAX_PROMPTS = 20;
export const LABEL_MAX_LENGTH = 40;
export const TEXT_MAX_LENGTH = 10_000;

/** Lowercase letters and digits, so a pill id built from it is valid. */
const PROMPT_ID_PATTERN = /^[a-z0-9]{1,32}$/;

export const QuickPromptSchema = z.object({
  id: z.string().regex(PROMPT_ID_PATTERN),
  label: z
    .string()
    .trim()
    .min(1, "Enter a label")
    .max(LABEL_MAX_LENGTH, `Keep the label to ${LABEL_MAX_LENGTH} characters`),
  text: z
    .string()
    .trim()
    .min(1, "Enter the prompt")
    .max(TEXT_MAX_LENGTH, `Keep the prompt to ${TEXT_MAX_LENGTH.toLocaleString("en-US")} characters`),
});

export type QuickPrompt = z.output<typeof QuickPromptSchema>;

export const quickPromptsSettings = defineSettings({
  id: "prompts",
  scope: "host",
  version: 1,
  schema: z.object({
    prompts: z
      .array(QuickPromptSchema)
      .max(MAX_PROMPTS, `Save at most ${MAX_PROMPTS} quick prompts`)
      .refine((prompts) => new Set(prompts.map(({ id }) => id)).size === prompts.length, "Quick prompt ids must be unique")
      .default([]),
  }),
});

export type QuickPromptsSettings = z.output<typeof quickPromptsSettings.schema>;

/** The saved prompts from a settings read; stored data that fails validation counts as none. */
export function promptsFromSettings(result: { status: "ready"; values: unknown } | { status: "invalid" }): QuickPrompt[] {
  if (result.status !== "ready") return [];
  return quickPromptsSettings.schema.safeParse(result.values).data?.prompts ?? [];
}

export function newPromptId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
