import type { PluginServerContext } from "@getpaseo/plugin/server";
import { quickPromptsSettings } from "./shared/prompts";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(quickPromptsSettings);
  return () => {};
}
