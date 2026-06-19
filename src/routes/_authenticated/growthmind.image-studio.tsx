import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  ImageIcon, Loader2, Wand2, Download, ExternalLink, Copy, Trash2,
  Sparkles, RefreshCw, GalleryHorizontal, Zap, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle2, Info,
} from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  generateImageAsset, editImageAsset, createImageVariation,
  listImageAssets, deleteImageAsset, attachImageToCampaign,
  listCampaignDraftsForPicker, getImageStudioStatus,
  type ImageAsset, type AssetType, type PlatformHint, type KnowledgeContextType,
} from "@/lib/growthmind/growthmind.image-studio";

export const Route = createFileRoute("/_authenticated/growthmind/image-studio")({
  head: () => ({ meta: [{ title: "Image Studio — GrowthMind" }] }),
  component: ImageStudioPage,
});

// ── Constants ─────────────────────────────────────────────────────────────────

const ASSET_TYPES: Array<{ value: AssetType; label: string; hint: string }> = [
  { value: "ad_creative",   label: "Ad Creative",    hint: "Optimised for paid ad campaigns" },
  { value: "social_image",  label: "Social Image",   hint: "Shareable social media content" },
  { value: "product_image", label: "Product Image",  hint: "Showcase your product" },
  { value: "blog_image",    label: "Blog Image",     hint: "Header or inline blog graphic" },
  { value: "hero_image",    label: "Hero Image",     hint: "Landing page hero section" },
];

const PLATFORMS: Array<{ value: PlatformHint; label: string }> = [
  { value: "generic",   label: "Generic (versatile)" },
  { value: "meta",      label: "Meta (Facebook/Instagram)" },
  { value: "instagram", label: "Instagram" },
  { value: "linkedin",  label: "LinkedIn" },
  { value: "tiktok",    label: "TikTok" },
  { value: "google",    label: "Google Display" },
];

const SIZES: Array<{ label: string; width: number; height: number }> = [
  { label: "Square 1:1 (1024×1024)",        width: 1024, height: 1024 },
  { label: "Landscape 16:9 (1792×1024)",    width: 1792, height: 1024 },
  { label: "Portrait 9:16 (1024×1792)",     width: 1024, height: 1792 },
];

const STYLES = [
  { value: "vivid",           label: "Vivid (bold & colourful)" },
  { value: "photorealistic",  label: "Photorealistic (natural)" },
];

// ── Page ─────────────────────────────────────────────────────────────────────

function ImageStudioPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // URL params
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const urlCampaignId   = searchParams.get("campaignDraftId") ?? "";
  const urlAssetType    = (searchParams.get("assetType") ?? "ad_creative") as AssetType;
  const urlPrompt       = searchParams.get("prompt") ?? "";
  const urlContentId    = searchParams.get("contentAssetId") ?? "";

  // Form state
  const [prompt,          setPrompt]         = useState(urlPrompt);
  const [assetType,       setAssetType]      = useState<AssetType>(urlAssetType);
  const [platform,        setPlatform]       = useState<PlatformHint>("generic");
  const [kbContextType,   setKbContextType]  = useState<KnowledgeContextType>("default");
  const [customContext,   setCustomContext]  = useState("");
  const [selectedKbId,    setSelectedKbId]   = useState("");
  const [sizeIdx,         setSizeIdx]        = useState(0);
  const [style,           setStyle]          = useState("vivid");
  const [campaignId,      setCampaignId]     = useState(urlCampaignId);
  const [contentId]                          = useState(urlContentId);
  const [kbOpen,          setKbOpen]         = useState(false);

  const [generating,  setGenerating]  = useState(false);
  const [workingId,   setWorkingId]   = useState<string | null>(null);

  // Server fn instances
  const statusFn     = useServerFn(getImageStudioStatus);
  const generateFn   = useServerFn(generateImageAsset);
  const editFn       = useServerFn(editImageAsset);
  const variationFn  = useServerFn(createImageVariation);
  const listFn       = useServerFn(listImageAssets);
  const deleteFn     = useServerFn(deleteImageAsset);
  const attachFn     = useServerFn(attachImageToCampaign);
  const listDraftsFn = useServerFn(listCampaignDraftsForPicker);

  const { data: status } = useQuery({
    queryKey: ["image-studio-status"],
    queryFn:  () => statusFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const { data: assetsData, isLoading: assetsLoading } = useQuery({
    queryKey: ["image-assets", campaignId, contentId],
    queryFn:  () => listFn({ data: { campaignId: campaignId || undefined, contentAssetId: contentId || undefined, limit: 60 } }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    throwOnError: false,
  });

  const { data: drafts } = useQuery({
    queryKey: ["campaign-drafts-picker"],
    queryFn:  () => listDraftsFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const assets = assetsData?.assets ?? [];
  const size = SIZES[sizeIdx];

  // Sync prompt from URL
  useEffect(() => { if (urlPrompt) setPrompt(urlPrompt); }, [urlPrompt]);

  async function handleGenerate() {
    if (!prompt.trim()) { toast.error("Please enter a prompt"); return; }
    setGenerating(true);
    try {
      await generateFn({
        data: {
          prompt:               prompt.trim(),
          assetType,
          platformHint:         platform,
          knowledgeContextType: kbContextType,
          knowledgeContextId:   kbContextType === "specific_kb" ? selectedKbId : undefined,
          customContext:        kbContextType === "custom_campaign" ? customContext : undefined,
          campaignId:           campaignId || undefined,
          contentAssetId:       contentId  || undefined,
          width:                size.width,
          height:               size.height,
          style,
        },
      });
      toast.success("Image generated!");
      qc.invalidateQueries({ queryKey: ["image-assets"] });
      qc.invalidateQueries({ queryKey: ["image-library"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleVariation(assetId: string) {
    setWorkingId(assetId);
    try {
      await variationFn({ data: { assetId } });
      toast.success("Variation created!");
      qc.invalidateQueries({ queryKey: ["image-assets"] });
      qc.invalidateQueries({ queryKey: ["image-library"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    } finally {
      setWorkingId(null);
    }
  }

  async function handleDelete(assetId: string) {
    setWorkingId(assetId);
    try {
      await deleteFn({ data: { assetId } });
      qc.invalidateQueries({ queryKey: ["image-assets"] });
      qc.invalidateQueries({ queryKey: ["image-library"] });
    } catch {
      toast.error("Failed to delete");
    } finally {
      setWorkingId(null);
    }
  }

  async function handleAttach(assetId: string) {
    if (!campaignId) { toast.error("No campaign selected"); return; }
    setWorkingId(assetId);
    try {
      await attachFn({ data: { assetId, campaignDraftId: campaignId } });
      toast.success("Attached to campaign!");
      qc.invalidateQueries({ queryKey: ["image-assets"] });
    } catch {
      toast.error("Failed to attach");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <GrowthMindShell>
      <div className="flex h-full min-h-screen">

        {/* ── Left Panel: Controls ─────────────────────────────────────────── */}
        <div className="w-80 shrink-0 border-r border-white/[0.06] bg-background/60 flex flex-col">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/15 ring-1 ring-orange-500/25">
              <ImageIcon className="h-4 w-4 text-orange-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight">Image Studio</h1>
              <p className="text-[10px] text-muted-foreground">AI creative generation</p>
            </div>
          </div>

          {/* Provider status */}
          {status && (
            <div className={cn(
              "mx-4 mt-3 rounded-lg px-3 py-2 text-xs flex items-center gap-2",
              status.connected
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                : "bg-amber-500/10 border border-amber-500/20 text-amber-400"
            )}>
              {status.connected
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                : <AlertCircle  className="h-3.5 w-3.5 shrink-0" />}
              {status.connected
                ? `${status.displayName} connected`
                : "No image provider — add OpenAI key in Settings → Providers"}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-5">

            {/* Prompt */}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Prompt *
              </Label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Describe the image you want to create…"
                rows={4}
                className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-orange-500/40 focus:outline-none focus:ring-0 transition-colors"
              />
            </div>

            {/* Asset Type */}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Asset Type
              </Label>
              <div className="grid grid-cols-1 gap-1">
                {ASSET_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setAssetType(t.value)}
                    className={cn(
                      "flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-all",
                      assetType === t.value
                        ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                        : "border-white/[0.06] bg-white/[0.02] text-foreground hover:border-white/[0.12]"
                    )}>
                    <span className="text-xs font-medium">{t.label}</span>
                    <span className="text-[10px] text-muted-foreground">{t.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Platform */}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Platform
              </Label>
              <select value={platform} onChange={e => setPlatform(e.target.value as PlatformHint)}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-foreground focus:outline-none">
                {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            {/* Size */}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Image Size
              </Label>
              <div className="space-y-1">
                {SIZES.map((s, i) => (
                  <button key={i} type="button" onClick={() => setSizeIdx(i)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-1.5 text-left text-xs transition-all",
                      sizeIdx === i
                        ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                        : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:border-white/[0.12]"
                    )}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Style */}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Style
              </Label>
              <div className="flex gap-1.5">
                {STYLES.map(s => (
                  <button key={s.value} type="button" onClick={() => setStyle(s.value)}
                    className={cn(
                      "flex-1 rounded-lg border px-2 py-1.5 text-xs transition-all",
                      style === s.value
                        ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                        : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:border-white/[0.12]"
                    )}>
                    {s.label.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Knowledge Context */}
            <div className="space-y-1.5">
              <button type="button" onClick={() => setKbOpen(o => !o)}
                className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
                <span>Knowledge Context</span>
                {kbOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {kbOpen && (
                <div className="space-y-2">
                  {(["default","specific_kb","custom_campaign","none"] as KnowledgeContextType[]).map(ct => (
                    <label key={ct} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="kbCtx" value={ct} checked={kbContextType === ct}
                        onChange={() => setKbContextType(ct)}
                        className="accent-orange-500" />
                      <span className="text-xs text-foreground capitalize">{ct.replace(/_/g, " ")}</span>
                    </label>
                  ))}
                  {kbContextType === "custom_campaign" && (
                    <textarea rows={3} value={customContext} onChange={e => setCustomContext(e.target.value)}
                      placeholder="Paste your campaign brief or custom context…"
                      className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none" />
                  )}
                </div>
              )}
            </div>

            {/* Campaign attachment */}
            {drafts && drafts.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Attach to Campaign (optional)
                </Label>
                <select value={campaignId} onChange={e => setCampaignId(e.target.value)}
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground focus:outline-none">
                  <option value="">— None —</option>
                  {drafts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Generate button */}
          <div className="p-4 border-t border-white/[0.06]">
            <Button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim() || !status?.connected}
              className="w-full gap-2 bg-orange-500/20 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 disabled:opacity-40">
              {generating ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Generate Image</>
              )}
            </Button>
            {generating && (
              <p className="text-center text-[10px] text-muted-foreground mt-2">
                This takes 10–30 seconds…
              </p>
            )}
          </div>
        </div>

        {/* ── Right Panel: Asset Gallery ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold">
                {campaignId
                  ? `Campaign: ${drafts?.find(d => d.id === campaignId)?.name ?? "…"}`
                  : "All Generated Images"}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {assetsLoading ? "Loading…" : `${assets.length} image${assets.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            <Button variant="outline" size="sm" className="text-xs gap-1.5"
              onClick={() => navigate({ to: "/growthmind/image-library" })}>
              <GalleryHorizontal className="h-3.5 w-3.5" />
              Full Library
            </Button>
          </div>

          {assetsLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : assets.length === 0 ? (
            <EmptyState connected={status?.connected ?? false} onGenerate={handleGenerate} />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {assets.map(asset => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  working={workingId === asset.id}
                  hasCampaign={!!campaignId}
                  onVariation={() => handleVariation(asset.id)}
                  onDelete={() => handleDelete(asset.id)}
                  onAttach={() => handleAttach(asset.id)}
                  onUsePrompt={() => setPrompt(asset.prompt)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </GrowthMindShell>
  );
}

// ── Asset Card ────────────────────────────────────────────────────────────────

function AssetCard({
  asset, working, hasCampaign, onVariation, onDelete, onAttach, onUsePrompt,
}: {
  asset: ImageAsset;
  working: boolean;
  hasCampaign: boolean;
  onVariation(): void;
  onDelete(): void;
  onAttach(): void;
  onUsePrompt(): void;
}) {
  const PLATFORM_BADGE: Record<string, string> = {
    meta: "Meta", instagram: "IG", linkedin: "LI",
    tiktok: "TT", google: "GGL", generic: "Generic",
  };
  const ASSET_BADGE: Record<string, string> = {
    ad_creative: "Ad", social_image: "Social", product_image: "Product",
    blog_image: "Blog", hero_image: "Hero", variation: "Variation", edit: "Edit",
  };

  return (
    <div className="group rounded-xl border border-white/[0.06] bg-card/50 overflow-hidden hover:border-white/[0.12] transition-all">
      {/* Image area */}
      <div className="relative aspect-square bg-white/[0.03]">
        {asset.status === "generating" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-orange-400" />
            <p className="text-[10px] text-muted-foreground">Generating…</p>
          </div>
        ) : asset.status === "failed" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <p className="text-[9px] text-red-400 text-center leading-snug">
              {asset.error_message ?? "Generation failed"}
            </p>
          </div>
        ) : asset.image_url ? (
          <img src={asset.image_url} alt={asset.prompt.slice(0, 60)}
            className="w-full h-full object-cover" loading="lazy" />
        ) : null}

        {asset.status === "ready" && asset.image_url && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
            {/* Top row: actions */}
            <div className="flex gap-2">
              <a href={asset.image_url} target="_blank" rel="noopener noreferrer" download
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/25 transition-colors" title="Download">
                <Download className="h-3.5 w-3.5" />
              </a>
              <a href={asset.image_url} target="_blank" rel="noopener noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/25 transition-colors" title="Open full size">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={() => { navigator.clipboard.writeText(asset.image_url); toast.success("URL copied!"); }}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/25 transition-colors" title="Copy URL">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Bottom row: smart actions */}
            <div className="flex gap-1.5">
              <button onClick={onVariation} disabled={working}
                className="flex items-center gap-1 rounded border border-white/20 bg-white/10 px-2 py-1 text-[9px] hover:bg-white/20 transition-colors disabled:opacity-50">
                {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Variation
              </button>
              <button onClick={onUsePrompt}
                className="flex items-center gap-1 rounded border border-white/20 bg-white/10 px-2 py-1 text-[9px] hover:bg-white/20 transition-colors">
                <Wand2 className="h-3 w-3" />
                Edit prompt
              </button>
            </div>
            {hasCampaign && (
              <button onClick={onAttach} disabled={working}
                className="flex items-center gap-1 rounded border border-orange-500/30 bg-orange-500/15 text-orange-300 px-2 py-1 text-[9px] hover:bg-orange-500/25 transition-colors">
                <Zap className="h-3 w-3" />
                Attach to campaign
              </button>
            )}
          </div>
        )}
      </div>

      {/* Card footer */}
      <div className="p-2 space-y-1.5">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-1.5 py-0.5 text-[9px] text-orange-400 font-medium">
            {ASSET_BADGE[asset.asset_type] ?? asset.asset_type}
          </span>
          <span className="rounded-full border border-white/[0.06] px-1.5 py-0.5 text-[9px] text-muted-foreground">
            {PLATFORM_BADGE[asset.platform_hint] ?? asset.platform_hint}
          </span>
          {asset.parent_asset_id && (
            <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-400">
              Variant
            </span>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground/60 line-clamp-2 leading-snug">
          {(asset.revised_prompt ?? asset.prompt).slice(0, 90)}
        </p>

        {asset.status === "ready" && (
          <button onClick={onDelete} disabled={working}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-red-400 transition-colors">
            <Trash2 className="h-2.5 w-2.5" /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ connected, onGenerate }: { connected: boolean; onGenerate(): void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500/10 ring-1 ring-orange-500/20">
        <ImageIcon className="h-8 w-8 text-orange-400/60" />
      </div>
      <div className="space-y-1 max-w-xs">
        <p className="text-sm font-medium text-muted-foreground">
          {connected ? "No images yet" : "Image provider not connected"}
        </p>
        <p className="text-xs text-muted-foreground/60">
          {connected
            ? "Enter a prompt on the left and click Generate Image to create your first creative asset."
            : "Add your OpenAI API key in Settings → Providers → Image Generation to start generating images."}
        </p>
      </div>
      {connected && (
        <Button size="sm" className="gap-1.5 text-xs bg-orange-500/20 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30"
          onClick={onGenerate}>
          <Sparkles className="h-3.5 w-3.5" /> Generate First Image
        </Button>
      )}
    </div>
  );
}
