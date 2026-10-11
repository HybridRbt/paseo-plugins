import type { PluginButtonContentProps, PluginHostProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { recapGetRpc, recapRegenerateRpc, type RecapView, type StoredRecap } from "../shared/recap";
import { relativeTime } from "./format";

const GENERATING_POLL_MS = 2_000;

export function recapQueryKey(agentId: string) {
  return ["paseo-recap", "recap", agentId] as const;
}

type Theme = PluginHostProps["theme"];

function useRecapStyles(theme: Theme) {
  return useMemo(
    () => ({
      summary: { color: theme.colors.foreground, fontSize: 15, lineHeight: 21 },
      summaryMuted: { color: theme.colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
      nextLabel: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      next: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
      nextBox: {
        gap: 4,
        padding: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      meta: { color: theme.colors.foregroundMuted, fontSize: 12 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      button: {
        alignSelf: "flex-start" as const,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: theme.colors.surface2,
      },
      buttonText: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      link: { color: theme.colors.foregroundMuted, fontSize: 13, fontWeight: "600" as const },
      earlier: { gap: 10, paddingTop: 4, borderTopWidth: 1, borderTopColor: theme.colors.border },
    }),
    [theme],
  );
}

export function recapAge(recap: StoredRecap, now: number): string {
  const age = relativeTime(recap.generatedAt, now);
  return age === "now" ? "Just now" : `${age} ago`;
}

/** Summary, next action, and metadata of one recap. Plain text only: model output is untrusted. */
export function RecapBody({
  theme,
  recap,
  muted = false,
}: {
  theme: Theme;
  recap: StoredRecap;
  muted?: boolean;
}) {
  const styles = useRecapStyles(theme);
  return (
    <>
      <Text style={muted ? styles.summaryMuted : styles.summary} selectable>
        {recap.summary}
      </Text>
      {recap.nextAction && !muted ? (
        <View style={styles.nextBox}>
          <Text style={styles.nextLabel}>Next</Text>
          <Text style={styles.next} selectable>
            {recap.nextAction}
          </Text>
        </View>
      ) : null}
      <Text style={styles.meta}>
        {recap.stale && !muted ? "Out of date · " : ""}
        {recapAge(recap, Date.now())}
        {` · ${recap.generator.model ?? recap.generator.provider}`}
        {recap.trigger === "manual" ? " · manual" : ""}
      </Text>
    </>
  );
}

export function makeRecapPopover(onChanged: () => void) {
  return function RecapPopover(props: PluginButtonContentProps) {
    if (props.context !== "agent") return null;
    return <RecapCard {...props} agentId={props.agentId} onChanged={onChanged} />;
  };
}

function RecapCard({
  theme,
  layout,
  agentId,
  onChanged,
}: PluginButtonContentProps & { agentId: string; onChanged: () => void }) {
  const getRecap = useRpc(recapGetRpc);
  const regenerateRecap = useRpc(recapRegenerateRpc);
  const queryClient = useQueryClient();
  const [showEarlier, setShowEarlier] = useState(false);
  const styles = useRecapStyles(theme);
  const query = useQuery({
    queryKey: recapQueryKey(agentId),
    queryFn: () => getRecap({ agentId }),
    refetchInterval: (current) =>
      current.state.data?.state === "generating" ? GENERATING_POLL_MS : false,
  });
  const regenerate = useMutation({
    mutationFn: () => regenerateRecap({ agentId }),
    onMutate: () => {
      // Show progress immediately; the RPC resolves only after generation finishes.
      queryClient.setQueryData<RecapView>(recapQueryKey(agentId), (previous) =>
        previous ? { ...previous, state: "generating", error: null } : previous,
      );
      setTimeout(onChanged, 500);
    },
    onSettled: (view) => {
      if (view) queryClient.setQueryData(recapQueryKey(agentId), view);
      else void query.refetch();
      onChanged();
    },
  });

  const view = query.data;
  const recap = view?.recap ?? null;
  const previous = view?.previous ?? [];
  const generating = view?.state === "generating" || regenerate.isPending;
  const error = query.error || regenerate.error ? "Could not load the recap." : (view?.error ?? null);

  return (
    <View style={{ gap: 12, maxWidth: layout.compact ? undefined : 420 }}>
      {query.isPending ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {recap ? (
        <RecapBody theme={theme} recap={recap} />
      ) : !query.isPending && !generating ? (
        <Text style={styles.meta}>No recap yet. Recaps appear after an agent finishes a turn.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Regenerate recap"
          accessibilityState={{ disabled: generating, busy: generating }}
          disabled={generating}
          onPress={() => regenerate.mutate()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{generating ? "Generating…" : "Regenerate"}</Text>
        </Pressable>
        {generating ? <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /> : null}
        {previous.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showEarlier }}
            onPress={() => setShowEarlier((value) => !value)}
          >
            <Text style={styles.link}>
              {showEarlier ? "Hide earlier" : `Earlier (${previous.length})`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {showEarlier ? (
        <View style={styles.earlier}>
          {previous.map((item) => (
            <View key={item.generatedAt} style={{ gap: 4 }}>
              <RecapBody theme={theme} recap={item} muted />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
