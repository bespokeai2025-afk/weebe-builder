-- Deduplicate whatsapp_contacts: keep the earliest row per (workspace_id, phone),
-- delete the rest, then ensure the unique constraint is in place.

DELETE FROM public.whatsapp_contacts
WHERE id NOT IN (
  SELECT DISTINCT ON (workspace_id, phone) id
  FROM public.whatsapp_contacts
  ORDER BY workspace_id, phone, created_at ASC
);

-- Ensure the unique constraint exists (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_contacts_workspace_id_phone_key'
      AND conrelid = 'public.whatsapp_contacts'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_contacts
      ADD CONSTRAINT whatsapp_contacts_workspace_id_phone_key
      UNIQUE (workspace_id, phone);
  END IF;
END $$;
