import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Middleware that verifies the caller has profiles.user_type = 'admin'.
 * Must be chained after requireSupabaseAuth (which provides context.supabase + context.userId).
 */
export const requirePlatformAdmin = createMiddleware({ type: "function" }).server(
  async ({ next, context }) => {
    const ctx = context as unknown as {
      supabase: ReturnType<typeof createClient<Database>>;
      userId: string;
    };
    const { supabase, userId } = ctx;

    const [profileRes, roleRes] = await Promise.all([
      supabase.from("profiles").select("user_type").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
    ]);

    const isAdmin = profileRes.data?.user_type === "admin" || !!roleRes.data;
    if (!isAdmin) {
      throw new Error("Forbidden: Platform admin access required");
    }

    return next({ context });
  },
);
