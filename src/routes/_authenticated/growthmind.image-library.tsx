import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  GalleryHorizontal, ImageIcon, Loader2, Download, ExternalLink,
  Copy, Trash2, Wand2, RefreshCw, Filter, X,
} from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listImageAssets, deleteImageAsset, createImageVariation, editImageAsset,
  listCampaignDraftsForPicker, attachImageToCampaign,
  type ImageAsset, type AssetType, type PlatformHint,
} from "@/lib/growthmind/growthmind.image-studio";

export const Route = createFileRoute("/_authenticated/growthmind/image-library")({
  head: () => ({ meta: [{ title: "Image Library — GrowthMind" }] }),
  component: ImageLibraryPage,
});

const ASSET_TYPE_OPTIONS: Array<{ value: AssetType | ""; label: string }> = [
  { value: "",             label: "All Types" },
  { value: "ad_creative",  label: "Ad Creative" },
  { value: "social_image", label: "Social Image" },
  { value: "product_image",label: "Product Image" },
  { value: "blog_image",   label: "Blog Image" },
  { value: "hero_image",   label: "Hero Image" },
  { value: "variation",    label: "Variation" },
  { value: "edit",         label: "Edit" },
];

const PLATFORM_OPTIONS: Array<{ value: PlatformHint | ""; label: string }> = [
  { value: "",          label: "All Platforms" },
  { value: "meta",      label: "Meta" },
  { value: "instagram", label: "Instagram" },
  { value: "linkedin",  label: "LinkedIn" },
  { value: "tiktok",    label: "TikTok" },
  { value: "google",    label: "Google" },
  { value: "generic",   label: "Generic" },
];

const ASSET_TYPE_LABELS: Record<string, string> = {
  ad_creative: "Ad", social_image: "Social", product_image: "Product",
  blog_image: "Blog", hero_image: "Hero", variation: "Variation", edit: "Edit",
};
const PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta", instagram: "IG", linkedin: "LI",
  tiktok: "TT", google: "GGL", generic: "Generic",
};

function ImageLibraryPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetType | "">("");
  const [platformFilter,  setPlatformFilter]  = useState<PlatformHint | "">("");
  const [campaignFilter,  setCampaignFilter]  = useState("");
  const [filtersOpen,     setFiltersOpen]     = useState(false);
  const [attachOpen,      setAttachOpen]      = useState<string | null>(null);
  const [working,         setWorking]         = useState<string | null>(null);

  const listFn       = useServerFn(listImageAssets);
  const deleteFn     = useServerFn(deleteImageAsset);
  const variationFn  = useServerFn(createImageVariation);
  const attachCampFn = useServerFn(attachImageToCampaign);
  const listDraftsFn = useServerFn(listCampaignDraftsForPicker);

  const { data: assetsData, isLoading } = useQuery({
    queryKey: ["image-library", assetTypeFilter, platformFilter, campaignFilter],
    queryFn: () => listFn({
      data: {
        assetType:    assetTypeFilter || undefined,
        platformHint: platformFilter  || undefined,
        campaignId:   campaignFilter  || undefined,
        limit: 80,
      },
    }),
    staleTime: 30_000,
  });

  const { data: drafts } = useQuery({
    queryKey: ["campaign-drafts-picker"],
    queryFn:  () => listDraftsFn(),
    staleTime: 60_000,
  });

  const assets = assetsData?.assets ?? [];
  const total  = assetsData?.total  ?? 0;

  const activeFilters = [assetTypeFilter, platformFilter, campaignFilter].filter(Boolean).length;

  async function handleDelete(assetId: string) {
    setWorking(assetId);
    try {
      await deleteFn({ data: { assetId } });
      qc.invalidateQueries({ queryKey: ["image-library"] });
      qc.invalidateQueries({ queryKey: ["image-assets"] });
    } catch { toast.error("Failed to delete"); }
    finally { setWorking(null); }
  }

  async function handleVariation(assetId: string) {
    setWorking(assetId);
    try {
      await variationFn({ data: { assetId } });
      toast.success("Variation created!");
      qc.invalidateQueries({ queryKey: ["image-library"] });
      qc.invalidateQueries({ queryKey: ["image-assets"] });
    } catch (err: any) { toast.error(err?.message ?? "Failed"); }
    finally { setWorking(null); }
  }

  async function handleAttach(assetId: string, campaignDraftId: string) {
    setWorking(assetId);
    try {
      await attachCampFn({ data: { assetId, campaignDraftId } });
      toast.success("Attached to campaign!");
      setAttachOpen(null);
      qc.invalidateQueries({ queryKey: ["image-library"] });
    } catch { toast.error("Failed to attach"); }
    finally { setWorking(null); }
  }

  return (
    <GrowthMindShell>
      <div className="min-h-screen p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/15 ring-1 ring-orange-500/25">
              <GalleryHorizontal className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Image Library</h1>
              <p className="text-xs text-muted-foreground">
                {isLoading ? "Loading…" : `${total} image asset${total !== 1 ? "s" : ""} in your workspace`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="text-xs gap-1.5 relative"
              onClick={() => setFiltersOpen(o => !o)}>
              <Filter className="h-3.5 w-3.5" />
              Filters
              {activeFilters > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">
                  {activeFilters}
                </span>
              )}
            </Button>
            <Button size="sm" className="text-xs gap-1.5 bg-orange-500/20 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30"
              onClick={() => navigate({ to: "/growthmind/image-studio" })}>
              <ImageIcon className="h-3.5 w-3.5" />
              New Image
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        {filtersOpen && (
          <div className="rounded-xl border border-white/[0.06] bg-card/50 p-4 flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Asset Type</p>
              <select value={assetTypeFilter} onChange={e => setAssetTypeFilter(e.target.value as AssetType | "")}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-foreground focus:outline-none">
                {ASSET_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Platform</p>
              <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value as PlatformHint | "")}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-foreground focus:outline-none">
                {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Campaign</p>
              <select value={campaignFilter} onChange={e => setCampaignFilter(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-foreground focus:outline-none">
                <option value="">All Campaigns</option>
                {drafts?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            {activeFilters > 0 && (
              <button onClick={() => { setAssetTypeFilter(""); setPlatformFilter(""); setCampaignFilter(""); }}
                className="flex items-center gap-1 rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-3 w-3" /> Clear filters
              </button>
            )}
          </div>
        )}

        {/* Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <ImageIcon className="h-12 w-12 text-muted-foreground/25" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {activeFilters > 0 ? "No images match your filters" : "No images yet"}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {activeFilters > 0
                  ? "Try removing some filters"
                  : "Go to Image Studio to generate your first creative asset"}
              </p>
            </div>
            {activeFilters === 0 && (
              <Button size="sm" className="gap-1.5 mt-2 text-xs bg-orange-500/20 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30"
                onClick={() => navigate({ to: "/growthmind/image-studio" })}>
                <ImageIcon className="h-3.5 w-3.5" /> Open Image Studio
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {assets.map(asset => (
              <LibraryCard
                key={asset.id}
                asset={asset}
                drafts={drafts ?? []}
                working={working === asset.id}
                attachOpen={attachOpen === asset.id}
                onDelete={() => handleDelete(asset.id)}
                onVariation={() => handleVariation(asset.id)}
                onEdit={() => navigate({ to: "/growthmind/image-studio", search: { assetId: asset.id } as any })}
                onToggleAttach={() => setAttachOpen(o => o === asset.id ? null : asset.id)}
                onAttach={(cId) => handleAttach(asset.id, cId)}
              />
            ))}
          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}

function LibraryCard({
  asset, drafts, working, attachOpen,
  onDelete, onVariation, onEdit, onToggleAttach, onAttach,
}: {
  asset: ImageAsset;
  drafts: Array<{ id: string; name: string; campaign_type: string }>;
  working: boolean;
  attachOpen: boolean;
  onDelete(): void;
  onVariation(): void;
  onEdit(): void;
  onToggleAttach(): void;
  onAttach(campaignId: string): void;
}) {
  return (
    <div className="group rounded-xl border border-white/[0.06] bg-card/50 overflow-hidden hover:border-white/[0.12] transition-all">
      <div className="relative aspect-square bg-white/[0.03]">
        {asset.status === "generating" ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-orange-400" />
          </div>
        ) : asset.status === "failed" ? (
          <div className="absolute inset-0 flex items-center justify-center p-2">
            <p className="text-[9px] text-red-400 text-center">{asset.error_message ?? "Failed"}</p>
          </div>
        ) : asset.image_url ? (
          <img src={asset.image_url} alt={asset.prompt.slice(0, 60)} className="w-full h-full object-cover" loading="lazy" />
        ) : null}

        {asset.status === "ready" && asset.image_url && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
            <div className="flex gap-2">
              <a href={asset.image_url} target="_blank" rel="noopener noreferrer" download
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/25 transition-colors" title="Download">
                <Download className="h-3.5 w-3.5" />
              </a>
              <a href={asset.image_url} target="_blank" rel="noopener noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/25 transition-colors" title="Full size">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button onClick={() => { navigator.clipboard.writeText(asset.image_url); toast.success("URL copied"); }}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/25 transition-colors" title="Copy URL">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex gap-1.5">
              <button onClick={onEdit}
                className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[9px] hover:bg-white/20 transition-colors">
                Edit
              </button>
              <button onClick={onVariation} disabled={working}
                className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[9px] hover:bg-white/20 transition-colors">
                {working ? <Loader2 className="h-3 w-3 animate-spin" /> : "Variant"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="p-2 space-y-1.5">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-1.5 py-0.5 text-[9px] text-orange-400 font-medium">
            {ASSET_TYPE_LABELS[asset.asset_type] ?? asset.asset_type}
          </span>
          <span className="rounded-full border border-white/[0.06] px-1.5 py-0.5 text-[9px] text-muted-foreground">
            {PLATFORM_LABELS[asset.platform_hint] ?? asset.platform_hint}
          </span>
        </div>

        <p className="text-[10px] text-muted-foreground/60 line-clamp-2 leading-snug">
          {(asset.revised_prompt ?? asset.prompt).slice(0, 80)}
        </p>

        {asset.status === "ready" && (
          <div className="flex items-center gap-1 pt-0.5">
            <div className="relative flex-1">
              <button onClick={onToggleAttach}
                className="w-full rounded border border-white/[0.06] py-1 text-[9px] text-muted-foreground hover:text-orange-400 hover:border-orange-500/30 transition-colors">
                Attach
              </button>
              {attachOpen && (
                <div className="absolute bottom-full mb-1 left-0 z-30 w-52 rounded-lg border border-white/10 bg-popover shadow-xl overflow-hidden">
                  <p className="px-3 py-2 text-[10px] font-semibold text-muted-foreground border-b border-white/[0.06]">Attach to campaign</p>
                  {drafts.length === 0 ? (
                    <p className="px-3 py-2 text-[10px] text-muted-foreground">No drafts found</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto">
                      {drafts.map(d => (
                        <button key={d.id} onClick={() => onAttach(d.id)}
                          className="w-full px-3 py-2 text-left text-xs hover:bg-white/[0.05] text-foreground transition-colors">
                          {d.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button onClick={onDelete} disabled={working}
              className="rounded border border-white/[0.06] px-1.5 py-1 text-muted-foreground hover:text-red-400 hover:border-red-500/30 transition-colors">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
