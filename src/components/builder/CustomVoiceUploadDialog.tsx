/**
 * Add Custom Voice dialog — mirrors Retell's "Add Custom Voice" UI exactly.
 *
 * Tab 1 – Community Voices
 *   Search ElevenLabs shared voices by name. Results show voice name, labels
 *   (gender / accent) and ElevenLabs voice ID. Selecting a voice registers it
 *   with Retell via /create-voice and returns a custom_voice_xxx ID.
 *
 * Tab 2 – Voice Clone
 *   Upload an audio sample (MP3/WAV/M4A ≤ 15 MB). Retell clones the voice via
 *   /clone-voice and returns the new custom_voice_xxx ID.
 *
 * Tab 3 – Import Professional Voices
 *   Paste an ElevenLabs voice ID directly. The ID is stored in the format
 *   11labs-{id} so Retell routes audio through ElevenLabs.
 */
import { useRef, useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  Upload,
  Mic,
  Plus,
  Search,
  Play,
  Check,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  cloneCustomVoice,
  searchElevenLabsVoices,
  addElevenLabsCommunityVoice,
} from "@/lib/builder/retell.functions";

type Tab = "community" | "clone" | "professional";

const MAX_BYTES = 15 * 1024 * 1024;

interface Props {
  onUploaded: (voiceId: string, voiceName?: string) => void;
}

