import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function page(title: string, body: string, color = "#16a34a") {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui;background:#0b0b0f;color:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
  <div style="max-width:480px;padding:32px;text-align:center;background:#16161d;border-radius:16px;border:1px solid #2a2a35;">
    <h1 style="color:${color};margin:0 0 12px;">${title}</h1>
    <p style="color:#bbb;margin:0;">${body}</p>
  </div>
</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/approve-user")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        const action = url.searchParams.get("action");
        if (!token || (action !== "approve" && action !== "deny")) {
          return page("Invalid link", "Missing token or action.", "#dc2626");
        }
        const { data: profile, error: readErr } = await supabaseAdmin
          .from("profiles")
          .select("id, email, approval_decided_at")
          .eq("approval_token", token)
          .maybeSingle();
        if (readErr || !profile) {
          return page("Invalid or expired link", "We couldn't find that signup.", "#dc2626");
        }
        if (profile.approval_decided_at) {
          return page("Already decided", `${profile.email} has already been processed.`, "#f59e0b");
        }
        const approve = action === "approve";
        const { error: updErr } = await supabaseAdmin
          .from("profiles")
          .update({
            approved: approve,
            denied: !approve,
            approval_decided_at: new Date().toISOString(),
          })
          .eq("id", profile.id);
        if (updErr) {
          return page("Error", updErr.message, "#dc2626");
        }
        return page(
          approve ? "User approved" : "User denied",
          approve
            ? `${profile.email} can now sign in.`
            : `${profile.email} has been denied access.`,
          approve ? "#16a34a" : "#dc2626",
        );
      },
    },
  },
});
