import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "contact-documents";

async function ensureBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = (buckets ?? []).some((b: any) => b.name === BUCKET);
  if (!exists) {
    await supabaseAdmin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 52_428_800,
    });
  }
}

// ── Authenticated functions ───────────────────────────────────────────────────

/** List all documents for a contact by their data_records.id */
export const listContactDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ contactId: z.string() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const { data: docs, error } = await sb
      .from("contact_documents")
      .select("*")
      .eq("contact_id", data.contactId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return docs ?? [];
  });

/** Look up a contact by phone (mobile_number in data_records) and return their docs + token */
export const listContactDocsByPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ phone: z.string() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) return { docs: [], contactId: null, uploadToken: null };
    const sb = supabaseAdmin as any;

    // Normalise phone for matching (strip spaces/dashes, keep +)
    const phone = data.phone.replace(/[\s\-().]/g, "");

    const { data: contact } = await sb
      .from("data_records")
      .select("id, upload_token, name")
      .eq("workspace_id", workspaceId)
      .eq("is_deleted", false)
      .or(`mobile_number.eq.${phone},mobile_number.eq.${data.phone}`)
      .maybeSingle();

    if (!contact) return { docs: [], contactId: null, uploadToken: null };

    const { data: docs } = await sb
      .from("contact_documents")
      .select("*")
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false });

    return {
      docs: docs ?? [],
      contactId: contact.id as string,
      uploadToken: contact.upload_token as string,
    };
  });

/** Delete a document and remove it from storage */
export const deleteContactDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string(), storagePath: z.string() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    await supabaseAdmin.storage.from(BUCKET).remove([data.storagePath]);
    const { error } = await sb
      .from("contact_documents")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Get the upload token for a contact by their data_records.id */
export const getContactUploadToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ contactId: z.string() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const { data: contact, error } = await sb
      .from("data_records")
      .select("upload_token, name, mobile_number")
      .eq("id", data.contactId)
      .eq("workspace_id", workspaceId)
      .single();
    if (error || !contact) throw new Error("Contact not found");
    return {
      uploadToken: contact.upload_token as string,
      name: contact.name as string | null,
      phone: contact.mobile_number as string,
    };
  });

// ── Anon functions — no auth middleware; upload_token is the security ─────────

/** Create a signed upload URL for a client using their upload token */
export const getSignedUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      token:    z.string().uuid(),
      fileName: z.string().min(1),
      mimeType: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    await ensureBucket();
    const sb = supabaseAdmin as any;
    const { data: contact, error } = await sb
      .from("data_records")
      .select("id, workspace_id, name")
      .eq("upload_token", data.token)
      .single();
    if (error || !contact) throw new Error("Invalid or expired upload link.");

    const safeFile = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${contact.workspace_id}/${contact.id}/${Date.now()}_${safeFile}`;

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);
    if (signErr || !signed) throw new Error("Could not create upload URL.");

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);

    return {
      signedUrl:   signed.signedUrl,
      storagePath,
      publicUrl:   pub.publicUrl,
      contactName: contact.name as string | null,
    };
  });

/** Record a completed upload in the database */
export const recordDocumentUpload = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      uploadToken: z.string().uuid(),
      fileName:    z.string().min(1),
      fileSize:    z.number().optional(),
      mimeType:    z.string().optional(),
      storagePath: z.string().min(1),
      publicUrl:   z.string().min(1),
      uploadedBy:  z.enum(["client", "admin"]).default("client"),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { data: contact, error } = await sb
      .from("data_records")
      .select("id, workspace_id")
      .eq("upload_token", data.uploadToken)
      .single();
    if (error || !contact) throw new Error("Invalid upload token.");

    const { error: insErr } = await sb.from("contact_documents").insert({
      workspace_id: contact.workspace_id,
      contact_id:   contact.id,
      file_name:    data.fileName,
      file_size:    data.fileSize ?? null,
      mime_type:    data.mimeType ?? null,
      storage_path: data.storagePath,
      public_url:   data.publicUrl,
      uploaded_by:  data.uploadedBy,
    });
    if (insErr) throw new Error(insErr.message);
    return { ok: true };
  });
