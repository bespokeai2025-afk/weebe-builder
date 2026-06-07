-- Client Qualification module: qualification fields on leads table

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS qualification_status   TEXT,
  ADD COLUMN IF NOT EXISTS qualification_score    INTEGER,
  ADD COLUMN IF NOT EXISTS budget_confirmed       BOOLEAN,
  ADD COLUMN IF NOT EXISTS decision_maker         BOOLEAN,
  ADD COLUMN IF NOT EXISTS urgency                TEXT,
  ADD COLUMN IF NOT EXISTS interest_level         TEXT,
  ADD COLUMN IF NOT EXISTS next_step              TEXT;

CREATE INDEX IF NOT EXISTS leads_qualification_status_idx ON public.leads(workspace_id, qualification_status);
