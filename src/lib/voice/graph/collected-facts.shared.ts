/**
 * Lightweight facts inferred from caller transcript — used by routing and speech
 * so the agent does not re-ask for size, type, price, etc. already given.
 */
import type { LlmMessage } from "./types";

export function summarizeCollectedFacts(history: readonly LlmMessage[]): string {
  const userText = history
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();
  if (!userText.trim()) return "";

  const facts: string[] = [];

  const typeMatch = userText.match(/\b(apartment|flat|villa|house|bungalow|plot|land|townhouse|penthouse)\b/);
  if (typeMatch) facts.push(`property type: ${typeMatch[1]}`);

  const bedMatch = userText.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:bed(?:room)?s?|bhk)\b/);
  if (bedMatch) facts.push(`bedrooms: ${bedMatch[0]}`);

  const bathMatch = userText.match(/\b(\d+|one|two|three|four|five)\s*bath(?:room)?s?\b/);
  if (bathMatch) facts.push(`bathrooms: ${bathMatch[0]}`);

  if (/\b(square meters?|square metres?|sqm|sq m|square feet|sq ft|sqft)\b/.test(userText)) {
    facts.push("property size already mentioned");
  }

  if (/\b(million|thousand|\$|aed|dollar|dirham)\b/.test(userText)) {
    facts.push("price point already mentioned");
  }

  if (/\b(street|st\.|road|rd\.|avenue|lane|drive|boulevard|community|dubai|abu dhabi)\b/.test(userText)) {
    facts.push("address or location already mentioned");
  }

  if (/^(yes|yeah|yep|sure|okay|ok)\.?$/i.test(userText.trim())) {
    facts.push("caller affirmed");
  }

  return facts.length > 0 ? facts.join("; ") : "";
}
