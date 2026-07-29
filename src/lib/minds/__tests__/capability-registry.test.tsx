/**
 * Universal capability registry — architecture tests.
 *
 * Workstream 7 of Task #501:
 *  T1. Every registered Mind tool passes validateCapabilityRegistration.
 *  T2. getCapabilityManifest overlays "integration_required" for a Google Ads
 *      tool when no account is connected.
 *  T3. executeMindTool blocks on an unregistered action_kind (before any DB
 *      call, so this works without mocking supabase execution paths).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

// ── Supabase mock — applied before any server-side import reads the module ───
// All DB queries return empty results, simulating a workspace with no
// integrations connected. Audit-row inserts fail silently (blocked() handles
// null executionId gracefully).
vi.mock("@/integrations/supabase/client.server", () => {
  const emptyQuery = (): any => ({
    select:     () => emptyQuery(),
    eq:         () => emptyQuery(),
    in:         () => emptyQuery(),
    neq:        () => emptyQuery(),
    limit:      () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single:     () => Promise.resolve({ data: null, error: { message: "test-no-row" } }),
    insert:     () => emptyQuery(),
    update:     () => emptyQuery(),
    upsert:     () => emptyQuery(),
  });
  return {
    supabaseAdmin: { from: () => emptyQuery() },
    supabase:      { from: () => emptyQuery() },
  };
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Universal Capability Registry", () => {
  // ── T1: all registered tools pass validateCapabilityRegistration ──────────
  describe("validateCapabilityRegistration", () => {
    it("every registered tool passes the universal capability standard", async () => {
      const { listMindTools, mindToolsReady } = await import("@/lib/minds/tool-registry.server");
      const { validateCapabilityRegistration } = await import("@/lib/minds/capability-registry.shared");

      await mindToolsReady();
      const tools = listMindTools();

      expect(tools.length).toBeGreaterThanOrEqual(30);

      const failures: string[] = [];
      for (const tool of tools) {
        try {
          validateCapabilityRegistration(tool);
        } catch (e: any) {
          failures.push(e.message);
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${failures.length} tool(s) failed capability registration:\n${failures.join("\n")}`,
        );
      }
    });
  });

  // ── T2: manifest overlays "integration_required" when GAds not connected ──
  describe("getCapabilityManifest", () => {
    it("returns integration_required for google_ads tools when no account is connected", async () => {
      const { getCapabilityManifest } = await import("@/lib/minds/capability-manifest.server");
      const { listMindTools, mindToolsReady } = await import("@/lib/minds/tool-registry.server");

      await mindToolsReady();

      // Supabase mock returns [] for every table — so no gads_accounts row exists.
      const manifest = await getCapabilityManifest("test-workspace-id");

      // Find all tools that declare google_ads as a required integration.
      const gadsTools = manifest.filter((t) =>
        t.requiredIntegrations?.includes("google_ads"),
      );

      expect(gadsTools.length).toBeGreaterThan(0);

      for (const tool of gadsTools) {
        expect(tool.capabilityState).toBe("integration_required");
        expect(tool.missingIntegrations).toContain("google_ads");
      }

      // Tools without google_ads should NOT be integration_required (unless
      // they have other missing integrations).
      const noIntegTools = manifest.filter(
        (t) =>
          (t.requiredIntegrations ?? []).length === 0 &&
          !t.requiredCredentials?.length,
      );
      for (const tool of noIntegTools) {
        expect(tool.capabilityState).not.toBe("integration_required");
      }

      // Cross-check: tools in the raw registry with google_ads declared.
      const rawGadsTools = listMindTools().filter((t) =>
        t.requiredIntegrations?.includes("google_ads"),
      );
      expect(rawGadsTools.length).toBeGreaterThan(0);
      expect(gadsTools.length).toBe(rawGadsTools.length);
    });

    it("returns integration_required for google_search_console tools when not connected", async () => {
      const { getCapabilityManifest } = await import("@/lib/minds/capability-manifest.server");
      const { mindToolsReady } = await import("@/lib/minds/tool-registry.server");
      await mindToolsReady();
      const manifest = await getCapabilityManifest("test-workspace-id");
      const gscTools = manifest.filter((t) =>
        t.requiredIntegrations?.includes("google_search_console"),
      );
      expect(gscTools.length).toBeGreaterThan(0);
      for (const tool of gscTools) {
        expect(tool.capabilityState).toBe("integration_required");
      }
    });
  });

  // ── T3: unregistered action_kind is blocked before any execution ──────────
  describe("validateActionKind", () => {
    it("validateActionKind throws for an unregistered kind", async () => {
      const { validateActionKind } = await import("@/lib/minds/capability-registry.shared");

      expect(() => validateActionKind("unregistered.unknown_kind_xyz")).toThrow(
        "Unregistered capability kind",
      );
    });

    it("validateActionKind passes for null/undefined/empty", async () => {
      const { validateActionKind } = await import("@/lib/minds/capability-registry.shared");
      expect(() => validateActionKind(null)).not.toThrow();
      expect(() => validateActionKind(undefined)).not.toThrow();
      expect(() => validateActionKind("")).not.toThrow();
    });

    it("validateActionKind passes for a registered EXECUTABLE_KIND", async () => {
      const { EXECUTABLE_KINDS } = await import("@/lib/hivemind/execution-state.shared");
      const { validateActionKind } = await import("@/lib/minds/capability-registry.shared");
      const firstKind = Object.keys(EXECUTABLE_KINDS)[0];
      expect(firstKind).toBeDefined();
      expect(() => validateActionKind(firstKind)).not.toThrow();
    });

    it("executeMindTool blocks with a clear message on an unregistered action_kind", async () => {
      const { executeMindTool, mindToolsReady } = await import("@/lib/minds/tool-registry.server");
      await mindToolsReady();

      // hivemind.list_orchestration_runs: read, not sensitive, no inputSchema
      // so input object is passed through as-is, hitting the action_kind check.
      const result = await executeMindTool({
        sb:           {} as any,
        workspaceId:  "test-workspace-id",
        userId:       null,
        platform:     "system",
        toolName:     "hivemind.list_orchestration_runs",
        input:        { action_kind: "unregistered.not_in_executable_kinds" },
        initiatedBy:  "mind",
        explicitApproval: true,
      });

      expect(result.status).toBe("blocked");
      expect(result.error).toMatch(/Unregistered capability kind/);
    });
  });
});
