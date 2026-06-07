import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { listWhatsappThreads } from "@/lib/dashboard/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp — Webee" }] }),
  component: WhatsappPage,
});

function WhatsappPage() {
  const fn = useServerFn(listWhatsappThreads);
  const q = useQuery({ queryKey: ["wa-threads"], queryFn: () => fn() });
  const threads = (q.data ?? []) as any[];
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const active = threads.find((t) => t.phone === activePhone) ?? threads[0];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All conversations across your workspace
        </p>
      </div>

      {threads.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <MessageCircle className="h-8 w-8 text-muted-foreground/50" />
            <h3 className="mt-3 text-sm font-medium">No conversations</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Inbound and outbound WhatsApp messages will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-[320px_1fr]">
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {threads.map((t) => (
                <li key={t.phone}>
                  <button
                    onClick={() => setActivePhone(t.phone)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-accent/50",
                      active?.phone === t.phone && "bg-primary/10",
                    )}
                  >
                    <p className="truncate text-sm font-medium">{t.name ?? t.phone}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.lastMessage ?? "—"}</p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            {active ? (
              <div className="flex h-[520px] flex-col p-6">
                <div className="border-b border-border pb-3">
                  <p className="text-sm font-semibold">{active.name ?? active.phone}</p>
                  <p className="text-xs text-muted-foreground">{active.phone}</p>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto py-4">
                  {[...active.messages].reverse().map((m: any) => (
                    <div
                      key={m.id}
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
                        m.direction === "outbound"
                          ? "ml-auto bg-primary/20 text-foreground"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {m.body ?? "(media)"}
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(m.sent_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-[520px] items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Select a conversation to view messages.
                </p>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
