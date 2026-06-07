import { createServerFn } from "@tanstack/react-start";
import { getDeployMode } from "@/lib/deploy/config.server";

/** Exposes deploy mode to the client (no secrets). */
export const getDeployConfig = createServerFn({ method: "GET" }).handler(async () => {
  return { mode: getDeployMode() } as const;
});
