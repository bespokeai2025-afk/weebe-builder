/**
 * Phone icon beside a lead — call this one person right now.
 *
 * Places a single-target Auto Dialer run: dials the lead, and when they
 * answer, rings the 2 route numbers below simultaneously and bridges the
 * call to whichever picks up first. No dial list, no separate "Start" step.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PhoneOutgoing, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  startQuickDialerCall,
  getDialerQuickCallDefaults,
} from "@/lib/telephony/auto-dialer.functions";
import { isValidE164 } from "@/lib/telephony/auto-dialer.shared";

export function QuickDialerCallButton({
  phone,
  name,
}: {
  phone: string | null | undefined;
  name?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [route1, setRoute1] = useState("");
  const [route2, setRoute2] = useState("");
  const [remember, setRemember] = useState(true);
  const [calling, setCalling] = useState(false);

  const defaultsFn = useServerFn(getDialerQuickCallDefaults);
  const callFn = useServerFn(startQuickDialerCall);
  const queryClient = useQueryClient();

  useQuery({
    queryKey: ["dialer-quick-call-defaults"],
    queryFn: async () => {
      const d = await defaultsFn();
      if (d.routeNumbers) {
        setRoute1((cur) => cur || d.routeNumbers![0]);
        setRoute2((cur) => cur || d.routeNumbers![1]);
      }
      return d;
    },
    enabled: open,
    throwOnError: false,
  });

  if (!phone) return null;

  async function handleCall() {
    if (!isValidE164(phone)) {
      toast.error("This lead's number isn't a valid, dialable phone number");
      return;
    }
    if (!isValidE164(route1) || !isValidE164(route2)) {
      toast.error("Enter both route numbers with a country code, e.g. +9715...");
      return;
    }
    if (route1 === route2) {
      toast.error("The 2 route numbers must be different");
      return;
    }

    setCalling(true);
    try {
      await callFn({
        data: {
          phone: phone as string,
          name: name ?? null,
          routeNumbers: [route1.trim(), route2.trim()],
          saveAsDefault: remember,
        },
      });
      toast.success(`Calling ${name || phone}…`, {
        description: "Watch progress under Telephony → Auto Dialer.",
      });
      queryClient.invalidateQueries({ queryKey: ["dialer-sessions"] });
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't start the call");
    } finally {
      setCalling(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Call ${name || phone}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-emerald-400 group-hover:opacity-100"
        >
          <PhoneOutgoing className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="text-sm font-medium">Call {name || phone}</p>
          <p className="text-xs text-muted-foreground">
            Rings both numbers below at once — whichever answers first is connected.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Route number 1</Label>
          <Input value={route1} onChange={(e) => setRoute1(e.target.value)} placeholder="+971585248237" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Route number 2</Label>
          <Input value={route2} onChange={(e) => setRoute2(e.target.value)} placeholder="+971501234567" />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(Boolean(v))} />
          Remember these as the default
        </label>
        <Button size="sm" className="w-full" onClick={handleCall} disabled={calling}>
          {calling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOutgoing className="h-3.5 w-3.5" />}
          {calling ? "Calling…" : "Call now"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
