/**
 * White Label settings — workspace-scoped branding editor.
 * Gated on the white_labelling feature; custom domain and hide-WEBEE-branding
 * fields are additionally gated per their own feature keys (shown locked).
 */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock, Palette, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  getMyWhiteLabelSettings, saveMyWhiteLabelSettings,
} from "@/lib/reseller/reseller.functions";

export const Route = createFileRoute("/_authenticated/settings/white-label")({
  head: () => ({ meta: [{ title: "White Label — Webee" }] }),
  component: WhiteLabelSettings,
});

const EMPTY = {
  brand_name: "", logo_url: "", favicon_url: "", primary_color: "", secondary_color: "",
  accent_color: "", support_email: "", email_from_name: "", custom_domain: "",
  child_branding_mode: "inherit", hide_webee_branding: false,
};

function WhiteLabelSettings() {
  const qc = useQueryClient();
  const getFn = useServerFn(getMyWhiteLabelSettings);
  const saveFn = useServerFn(saveMyWhiteLabelSettings);

  const q = useQuery({
    queryKey: ["white-label-settings"],
    queryFn: () => getFn(),
    throwOnError: false,
  });

  const [form, setForm] = useState<Record<string, any>>(EMPTY);
  useEffect(() => {
    if (q.data?.settings) {
      const s = q.data.settings as any;
      setForm({
        ...EMPTY,
        ...Object.fromEntries(
          Object.keys(EMPTY).map((k) => [k, s[k] ?? (EMPTY as any)[k]]),
        ),
      });
    }
  }, [q.data]);

  const saveMut = useMutation({
    mutationFn: () => saveFn({ data: form as any }),
    onSuccess: () => {
      toast.success("White label settings saved");
      qc.invalidateQueries({ queryKey: ["white-label-settings"] });
    },
    onError: (e: any) =>
      toast.error("Save failed", { description: e?.message }),
  });

  if (q.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <Palette className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">White Labelling unavailable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {(q.error as any)?.message ?? "White labelling is not included in your current package."}
        </p>
      </div>
    );
  }

  const meta = q.data!;
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const field = (k: string, label: string, placeholder = "") => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={form[k] ?? ""} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">White Label</h1>
          <p className="text-sm text-muted-foreground">Your brand across the platform and client accounts.</p>
        </div>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {saveMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("brand_name", "Brand name", "Acme AI")}
          {field("support_email", "Support email", "support@acme.co")}
          {field("logo_url", "Logo URL", "https://…/logo.png")}
          {field("favicon_url", "Favicon URL", "https://…/favicon.ico")}
          {field("primary_color", "Primary colour", "#6d5df6")}
          {field("secondary_color", "Secondary colour", "#1f1f2b")}
          {field("accent_color", "Accent colour", "#22c55e")}
          {field("email_from_name", "Email sender name", "Acme AI")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom domain</CardTitle>
          <CardDescription>
            {meta.canCustomDomain
              ? `Status: ${(q.data!.settings as any)?.custom_domain_status ?? "none"}`
              : "Not included in your current package."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {meta.canCustomDomain ? (
            field("custom_domain", "Custom domain", "app.acme.co")
          ) : (
            <Badge variant="secondary" className="gap-1"><Lock className="h-3 w-3" /> Upgrade to unlock</Badge>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>Hide WEBEE branding</Label>
              <p className="text-xs text-muted-foreground">
                {meta.canHideBranding ? "Remove 'Powered by WEBEE' across your workspace." : "Not included in your current package."}
              </p>
            </div>
            {meta.canHideBranding ? (
              <Switch checked={form.hide_webee_branding === true}
                onCheckedChange={(v) => set("hide_webee_branding", v)} />
            ) : (
              <Badge variant="secondary" className="gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
            )}
          </div>
          {meta.isReseller && (
            <div className="space-y-2">
              <Label>Default client branding</Label>
              <Select value={form.child_branding_mode}
                onValueChange={(v) => set("child_branding_mode", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Clients inherit my branding</SelectItem>
                  <SelectItem value="webee">Clients see WEBEE branding</SelectItem>
                  <SelectItem value="custom">Clients use their own branding</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
