import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ importSip: vi.fn(), resolve: vi.fn(), saveAgent: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = {
      middleware: () => chain,
      validator: () => chain,
      handler: (handler: unknown) => handler,
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/builder/retell-telephony.server", () => ({
  importSipPhoneNumberService: mocks.importSip,
  resolveAgentIdForWorkspace: mocks.resolve,
}));
vi.mock("@/lib/agents/agent-golive.server", () => ({
  saveAgentPhoneNumberService: mocks.saveAgent,
}));
import { connectWorkspaceSipNumber } from "@/lib/telephony/sip.functions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue(true);
  mocks.importSip.mockResolvedValue({ phoneNumber: "+14155550100" });
  mocks.saveAgent.mockResolvedValue({ ok: true });
});
function setup(options: { missingAgent?: boolean; duplicate?: boolean; saveError?: boolean } = {}) {
  const insert = vi.fn();
  const eq = vi.fn();
  const agentQuery = {
    select: () => agentQuery,
    eq: (...args: unknown[]) => {
      eq(...args);
      return agentQuery;
    },
    maybeSingle: async () => ({
      data: options.missingAgent
        ? null
        : {
            id: "agent-id",
            settings: { deployedRetellAgentId: "agent_prod" },
            retell_agent_id: "agent_prod",
          },
      error: null,
    }),
  };
  const numberQuery = {
    select: () => numberQuery,
    eq: (...args: unknown[]) => {
      eq(...args);
      return numberQuery;
    },
    limit: async () => ({ data: options.duplicate ? [{ id: "existing" }] : [], error: null }),
    insert: (value: unknown) => {
      insert(value);
      return numberQuery;
    },
    single: async () => ({
      data: options.saveError ? null : { id: "number-id" },
      error: options.saveError ? { message: "failure" } : null,
    }),
  };
  const context = {
    workspaceId: "workspace-id",
    userId: "user-id",
    supabase: { from: (table: string) => (table === "agents" ? agentQuery : numberQuery) },
  };
  const data = {
    agentId: "agent-id",
    phoneNumber: "+14155550100",
    terminationUri: "carrier.example",
    sipUsername: "user",
    sipPassword: "secret",
    nickname: "Reception",
    direction: "inbound",
  };
  const run = () =>
    (
      connectWorkspaceSipNumber as unknown as (args: {
        context: typeof context;
        data: typeof data;
      }) => Promise<{ id: string | null; warning: string | null }>
    )({ context, data });
  return { run, insert, eq };
}
it("imports through the shared service and does not persist SIP secrets", async () => {
  const { run, insert, eq } = setup();
  expect((await run()).id).toBe("number-id");
  expect(eq).toHaveBeenCalledWith("workspace_id", "workspace-id");
  expect(mocks.importSip).toHaveBeenCalledWith(
    expect.objectContaining({
      inboundAgentId: "agent_prod",
      outboundAgentId: undefined,
      sipPassword: "secret",
    }),
  );
  expect(JSON.stringify(insert.mock.calls)).not.toContain("secret");
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ provider: "retell_sip" }));
});
it("rejects inaccessible agents before provider requests", async () => {
  await expect(setup({ missingAgent: true }).run()).rejects.toThrow("Agent not found");
  expect(mocks.importSip).not.toHaveBeenCalled();
});
it("rejects duplicate workspace numbers before importing", async () => {
  await expect(setup({ duplicate: true }).run()).rejects.toThrow("already exists");
  expect(mocks.importSip).not.toHaveBeenCalled();
});
it("returns a partial success warning when directory persistence fails", async () => {
  const result = await setup({ saveError: true }).run();
  expect(result.id).toBeNull();
  expect(result.warning).toContain("Do not import again");
});
it("does not expose provider error bodies", async () => {
  mocks.importSip.mockRejectedValue(new Error("provider echoed secret"));
  await expect(setup().run()).rejects.toThrow("Import was not confirmed");
});
