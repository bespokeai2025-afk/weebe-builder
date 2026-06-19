import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash, randomBytes } from "crypto";
import { cacheDel } from "@/lib/cache/redis.server";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function generateToken(): { plaintext: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const plaintext = `lvb_${raw}`;
  return { plaintext, prefix: plaintext.slice(0, 12), hash: sha256Hex(plaintext) };
}

export const listTokens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data, error } = await supabase
      .from("workspace_api_tokens")
      .select("id, name, prefix, created_by, last_used_at, revoked_at, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string }) => input)
  .handler(async ({ context, data }) => {
    const { supabase, userId, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const name = (data.name ?? "").trim();
    if (!name || name.length > 80) throw new Error("Name must be 1-80 characters");

    const { plaintext, prefix, hash } = generateToken();
    const { data: row, error } = await supabase
      .from("workspace_api_tokens")
      .insert({ workspace_id: workspaceId, name, prefix, token_hash: hash, created_by: userId })
      .select("id, name, prefix, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { ...row, plaintext };
  });

export const revokeToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    // Fetch the token_hash before revoking so we can clear the Redis cache
    const { data: tokenRow } = await supabase
      .from("workspace_api_tokens")
      .select("token_hash")
      .eq("id", data.id)
      .maybeSingle();

    const { error } = await supabase
      .from("workspace_api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // Invalidate any cached token validation for this key (fire and forget)
    if (tokenRow?.token_hash) {
      cacheDel(`webee:v1:token:${tokenRow.token_hash}`).catch(() => {});
    }

    return { ok: true };
  });
