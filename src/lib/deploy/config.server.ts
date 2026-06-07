export type DeployMode = "retail" | "approval";

/** Retail deploy when both Supabase workspace UUID and Retell production key are valid. */
export function getDeployMode(): DeployMode {
  return getRetailWorkspaceId() && getRetailRetellApiKey() ? "retail" : "approval";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getRetailWorkspaceId(): string | null {
  const id = process.env.RETAIL_WORKSPACE_ID?.trim();
  if (!id || !UUID_RE.test(id)) return null;
  return id;
}

export function getRetailRetellApiKey(): string | null {
  const key = process.env.RETELL_RETAIL_API_KEY?.trim();
  if (!key || key === "key_...") return null;
  return key;
}

export function isRetailDeployEnabled(): boolean {
  return getDeployMode() === "retail";
}
