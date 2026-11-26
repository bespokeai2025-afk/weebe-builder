/**
 * Clone a voice from an audio sample, on whichever provider the picker is showing.
 * Only rendered for providers whose `VOICE_PROVIDERS` entry says they can clone.
 */
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileAudio, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { cloneLibraryVoice } from "@/lib/voice/voice-library.functions";
import { VOICE_PROVIDERS, type VoiceLibraryProvider } from "@/lib/voice/voice-library.shared";

const ACCEPT =
  "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,audio/webm,audio/flac,.mp3,.wav,.m4a,.ogg,.webm,.flac";

/** Languages a Cartesia clone can be tagged with (Cartesia requires one). */
const CLONE_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "it", label: "Italian" },
  { id: "pt", label: "Portuguese" },
  { id: "hi", label: "Hindi" },
  { id: "ar", label: "Arabic" },
] as const;

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface Props {
  provider: VoiceLibraryProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloned: (voice: { id: string; name: string }) => void;
}

export function VoiceCloneDialog({ provider, open, onOpenChange, onCloned }: Props) {
  const caps = VOICE_PROVIDERS[provider];
  const clone = useServerFn(cloneLibraryVoice);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const maxMb = Math.round((caps.cloneMaxBytes ?? 0) / 1024 / 1024);
  const tooBig = !!file && !!caps.cloneMaxBytes && file.size > caps.cloneMaxBytes;

  function reset() {
    setName("");
    setFile(null);
    setLanguage("en");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    if (!file || !name.trim() || tooBig) return;
    setBusy(true);
    try {
      const out = await clone({
        data: {
          provider,
          name: name.trim(),
          language,
          audioBase64: await fileToBase64(file),
          fileName: file.name,
          mimeType: file.type || undefined,
        },
      });
      toast.success("Voice cloned", { description: `${out.name} is ready on ${caps.label}.` });
      onCloned(out);
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error("Couldn't clone the voice", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clone a voice on {caps.label}</DialogTitle>
          <DialogDescription>
            Upload 15–30 seconds of one person speaking clearly, with no music or background noise.
            The clone is private to your workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="clone-name" className="text-xs">
              Voice name
            </Label>
            <Input
              id="clone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sarah – reception"
              autoFocus
            />
          </div>

          {provider === "cartesia" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Language spoken in the sample</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLONE_LANGUAGES.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Audio sample</Label>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) setFile(dropped);
              }}
              className={cn(
                "flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/50",
              )}
            >
              {file ? (
                <>
                  <FileAudio className="h-6 w-6 text-primary" />
                  <span className="max-w-full truncate text-sm font-medium">{file.name}</span>
                  <span
                    className={cn("text-xs", tooBig ? "text-destructive" : "text-muted-foreground")}
                  >
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                    {tooBig ? ` — over the ${maxMb} MB limit` : " · click to change"}
                  </span>
                </>
              ) : (
                <>
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-medium">Drop an audio file or click to browse</span>
                  <span className="text-xs text-muted-foreground">
                    MP3, WAV, M4A, OGG, WebM or FLAC, up to {maxMb} MB
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !file || !name.trim() || tooBig}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy ? "Cloning…" : "Create clone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
