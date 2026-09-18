import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSalesAssistantAccess } from "@/lib/leads/sales-assistant.functions";

/**
 * Whether to show the AI Sales Assistant button.
 *
 * WeBespoke-only: the assistant pitches WEBEE itself, so in a customer workspace the button would
 * offer something nonsensical. Defaults to hidden while resolving and on error, so a customer
 * never sees it flash in.
 */
export function useSalesAssistantAccess(): boolean {
  const fn = useServerFn(getSalesAssistantAccess);
  const { data } = useQuery({
    queryKey: ["sales-assistant-access"],
    queryFn: () => fn(),
    staleTime: 5 * 60_000,
    throwOnError: false,
  });
  return data?.allowed === true;
}
