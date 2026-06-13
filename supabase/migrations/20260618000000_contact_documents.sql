-- ── Contact Documents ────────────────────────────────────────────────────────
-- Documents anchor to data_records (the main CRM contacts table).
-- Each contact gets a unique upload_token so clients can upload via a portal.

-- 1. Add upload_token to data_records
ALTER TABLE public.data_records
  ADD COLUMN IF NOT EXISTS upload_token UUID DEFAULT gen_random_uuid() NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS data_records_upload_token_idx
  ON public.data_records(upload_token);

UPDATE public.data_records SET upload_token = gen_random_uuid() WHERE upload_token IS NULL;

-- 2. contact_documents table — references data_records, not whatsapp_contacts
CREATE TABLE IF NOT EXISTS public.contact_documents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id    UUID        NOT NULL REFERENCES public.data_records(id) ON DELETE CASCADE,
  file_name     TEXT        NOT NULL,
  file_size     BIGINT,
  mime_type     TEXT,
  storage_path  TEXT        NOT NULL,
  public_url    TEXT        NOT NULL,
  uploaded_by   TEXT        NOT NULL DEFAULT 'client',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contact_docs_contact_idx ON public.contact_documents(contact_id);
CREATE INDEX IF NOT EXISTS contact_docs_ws_idx      ON public.contact_documents(workspace_id);

ALTER TABLE public.contact_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_docs_sel" ON public.contact_documents
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "contact_docs_ins" ON public.contact_documents
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "contact_docs_del" ON public.contact_documents
  FOR DELETE USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

GRANT SELECT, INSERT, DELETE ON public.contact_documents TO authenticated;
GRANT ALL ON public.contact_documents TO service_role;
