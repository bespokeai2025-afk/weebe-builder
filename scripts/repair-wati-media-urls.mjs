/**
 * Repairs WhatsApp attachments whose media_url was stored as `function link() { [native code] }`.
 *
 * WATI sends an inbound attachment's location on `data` as a plain string — its own storage path,
 * e.g. `data/documents/<uuid>.pdf`. The webhook parser read `data` as an object, so `data?.link`
 * resolved to the legacy `String.prototype.link` method instead of undefined and the stringified
 * function was written as the media_url of every attachment ever received. The parser is fixed, but
 * the rows it already wrote carry no recoverable reference, so the real path has to be fetched back
 * from WATI and matched to the row.
 *
 * Matching key: conversation_id plus the message's creation instant, which WATI reports to the
 * millisecond and the row stores as sent_at. That pair is unique per message.
 *
 * Usage: node scripts/repair-wati-media-urls.mjs [--apply]
 * Without --apply it only reports what it would change.
 */
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const BROKEN_SENTINEL = "function link()";

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(".env"), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
  process.exit(1);
}

const MIME_BY_EXT = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", gif: "image/gif", mp4: "video/mp4", "3gp": "video/3gpp",
  mov: "video/quicktime", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", amr: "audio/amr", wav: "audio/wav",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain", zip: "application/zip",
};

function mimeFromPath(value) {
  const m = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(value ?? "");
  return m ? (MIME_BY_EXT[m[1].toLowerCase()] ?? null) : null;
}

async function rest(pathAndQuery, init) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** WATI's transcription of a voice note, which it stores in place of the media path. */
function readTranscript(raw) {
  if (!raw.startsWith("[")) return null;
  try {
    const segments = JSON.parse(raw);
    if (!Array.isArray(segments)) return null;
    const text = segments
      .map((seg) => String(seg?.Text ?? seg?.text ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

/** WATI reports `created` to the millisecond; Postgres keeps microseconds. Compare at ms. */
function msKey(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : String(t);
}

const broken = await rest(
  "whatsapp_messages?select=id,workspace_id,contact_phone,conversation_id,sent_at,body,media_url" +
    `&media_url=like.${encodeURIComponent("function link()*")}&order=sent_at.desc`,
);

if (broken.length === 0) {
  console.log("No rows with a broken media_url. Nothing to repair.");
  process.exit(0);
}
console.log(`${broken.length} attachment row(s) with a broken media_url.`);

const connections = new Map();
async function connectionFor(workspaceId) {
  if (connections.has(workspaceId)) return connections.get(workspaceId);
  const [conn] = await rest(
    `wati_connections?select=api_key,tenant_id,api_host&workspace_id=eq.${workspaceId}&status=eq.connected`,
  );
  connections.set(workspaceId, conn ?? null);
  return conn ?? null;
}

/** Every message WATI holds for one contact, keyed by creation instant. */
const threadCache = new Map();
async function watiThread(conn, phone) {
  const cacheKey = `${conn.tenant_id}:${phone}`;
  if (threadCache.has(cacheKey)) return threadCache.get(cacheKey);

  const host = String(conn.api_host || "live-mt-server.wati.io")
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  const bearer = String(conn.api_key).replace(/^Bearer\s+/i, "");
  const byInstant = new Map();

  for (let page = 1; page <= 20; page += 1) {
    const res = await fetch(
      `https://${host}/${conn.tenant_id}/api/v1/getMessages/${encodeURIComponent(phone)}?pageSize=100&pageNumber=${page}`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (!res.ok) {
      console.warn(`  ! WATI getMessages ${phone} page ${page} -> ${res.status}`);
      break;
    }
    const json = await res.json();
    const items = json?.messages?.items ?? json?.result?.messages?.items ?? [];
    for (const item of items) {
      const key = msKey(item.created);
      if (key && !byInstant.has(key)) byInstant.set(key, item);
    }
    if (items.length < 100) break;
  }

  threadCache.set(cacheKey, byInstant);
  return byInstant;
}

let repaired = 0;
let unresolved = 0;

for (const row of broken) {
  const conn = await connectionFor(row.workspace_id);
  if (!conn) {
    console.warn(`- ${row.id}: no connected WATI account for workspace ${row.workspace_id}`);
    unresolved += 1;
    continue;
  }

  const thread = await watiThread(conn, row.contact_phone);
  const key = msKey(row.sent_at);
  const item = key ? thread.get(key) : null;

  if (!item) {
    console.warn(`- ${row.id}: no WATI message at ${row.sent_at} for ${row.contact_phone}`);
    unresolved += 1;
    continue;
  }
  if (row.conversation_id && item.conversationId && row.conversation_id !== item.conversationId) {
    console.warn(`- ${row.id}: conversation mismatch, skipping`);
    unresolved += 1;
    continue;
  }

  const type = String(item.type ?? "").toLowerCase();
  // `data` is overloaded: once WATI transcribes a voice note it replaces the
  // storage path with a JSON array of transcript segments, and the path is then
  // gone from WATI's own record too. Require the shape of a path.
  const raw = typeof item.data === "string" ? item.data.trim() : "";
  const mediaPath = /^[\w.-]+(?:\/[\w.-]+)+\.[a-z0-9]{2,5}$/i.test(raw) ? raw : null;
  if (!mediaPath) {
    // The audio itself is unrecoverable, but the transcription WATI put in its
    // place is the content of the message. Keep that and drop the dead
    // reference, so the inbox stops offering a download that cannot work.
    const transcript = readTranscript(raw);
    console.warn(
      `- ${row.id}: WATI no longer holds a media path for this ${type || "message"}` +
        (transcript ? " — keeping its transcription instead" : ""),
    );
    if (APPLY) {
      await rest(`whatsapp_messages?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          media_url: null,
          media_mime_type: null,
          media_filename: null,
          ...(transcript ? { body: `Voice note: ${transcript}` } : {}),
        }),
      });
    }
    unresolved += 1;
    continue;
  }

  const filename = type === "document" ? (item.text ?? null) : null;
  const patch = {
    media_url: mediaPath,
    media_filename: filename,
    media_mime_type:
      mimeFromPath(filename) ??
      mimeFromPath(mediaPath) ??
      (type === "voice" || type === "audio" ? "audio/ogg" : null),
  };

  console.log(
    `${APPLY ? "fix " : "would fix"} ${row.id} (${type}) -> ${patch.media_url}` +
      `${patch.media_filename ? ` as "${patch.media_filename}"` : ""} [${patch.media_mime_type ?? "unknown type"}]`,
  );

  if (APPLY) {
    await rest(`whatsapp_messages?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
  }
  repaired += 1;
}

console.log(
  `\n${APPLY ? "Repaired" : "Repairable"}: ${repaired} · unrecoverable: ${unresolved}` +
    (APPLY ? "" : "\nRe-run with --apply to write the changes."),
);
