/**
 * Video Assembly Service
 *
 * Stitches completed Veo clips (from growthmind_video_clips) into a single
 * MP4, optionally muxes an ElevenLabs voiceover, then uploads the result
 * to Supabase Storage (bucket: gm-videos).
 *
 * Uses ffmpeg 6.x (available in the Replit NixOS environment).
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const STORAGE_BUCKET = "gm-videos";
const ASSEMBLY_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes per ffmpeg call

// ── Main assembly entry-point ─────────────────────────────────────────────────

export async function assembleCompositeVideo(
  sb:          any,
  assetId:     string,
  workspaceId: string,
): Promise<{ ok: boolean; finalUrl?: string; error?: string }> {
  const tmpDir = path.join(os.tmpdir(), `gm-assembly-${assetId}`);

  try {
    // Mark as assembling
    await Promise.resolve(
      sb.from("growthmind_video_assets")
        .update({ assembly_status: "assembling" })
        .eq("id", assetId)
    ).catch(() => {});

    // Fetch completed clips sorted by scene_index
    const { data: clips, error: clipsErr } = await sb
      .from("growthmind_video_clips")
      .select("*")
      .eq("asset_id", assetId)
      .eq("status", "completed")
      .order("scene_index", { ascending: true });

    if (clipsErr) throw new Error(`Clips query failed: ${clipsErr.message}`);
    if (!clips || clips.length === 0) throw new Error("No completed clips found for assembly");

    // Fetch asset (for audio_url)
    const { data: asset } = await Promise.resolve(
      sb.from("growthmind_video_assets")
        .select("audio_url, requested_duration_seconds")
        .eq("id", assetId)
        .maybeSingle()
    ).catch(() => ({ data: null }));

    // Create temp workspace
    await fs.mkdir(tmpDir, { recursive: true });

    // Download each clip
    const clipPaths: string[] = [];
    for (const clip of clips) {
      const clipUrl = clip.archived_video_url || clip.raw_video_url;
      if (!clipUrl || !clipUrl.startsWith("http")) {
        console.warn(`[video-assembly] Clip ${clip.scene_index} missing URL — skipping`);
        continue;
      }
      const resp = await fetch(clipUrl);
      if (!resp.ok) {
        console.warn(`[video-assembly] Clip ${clip.scene_index} download failed (HTTP ${resp.status}) — skipping`);
        continue;
      }
      const bytes = await resp.arrayBuffer();
      const clipPath = path.join(tmpDir, `clip_${String(clip.scene_index).padStart(3, "0")}.mp4`);
      await fs.writeFile(clipPath, Buffer.from(bytes));
      clipPaths.push(clipPath);
    }

    if (clipPaths.length === 0) throw new Error("No clips could be downloaded for assembly");

    // Concatenate clips
    let concatenatedPath: string;
    const audioUrl = asset?.audio_url;
    const hasVoiceover = !!(audioUrl && audioUrl.startsWith("http"));

    if (clipPaths.length === 1) {
      concatenatedPath = clipPaths[0];
    } else {
      const listContent = clipPaths.map(p => `file '${p}'`).join("\n");
      const listPath    = path.join(tmpDir, "concat_list.txt");
      await fs.writeFile(listPath, listContent);
      concatenatedPath = path.join(tmpDir, "concatenated.mp4");
      // Preserve native AI audio unless a voiceover will replace it
      const audioFlag = hasVoiceover ? "-an" : "-c:a aac";
      await execAsync(
        `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c:v copy ${audioFlag} "${concatenatedPath}"`,
        { timeout: ASSEMBLY_TIMEOUT_MS },
      );
    }

    // Mux voiceover audio (if available) — voiceover replaces any native clip audio
    let finalPath = concatenatedPath;

    if (hasVoiceover) {
      const audioResp = await fetch(audioUrl!);
      if (audioResp.ok) {
        const audioBytes = await audioResp.arrayBuffer();
        const ext        = audioUrl!.includes(".mp3") ? "mp3" : "mp4";
        const audioPath  = path.join(tmpDir, `voiceover.${ext}`);
        await fs.writeFile(audioPath, Buffer.from(audioBytes));

        finalPath = path.join(tmpDir, "final_muxed.mp4");
        await execAsync(
          `ffmpeg -y -i "${concatenatedPath}" -i "${audioPath}" ` +
          `-c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest "${finalPath}"`,
          { timeout: ASSEMBLY_TIMEOUT_MS },
        );
      }
    }

    // Ensure storage bucket exists and is public
    await Promise.resolve(
      sb.storage.createBucket(STORAGE_BUCKET, { public: true })
    ).catch(() => {});
    await Promise.resolve(
      sb.storage.updateBucket(STORAGE_BUCKET, { public: true })
    ).catch(() => {});

    // Upload final MP4
    const finalBytes  = await fs.readFile(finalPath);
    const storagePath = `${workspaceId}/${assetId}_final.mp4`;

    const { error: uploadErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, finalBytes, { contentType: "video/mp4", upsert: true });

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    const { data: urlData } = sb.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    const finalUrl = urlData?.publicUrl;
    if (!finalUrl) throw new Error("Could not get public URL after upload");

    // Calculate actual duration (sum of completed clip durations)
    const actualDuration = (clips as any[]).reduce((s: number, c: any) => s + (c.duration_seconds || 0), 0);

    // Update asset with final URL
    await Promise.resolve(
      sb.from("growthmind_video_assets")
        .update({
          video_url:               finalUrl,
          final_video_url:         finalUrl,
          assembly_status:         "complete",
          assembly_error:          null,
          actual_duration_seconds: actualDuration,
        })
        .eq("id", assetId)
    ).catch(() => {});

    console.log(`[video-assembly] ✓ ${assetId} assembled ${clipPaths.length} clips → ${finalUrl}`);
    return { ok: true, finalUrl };

  } catch (e: any) {
    const errMsg = (e?.message ?? String(e)).slice(0, 500);
    console.error(`[video-assembly] ✗ ${assetId}:`, errMsg);

    await Promise.resolve(
      sb.from("growthmind_video_assets")
        .update({ assembly_status: "failed", assembly_error: errMsg })
        .eq("id", assetId)
    ).catch(() => {});

    return { ok: false, error: errMsg };

  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
