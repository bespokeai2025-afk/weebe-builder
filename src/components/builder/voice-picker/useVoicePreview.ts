/**
 * One audio player for the voice picker: only one voice plays at a time, a second press stops it,
 * and every sample is cached for the life of the picker.
 *
 * A row's play button uses the sample the provider hosts when there is one (instant, free). With a
 * custom preview line or changed settings, or when the voice has no hosted sample, the line is
 * spoken through `previewLibraryVoice` — the same voice profile a call uses.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { previewLibraryVoice } from "@/lib/voice/voice-library.functions";
import type { LibraryVoice, VoiceLibraryProvider } from "@/lib/voice/voice-library.shared";

export interface PreviewRequest {
  provider: VoiceLibraryProvider;
  voice: Pick<LibraryVoice, "id" | "owned" | "sampleUrl">;
  text: string;
  model?: string;
  settings: Record<string, unknown>;
  /** Use the provider's hosted sample when there is one. */
  preferSample: boolean;
}

export function useVoicePreview() {
  const preview = useServerFn(previewLibraryVoice);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef(new Map<string, string>());
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingKey(null);
  }, []);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      for (const url of cacheRef.current.values()) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
      cacheRef.current.clear();
    },
    [],
  );

  const playUrl = useCallback(
    (key: string, url: string) =>
      new Promise<void>((resolve, reject) => {
        audioRef.current?.pause();
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (audioRef.current === audio) {
            audioRef.current = null;
            setPlayingKey(null);
          }
        };
        audio
          .play()
          .then(() => {
            setPlayingKey(key);
            resolve();
          })
          .catch(reject);
      }),
    [],
  );

  const synthesize = useCallback(
    async (req: PreviewRequest): Promise<string> => {
      const cacheKey = JSON.stringify([
        req.provider,
        req.voice.id,
        req.text,
        req.model,
        req.settings,
      ]);
      const cached = cacheRef.current.get(cacheKey);
      if (cached) return cached;
      const out = await preview({
        data: {
          provider: req.provider,
          voiceId: req.voice.id,
          text: req.text,
          model: req.model,
          settings: { ...req.settings, webeeVoiceOwned: req.voice.owned },
        },
      });
      const bytes = Uint8Array.from(atob(out.audio), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: out.mimeType }));
      cacheRef.current.set(cacheKey, url);
      return url;
    },
    [preview],
  );

  /** Play (or stop) a voice. `key` identifies the button, so each button shows its own state. */
  const toggle = useCallback(
    async (key: string, req: PreviewRequest) => {
      if (playingKey === key) return stop();
      if (loadingKey) return;
      stop();
      setLoadingKey(key);
      try {
        if (req.preferSample && req.voice.sampleUrl) {
          try {
            await playUrl(key, req.voice.sampleUrl);
            return;
          } catch {
            // Hosted sample unreachable or blocked: speak the line instead.
          }
        }
        await playUrl(key, await synthesize(req));
      } catch (err) {
        toast.error("Couldn't play this voice", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setLoadingKey(null);
      }
    },
    [loadingKey, playUrl, playingKey, stop, synthesize],
  );

  return { toggle, stop, playingKey, loadingKey };
}

export type VoicePreviewPlayer = ReturnType<typeof useVoicePreview>;