export function CustomVoiceUploadDialog({ onUploaded }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("community");

  /* ── community voices ── */
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [voices, setVoices] = useState<
    Array<{
      voice_id: string;
      name: string;
      description: string | null;
      labels: Record<string, string>;
      preview_url: string | null;
    }>
  >([]);
  const [missingKey, setMissingKey] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* ── voice clone ── */
  const [cloneName, setCloneName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [cloning, setCloning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── professional import ── */
  const [proId, setProId] = useState("");
  const [proName, setProName] = useState("");
  const [proImporting, setProImporting] = useState(false);

  const searchFn = useServerFn(searchElevenLabsVoices);
  const addFn = useServerFn(addElevenLabsCommunityVoice);
  const cloneFn = useServerFn(cloneCustomVoice);

  /* auto-search on open */
  useEffect(() => {
    if (open && tab === "community") runSearch("");
  }, [open, tab]);

  function reset() {
    setTab("community");
    setQuery("");
    setVoices([]);
    setCloneName("");
    setFile(null);
    setProId("");
    setProName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  /* ── Community Voice search ── */
  async function runSearch(q: string) {
    setSearching(true);
    try {
      const res = await searchFn({ data: { query: q } });
      setMissingKey(res.missingKey);
      setVoices(res.voices);
    } catch (e) {
      toast.error("Search failed", { description: (e as Error).message });
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (tab !== "community") return;
    const id = setTimeout(() => runSearch(query), 400);
    return () => clearTimeout(id);
  }, [query, tab]);

  async function handleAddCommunity(v: (typeof voices)[number]) {
    setAddingId(v.voice_id);
    try {
      const res = await addFn({
        data: { elevenLabsVoiceId: v.voice_id, voiceName: v.name },
      });
      if (!res.voiceId) throw new Error("No voice ID returned");
      onUploaded(res.voiceId, res.voiceName);
      toast.success("Voice added", { description: res.voiceName });
      setOpen(false);
      reset();
    } catch (e) {
      toast.error("Failed to add voice", { description: (e as Error).message });
    } finally {
      setAddingId(null);
    }
  }

  function handlePlayPreview(url: string, voiceId: string) {
    if (playingId === voiceId) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => setPlayingId(null);
    a.play().catch(() => {});
    setPlayingId(voiceId);
  }

  /* ── Voice Clone ── */
  async function handleClone() {
    if (!cloneName.trim()) return toast.error("Voice name required");
    if (!file) return toast.error("Pick an audio file");
    if (file.size > MAX_BYTES)
      return toast.error("File too large", { description: "Max 15 MB. Trim and retry." });

    setCloning(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk)
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const fileBase64 = btoa(binary);

      const res = await cloneFn({
        data: {
          voiceName: cloneName.trim(),
          voiceProvider: "elevenlabs",
          fileBase64,
          fileName: file.name,
          mimeType: file.type || "audio/mpeg",
        },
      });
      if (!res.voiceId) throw new Error("No voice ID returned — check audio file and retry");
      onUploaded(res.voiceId, res.voiceName);
      toast.success("Voice cloned", { description: res.voiceName });
      setOpen(false);
      reset();
    } catch (e) {
      toast.error("Clone failed", { description: (e as Error).message });
    } finally {
      setCloning(false);
    }
  }

  /* ── Professional import ── */
  async function handleProImport() {
    const raw = proId.trim();
    if (!raw) return toast.error("Voice ID required");
    const elVoiceId = raw.startsWith("11labs-") ? raw.slice(7) : raw;
    setProImporting(true);
    try {
      const res = await addFn({
        data: { elevenLabsVoiceId: elVoiceId, voiceName: proName.trim() || elVoiceId },
      });
      if (!res.voiceId) throw new Error("No voice ID returned");
      onUploaded(res.voiceId, res.voiceName);
      toast.success("Voice added", { description: res.voiceName });
      setOpen(false);
      reset();
    } catch (e) {
      toast.error("Failed to add voice", { description: (e as Error).message });
    } finally {
      setProImporting(false);
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "community", label: "Community Voices" },
    { id: "clone", label: "Voice Clone" },
    { id: "professional", label: "Import Professional Voices" },
  ];

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 text-xs"
        onClick={() => setOpen(true)}
        title="Add a custom ElevenLabs voice"
      >
        <Plus className="h-3.5 w-3.5" />
        Add custom voice
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            reset();
            audioRef.current?.pause();
          }
        }}
      >
        <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-0 p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>Add Custom Voice</DialogTitle>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex border-b border-border px-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-[11px] font-medium transition-colors border-b-2 -mb-px ${
                  tab === t.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Community Voices ── */}
          {tab === "community" && (
            <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
              {/* Voice Name search */}
              <div className="px-5 py-3 border-b border-border space-y-2">
                <div className="text-xs text-muted-foreground">
                  Voice Name
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  {searching && (
                    <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search…"
                    className="h-8 pl-8 pr-8 text-sm"
                    autoFocus
                  />
                </div>
                {missingKey && (
                  <p className="text-[11px] text-amber-500">
                    ELEVENLABS_API_KEY not configured — community voice search is unavailable.{" "}
                    <a
                      href="https://elevenlabs.io/app/voice-library"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Browse voices
                    </a>{" "}
                    and use the{" "}
                    <button
                      className="underline"
                      onClick={() => setTab("professional")}
                    >
                      Import Professional Voices
                    </button>{" "}
                    tab instead.
                  </p>
                )}
                {!missingKey && (
                  <p className="text-[11px] text-muted-foreground">
                    Explore the ElevenLabs community voices{" "}
                    <a
                      href="https://elevenlabs.io/app/voice-library"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 underline"
                    >
                      here <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    .
                  </p>
                )}
              </div>

              {/* Results list */}
              <div className="flex-1 overflow-y-auto">
                {searching && voices.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                  </div>
                ) : voices.length === 0 && !missingKey ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No voices found.{" "}
                    {query ? "Try a different name." : "Type to search."}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-5 py-2 w-6" />
                        <th className="px-3 py-2">Voice</th>
                        <th className="px-3 py-2">Trait</th>
                        <th className="px-3 py-2">Voice ID</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {voices.map((v) => (
                        <tr
                          key={v.voice_id}
                          className="group border-b border-border/40 hover:bg-muted/30 transition-colors"
                        >
                          {/* Preview play */}
                          <td className="px-5 py-2.5">
                            {v.preview_url ? (
                              <button
                                onClick={() =>
                                  v.preview_url && handlePlayPreview(v.preview_url, v.voice_id)
                                }
                                className="flex h-6 w-6 items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors"
                              >
                                {playingId === v.voice_id ? (
                                  <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
                                ) : (
                                  <Play className="h-2.5 w-2.5 fill-current" />
                                )}
                              </button>
                            ) : (
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/40 text-muted-foreground text-[10px]">
                                <Mic className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </td>
                          {/* Name + description */}
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-xs">{v.name}</p>
                            {v.description && (
                              <p className="text-[10px] text-muted-foreground line-clamp-1 max-w-[220px]">
                                {v.description}
                              </p>
                            )}
                          </td>
                          {/* Labels */}
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {Object.values(v.labels)
                                .slice(0, 3)
                                .map((lv, i) => (
                                  <span
                                    key={i}
                                    className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground capitalize"
                                  >
                                    {lv}
                                  </span>
                                ))}
                            </div>
                          </td>
                          {/* Voice ID */}
                          <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground">
                            {v.voice_id}
                          </td>
                          {/* Add button */}
                          <td className="px-3 py-2.5 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px]"
                              disabled={addingId === v.voice_id}
                              onClick={() => handleAddCommunity(v)}
                            >
                              {addingId === v.voice_id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3 mr-1" />
                              )}
                              Add
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── Voice Clone ── */}
          {tab === "clone" && (
            <div className="flex flex-col gap-4 px-5 py-5">
              <p className="text-xs text-muted-foreground">
                Upload 30 s – 3 min of clean, single-speaker audio (MP3, WAV, M4A — up to 15 MB).
                Your voice will be cloned via ElevenLabs and assigned a unique voice ID.
              </p>

              <div className="space-y-1">
                <Label className="text-xs">Voice name</Label>
                <Input
                  placeholder="e.g. Sarah – warm UK"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  disabled={cloning}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Audio sample</Label>
                <Input
                  ref={fileRef}
                  type="file"
                  accept="audio/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  disabled={cloning}
                />
                {file && (
                  <p className="text-xs text-muted-foreground">
                    {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                )}
              </div>

              <Button
                onClick={handleClone}
                disabled={cloning || !file || !cloneName.trim()}
                className="self-start"
              >
                {cloning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Clone voice
              </Button>
            </div>
          )}

          {/* ── Import Professional Voices ── */}
          {tab === "professional" && (
            <div className="flex flex-col gap-4 px-5 py-5">
              <p className="text-xs text-muted-foreground">
                Paste an ElevenLabs voice ID to use it directly. Find your voice IDs in your{" "}
                <a
                  href="https://elevenlabs.io/app/voice-lab"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 underline"
                >
                  ElevenLabs dashboard <ExternalLink className="h-2.5 w-2.5" />
                </a>
                . Professional / cloned voices from your own ElevenLabs account can be used here.
              </p>

              <div className="space-y-1">
                <Label className="text-xs">Voice Name</Label>
                <Input
                  placeholder="e.g. Sarah – warm UK"
                  value={proName}
                  onChange={(e) => setProName(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">ElevenLabs Voice ID</Label>
                <Input
                  placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
                  value={proId}
                  onChange={(e) => setProId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleProImport()}
                />
                <p className="text-[10px] text-muted-foreground">
                  The 20-character ID from your ElevenLabs voice page. The voice will be registered
                  and ready to use in the builder immediately — no API key required.
                </p>
              </div>

              <Button
                onClick={handleProImport}
                disabled={!proId.trim() || proImporting}
                className="self-start"
              >
                {proImporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {proImporting ? "Importing…" : "Use this voice"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
