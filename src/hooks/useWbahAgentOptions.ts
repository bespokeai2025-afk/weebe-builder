import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getWbahRetellAgents } from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import { mergeWbahAgentNames } from "@/lib/dashboard/wbah-agent-filter";

/**
 * Canonical WBAH agent names for filter dropdowns — Retell /list-agents union
 * with any names already present in the current page's loaded rows.
 */
export function useWbahAgentOptions(
  extraNames: (string | null | undefined)[] = [],
  enabled = true,
) {
  const getAgentsFn = useServerFn(getWbahRetellAgents);
  const q = useQuery({
    queryKey: ["wbah-retell-agents"],
    queryFn: () => getAgentsFn(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError: false,
    enabled,
  });

  const canonical = useMemo(
    () => (q.data ?? []).map((a: { name?: string }) => a.name).filter(Boolean) as string[],
    [q.data],
  );

  const options = useMemo(
    () => mergeWbahAgentNames(canonical, extraNames),
    [canonical, extraNames],
  );

  return { options, isLoading: q.isPending, isError: q.isError };
}
