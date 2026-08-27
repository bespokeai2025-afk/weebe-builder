/**
 * Upload an audio sample to Fish Audio and select the new clone for WEBEE Native.
 */
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mic, Plus, Upload } from "lucide-react";
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
import { createFishVoice } from "@/lib/voice/fish-voices.functions";

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/opus,.mp3,.wav,.m4a,.opus";

interface Props {
  onCloned: (voiceId: string, voiceName: string) => void;
}

export function FishVoiceCloneDialog({ onCloned }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [cloning, setCloning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cloneFn = useServerFn(createFishVoice);

  function reset() {
    setTitle("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleClone() {
    const name = title.trim();
    if (!name) return toast.error("Voice name required");
    if (!file) return toast.error("Upload an audio sample");
    if (file.size > MAX_BYTES) return toast.error("File must be 20 MB or smaller");

    setCloning(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const audioBase64 = btoa(binary);

      const res = await cloneFn({
        data: {
          title: name,
          audioBase64,
          fileName: file.name,
          mimeType: file.type || undefined,
        },
      });

      onCloned(res.voiceId, res.title);
      toast.success("Voice cloned", { description: res.title });
      setOpen(false);
      reset();
    } catch (e) {
      toast.error("Clone failed", { description: (e as Error).message });
    } finally {
      setCloning(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1 text-[9px] shrink-0"
        onClick={() => setOpen(true)}
        title="Clone a voice from an audio sample"
      >
        <Plus className="h-2.5 w-2.5" />
        Clone voice
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>Clone Fish Audio voice</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Voice name</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Nathan — sales"
                className="h-8 text-sm"
                autoFocus
              />
            </div>

            <div className="space-y-1">
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
                className="flex w-full items-center gap-2 rounded-md border border-dashed border-white/15 px-3 py-4 text-left text-xs text-muted-foreground hover:border-white/25 hover:bg-white/[0.03] transition-colors"
              >
                {file ? (
                  <>
                    <Mic className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate text-foreground">{file.name}</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 shrink-0" />
                    <span>MP3, WAV, M4A, or Opus — 15–30 s of clean speech works best</span>
                  </>
                )}
              </button>
            </div>

            <p className="text-[10px] text-muted-foreground leading-snug">
              The clone is private to your Fish account and appears under Your clones. Training is
              instant (fast mode).
            </p>

            <Button
              type="button"
              className="w-full"
              disabled={cloning || !title.trim() || !file}
              onClick={() => void handleClone()}
            >
              {cloning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Cloning…
                </>
              ) : (
                "Create clone"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
