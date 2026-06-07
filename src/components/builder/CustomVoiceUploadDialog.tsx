import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Upload, Mic } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cloneCustomVoice } from "@/lib/builder/retell.functions";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB

interface Props {
  onUploaded: (voiceId: string) => void;
}

export function CustomVoiceUploadDialog({ onUploaded }: Props) {
  const [open, setOpen] = useState(false);
  const [voiceName, setVoiceName] = useState("");
  const [provider, setProvider] = useState<"elevenlabs" | "playht">("elevenlabs");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const clone = useServerFn(cloneCustomVoice);

  const reset = () => {
    setVoiceName("");
    setProvider("elevenlabs");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  async function handleUpload() {
    if (!voiceName.trim()) return toast.error("Voice name required");
    if (!file) return toast.error("Pick an audio file");
    if (file.size > MAX_BYTES) {
      return toast.error("File too large", {
        description: "Max 15 MB. Trim the sample and try again.",
      });
    }

    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      // Convert to base64 in chunks to avoid stack-overflow on large samples.
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const fileBase64 = btoa(binary);

      const res = await clone({
        data: {
          voiceName: voiceName.trim(),
          voiceProvider: provider,
          fileBase64,
          fileName: file.name,
          mimeType: file.type || "audio/mpeg",
        },
      });
      if (!res.voiceId) throw new Error("Retell did not return a voice ID");

      onUploaded(res.voiceId);
      toast.success("Custom voice cloned", {
        description: `${res.voiceName} (${res.voiceId})`,
      });
      setOpen(false);
      reset();
    } catch (e) {
      toast.error("Voice upload failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0 shrink-0"
          title="Upload a custom voice sample"
        >
          <Upload className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-4 w-4" /> Upload custom voice
          </DialogTitle>
          <DialogDescription>
            Clone a voice from an audio sample (MP3, WAV, M4A — up to 15 MB). For best results
            upload 30 s – 3 min of clean, single-speaker audio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Voice name</Label>
            <Input
              placeholder="e.g. Sarah – warm UK"
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as "elevenlabs" | "playht")}
              disabled={busy}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                <SelectItem value="playht">PlayHT</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Audio sample</Label>
            <Input
              ref={fileRef}
              type="file"
              accept="audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={busy || !file || !voiceName.trim()}>
            {busy ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            Clone voice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
