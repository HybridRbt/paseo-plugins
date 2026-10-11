import { useAgent, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { recapListRpc, type RecapView } from "../shared/recap";
import { sortViews } from "./format";
import { RecapBody } from "./recap-card";

const REFRESH_MS = 10_000;

/** Cross-agent overview: every agent's latest recap, newest first — the "glance at all agents" view. */
export function RecapOverview({ theme, layout, host, navigation }: PluginSurfaceProps) {
  const listRecaps = useRpc(recapListRpc);
  const query = useQuery({
    queryKey: ["paseo-recap", "list"],
    queryFn: () => listRecaps({}),
    refetchInterval: REFRESH_MS,
  });
  const views = useMemo(() => sortViews(query.data?.recaps ?? []), [query.data]);
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 16 : 24, gap: 12, maxWidth: 760, width: "100%" as const },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 20 : 24, fontWeight: "600" as const },
      muted: { color: theme.colors.foregroundMuted, fontSize: 14 },
      error: { color: theme.colors.statusDanger, fontSize: 14 },
    }),
    [theme, layout.compact],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Recaps</Text>
      {query.isPending ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {query.error ? <Text style={styles.error}>Could not load recaps.</Text> : null}
      {!query.isPending && !query.error && views.length === 0 ? (
        <Text style={styles.muted}>No recaps yet. They appear after agents finish a turn.</Text>
      ) : null}
      {views.map((view) => (
        <RecapRow
          key={view.agentId}
          view={view}
          theme={theme}
          onOpen={
            navigation
              ? () => navigation.openAgent({ agentId: view.agentId, serverId: host.id })
              : undefined
          }
        />
      ))}
    </ScrollView>
  );
}

function RecapRow({
  view,
  theme,
  onOpen,
}: {
  view: RecapView;
  theme: PluginSurfaceProps["theme"];
  onOpen: (() => void) | undefined;
}) {
  // Live title and status when the agent is in this client's state; stored values otherwise.
  const live = useAgent(view.agentId, (agent) => ({ title: agent.title, status: agent.status }));
  const title = live?.title ?? view.recap?.agent.title ?? "Untitled agent";
  const provider = view.recap?.agent.provider;
  const status = live?.status ?? null;
  const styles = useMemo(
    () => ({
      card: {
        gap: 8,
        padding: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      title: { flex: 1, color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
      badge: { color: theme.colors.foregroundMuted, fontSize: 12 },
      dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: statusColor(theme, status, view.state),
      },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme, status, view.state],
  );

  return (
    <Pressable
      accessibilityRole={onOpen ? "button" : undefined}
      accessibilityLabel={`Open ${title}`}
      disabled={!onOpen}
      onPress={onOpen}
      style={styles.card}
    >
      <View style={styles.header}>
        <View style={styles.dot} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {provider ? <Text style={styles.badge}>{provider}</Text> : null}
      </View>
      {view.recap ? <RecapBody theme={theme} recap={view.recap} /> : null}
      {view.state === "generating" ? <Text style={styles.muted}>Generating recap…</Text> : null}
      {view.error ? <Text style={styles.muted}>{view.error}</Text> : null}
    </Pressable>
  );
}

function statusColor(
  theme: PluginSurfaceProps["theme"],
  status: string | null,
  state: RecapView["state"],
): string {
  if (status === "running" || state === "generating") return theme.colors.statusWarning;
  if (status === "error" || state === "error") return theme.colors.statusDanger;
  if (status === "idle") return theme.colors.statusSuccess;
  return theme.colors.border;
}
