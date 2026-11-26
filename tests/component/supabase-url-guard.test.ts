import { describe, expect, it } from "vitest";
import {
  ensureValidSupabaseUrlEnv,
  refFromSupabaseJwt,
  resolveSupabaseUrl,
} from "@/lib/supabase-url-guard";

const jwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("supabase url guard", () => {
  it("uses the configured URL when it is valid", () => {
    expect(resolveSupabaseUrl({ VITE_SUPABASE_URL: "https://newproj.supabase.co/" })).toBe(
      "https://newproj.supabase.co",
    );
  });

  it("repairs a key pasted in place of the URL from the other URL variable", () => {
    const env: Record<string, string | undefined> = {
      VITE_SUPABASE_URL: jwt({ role: "service_role", ref: "newproj" }),
      SUPABASE_URL: "https://newproj.supabase.co",
    };
    expect(ensureValidSupabaseUrlEnv(env)).toBe("https://newproj.supabase.co");
    expect(env.VITE_SUPABASE_URL).toBe("https://newproj.supabase.co");
  });

  it("derives the URL from a legacy key's project ref, then from the fallback ref", () => {
    expect(
      resolveSupabaseUrl({ SUPABASE_URL: "oops", SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: "keyproj" }) }),
    ).toBe("https://keyproj.supabase.co");
    expect(resolveSupabaseUrl({ SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" }, "tomlproj")).toBe(
      "https://tomlproj.supabase.co",
    );
    expect(resolveSupabaseUrl({})).toBeUndefined();
  });

  it("only reads a ref from something shaped like a Supabase JWT", () => {
    expect(refFromSupabaseJwt(jwt({ ref: "abc123" }))).toBe("abc123");
    expect(refFromSupabaseJwt("sb_secret_abc")).toBeUndefined();
    expect(refFromSupabaseJwt(jwt({ ref: "../evil" }))).toBeUndefined();
  });
});
