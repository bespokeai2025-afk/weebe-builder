/**
 * Speaks a sample sentence through the agent's real voice with its pronunciation dictionary
 * applied, so a pronunciation can be heard in the builder before it goes on a call.
 *
 * It runs the same text pipeline as a live call (`applyPronunciationDictionary` with the voice's
 * provider), so what plays here is what callers will hear.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveFishApiKey } from "@/lib/voice/fish-voices.functions";
import { lookupWorkspaceVoiceApiKey } from "@/lib/voice/stt/workspace-key";
import { createTtsProvider, parseTtsProviderName } from "@/lib/voice/tts";
import {
  applyPronunciationDictionary,
  unsupportedPronunciationEntries,
  type PronunciationEntry,
} from "@/lib/voice/tts/pronunciation-dictionary.shared";

const SAMPLE_RATE = 24_000;

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}

export interface PronunciationPreviewInput {
  text: string;
  entries: PronunciationEntry[];
  /** "fish" | "cartesia" | "openai" — the agent's native TTS provider. */
  provider: string;
  voiceId: string;
  model?: string;
}

export const previewPronunciation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: PronunciationPreviewInput) => input)
  .handler(async ({ context, data }) => {
    const workspaceId = (context as { workspaceId?: string | null }).workspaceId ?? null;
    const provider = parseTtsProviderName(data.provider) ?? "fish";
    const text = (data.text ?? "").trim().slice(0, 400);
    if (!text) throw new Error("Type a sentence to hear.");

    const target = { provider };
    const spoken = applyPronunciationDictionary(text, data.entries, target);
    const skipped = unsupportedPronunciationEntries(data.entries, target).map((e) => e.word);

    const fishKey = provider === "fish" ? await resolveFishApiKey(workspaceId) : null;
    const cartesiaKey =
      provider === "cartesia"
        ? (await lookupWorkspaceVoiceApiKey(supabaseAdmin as never, workspaceId ?? undefined, "cartesia")) ||
          String(process.env.CARTESIA_API_KEY ?? "").trim()
        : null;
    const tts = createTtsProvider(provider, {
      fishApiKey: fishKey ?? undefined,
      cartesiaApiKey: cartesiaKey ?? undefined,
      openaiApiKey: process.env.OPENAI_API_KEY,
      cartesiaTtsModel: provider === "cartesia" ? data.model : undefined,
      openaiTtsModel: provider === "openai" ? data.model : undefined,
    });

    const chunks: Buffer[] = [];
    for await (const chunk of tts.synthesize(spoken, {
      voiceId: data.voiceId,
      sampleRate: SAMPLE_RATE,
      latency: "low",
    })) {
      chunks.push(chunk);
    }
    const pcm = Buffer.concat(chunks);
    if (!pcm.byteLength) throw new Error("The voice returned no audio.");
    return {
      audio: pcmToWav(pcm, SAMPLE_RATE).toString("base64"),
      mimeType: "audio/wav" as const,
      skipped,
    };
  });
