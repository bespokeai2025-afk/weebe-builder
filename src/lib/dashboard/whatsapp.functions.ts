import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listWhatsappThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data, error } = await sb
      .from("whatsapp_messages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("sent_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const threads = new Map<
      string,
      {
        phone: string;
        name: string | null;
        lastMessage: string | null;
        lastAt: string;
        unread: number;
        messages: any[];
      }
    >();
    for (const m of (data ?? []) as any[]) {
      const existing = threads.get(m.contact_phone);
      if (!existing) {
        threads.set(m.contact_phone, {
          phone: m.contact_phone,
          name: m.contact_name,
          lastMessage: m.body,
          lastAt: m.sent_at,
          unread: 0,
          messages: [m],
        });
      } else {
        existing.messages.push(m);
      }
    }
    return Array.from(threads.values());
  });
