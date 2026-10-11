import type { PluginClientContext } from "@getpaseo/plugin/client";
import { RecapOverview } from "./client/overview";
import { RecapPills } from "./client/pills";
import { RecapSettingsScreen } from "./client/settings-screen";
import { recapRegenerateRpc } from "./shared/recap";

export default function contribute(client: PluginClientContext) {
  const pills = new RecapPills(client);
  pills.start();

  const removeSurface = client.addSurface("overview", RecapOverview);
  const removeSidebarItem = client.addSidebarItem({
    id: "recaps",
    title: "Recaps",
    icon: "ScrollText",
    surface: "overview",
  });
  const removeCommandCenterItem = client.addCommandCenterItem({
    id: "recaps",
    title: "Show agent recaps",
    icon: "ScrollText",
    keywords: ["recap", "summary", "status", "agents"],
    context: "global",
    onSelect: ({ openSurface }) => openSurface("overview"),
  });

  const removeSettings = client.addSettingsScreen({
    id: "recap",
    title: "Recap",
    icon: "ScrollText",
    Component: RecapSettingsScreen,
  });

  const removeCommand = client.addSlashCommand({
    name: "recap",
    description: "Summarize where this agent stands",
    argumentHint: "",
    context: "agent",
    async onSubmit({ agent, rpc }) {
      // The pill shows progress; the RPC resolves once the recap is written.
      setTimeout(() => void pills.refresh(), 500);
      const view = await rpc(recapRegenerateRpc, { agentId: agent.id });
      await pills.refresh();
      if (view.error) throw new Error(view.error);
    },
  });

  return () => {
    removeSurface();
    removeSidebarItem();
    removeCommandCenterItem();
    removeSettings();
    removeCommand();
    pills.stop();
  };
}
