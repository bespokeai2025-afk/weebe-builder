-- Contact Documents: per-contact upload space + document storage

-- 1. Upload token on contacts (each contact gets a unique shareable upload link)
ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS upload_token UUID DEFAULT gen_random_uuid() NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wa_contacts_upload_token_idx
  ON public.whatsapp_contacts(upload_token);

-- Backfill any rows where the default didn't fire (shouldn't happen but safe)
UPDATE public.whatsapp_contacts
  SET upload_token = gen_random_uuid()
  WHERE upload_token IS NULL;

-- 2. Documents table
CREATE TABLE IF NOT EXISTS public.contact_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  file_size    BIGINT,
  mime_type    TEXT,
  storage_path TEXT NOT NULL,
  public_url   TEXT NOT NULL,
  uploaded_by  TEXT DEFAULT 'client',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contact_docs_contact_idx ON public.contact_documents(contact_id);
CREATE INDEX IF NOT EXISTS contact_docs_ws_idx      ON public.contact_documents(workspace_id);

ALTER TABLE public.contact_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_docs_sel" ON public.contact_documents
  FOR SELECT USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "contact_docs_ins" ON public.contact_documents
  FOR INSERT WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "contact_docs_del" ON public.contact_documents
  FOR DELETE USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

GRANT SELECT, INSERT, DELETE ON public.contact_documents TO authenticated;
GRANT ALL ON public.contact_documents TO service_role;
