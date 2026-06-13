/**
 * Core document-check logic for voice AI tool calls.
 *
 * Looks up a contact by phone number and returns their document status in a
 * shape that both Retell and HyperStream tool endpoints can return verbatim
 * to the AI model.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function normalizePhone(p: string) {
  return p.replace(/[\s\-().]/g, "");
}

export interface DocumentCheckResult {
  documents_found: boolean;
  total_count: number;
  client_count: number;
  admin_count: number;
  documents: { name: string; uploaded_by: string; uploaded_at: string }[];
  upload_url: string | null;
  /** Ready-to-speak sentence the AI can read aloud. */
  summary: string;
}

/**
 * Look up documents for a contact by phone number within a workspace.
 * Always resolves — never rejects.
 */
export async function checkDocumentsByPhone(
  phone: string,
  workspaceId: string,
): Promise<DocumentCheckResult> {
  const sb = supabaseAdmin as any;
  const normalized = normalizePhone(phone);

  const { data: contact } = await sb
    .from("data_records")
    .select("id, name, upload_token")
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .or(`mobile_number.eq.${normalized},mobile_number.eq.${phone}`)
    .maybeSingle();

  const PUBLIC_BASE_URL =
    process.env.PUBLIC_BASE_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");

  if (!contact) {
    return {
      documents_found: false,
      total_count: 0,
      client_count: 0,
      admin_count: 0,
      documents: [],
      upload_url: null,
      summary:
        "I couldn't find a contact record for this number, so I'm unable to check for documents.",
    };
  }

  const { data: docs } = await sb
    .from("contact_documents")
    .select("id, file_name, mime_type, uploaded_by, created_at")
    .eq("contact_id", contact.id)
    .order("created_at", { ascending: false });

  const allDocs = (docs ?? []) as Array<{
    id: string;
    file_name: string;
    mime_type: string | null;
    uploaded_by: string;
    created_at: string;
  }>;

  const clientDocs = allDocs.filter((d) => d.uploaded_by === "client");
  const adminDocs = allDocs.filter((d) => d.uploaded_by === "admin");
  const uploadUrl = contact.upload_token
    ? `${PUBLIC_BASE_URL}/upload/${contact.upload_token}`
    : null;

  let summary: string;
  if (allDocs.length === 0) {
    summary = uploadUrl
      ? `No documents have been uploaded yet. I can send you a secure upload link if you'd like to send them now.`
      : `No documents have been uploaded yet for this contact.`;
  } else if (clientDocs.length > 0 && adminDocs.length > 0) {
    summary = `We have ${allDocs.length} document${allDocs.length !== 1 ? "s" : ""} on file — ${clientDocs.length} uploaded by you and ${adminDocs.length} added by our team. Everything looks good.`;
  } else if (clientDocs.length > 0) {
    const names = clientDocs.slice(0, 3).map((d) => d.file_name).join(", ");
    summary = `Yes, we have received your ${clientDocs.length} document${clientDocs.length !== 1 ? "s" : ""}: ${names}. Thank you for sending those.`;
  } else {
    summary = `We have ${adminDocs.length} document${adminDocs.length !== 1 ? "s" : ""} on file from our team, but we haven't received any uploads from you yet.${uploadUrl ? " I can send you a secure link to upload them." : ""}`;
  }

  return {
    documents_found: allDocs.length > 0,
    total_count: allDocs.length,
    client_count: clientDocs.length,
    admin_count: adminDocs.length,
    documents: allDocs.map((d) => ({
      name: d.file_name,
      uploaded_by: d.uploaded_by,
      uploaded_at: d.created_at,
    })),
    upload_url: uploadUrl,
    summary,
  };
}

/**
 * Given a Retell `call` object, derive the contact's phone number.
 * Prefers an explicit `phone` arg; falls back to from/to based on direction.
 */
export function extractPhoneFromRetellCall(
  explicitPhone: string | undefined,
  call: Record<string, unknown>,
): string | null {
  if (explicitPhone?.trim()) return explicitPhone.trim();
  const direction = call.call_type as string | undefined;
  if (direction === "inbound") {
    return (call.from_number as string | null) ?? null;
  }
  return (call.to_number as string | null) ?? null;
}
