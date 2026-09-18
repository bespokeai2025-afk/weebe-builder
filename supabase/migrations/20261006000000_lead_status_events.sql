-- Lead status transition history — additive, idempotent.
-- Mirrors the existing lead_assignment_audit convention (20260923000000_sales_agents_lead_assignment.sql):
-- append-only, service-role-write-only, workspace-member-read-only, kept forever
-- (not added to log-retention.server.ts's pruning sweep — see design rationale
-- in the Phase 2B.1/2B.1.1 design review).
--
-- Scope: tracks public.leads.status transitions only. Does NOT track
-- qualification_status (separate field, separate mutation path, out of
-- scope) or sentiment (WBAH's own "Qualified" definition — a documented,
-- known limitation: this table does not support historical WBAH
-- qualification analytics).
--
-- Semantics: a row with previous_status IS NULL is an INITIAL OBSERVATION
-- (the lead's status as of creation), not a transition. Historical
-- "transitioned into X" queries MUST filter `previous_status IS NOT NULL`;
-- point-in-time snapshot/distribution queries should include it.
--
-- No backfill: history begins from the moment these triggers are deployed.
-- Nothing here reconstructs or fabricates status changes that happened
-- before deployment.

CREATE TABLE IF NOT EXISTS public.lead_status_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL, -- no FK: leads are hard-deletable, history must survive deletion
  previous_status public.lead_status, -- NULL = initial observation at lead creation, not a transition
  new_status      public.lead_status NOT NULL,
  event_at        timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_status_events_ws_lead
  ON public.lead_status_events (workspace_id, lead_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_status_events_ws_status_event
  ON public.lead_status_events (workspace_id, new_status, event_at);

ALTER TABLE public.lead_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_status_events_members_read" ON public.lead_status_events;
CREATE POLICY "lead_status_events_members_read"
  ON public.lead_status_events FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM public.workspace_members wm
      WHERE wm.user_id = auth.uid()
    )
  );

-- Default grants give authenticated ALL — strip writes explicitly, matching
-- lead_assignment_audit's exact convention.
REVOKE INSERT, UPDATE, DELETE ON public.lead_status_events FROM authenticated;
REVOKE ALL ON public.lead_status_events FROM anon;

-- SECURITY DEFINER is required here (unlike tg_set_updated_at, which only
-- touches the row already being written): this function inserts into a
-- DIFFERENT table whose RLS explicitly revokes INSERT from `authenticated`,
-- the role most status-changing call sites run as (requireSupabaseAuth's
-- RLS-scoped client, not the service-role client). Without SECURITY
-- DEFINER, every status update in the app would start failing the moment
-- this ships. search_path is pinned for the same reason any SECURITY
-- DEFINER function must pin it — prevents search_path hijacking.
CREATE OR REPLACE FUNCTION public.tg_log_lead_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.lead_status_events (workspace_id, lead_id, previous_status, new_status)
  VALUES (NEW.workspace_id, NEW.id, OLD.status, NEW.status);
  RETURN NEW;
END;
$$ SET search_path = public;

DROP TRIGGER IF EXISTS trg_lead_status_change ON public.leads;
CREATE TRIGGER trg_lead_status_change
  AFTER UPDATE ON public.leads
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_log_lead_status_change();

-- Initial-state capture: some WBAH leads are inserted with an explicit
-- non-default status (buildLeadRow in wbah-leads-sync-tick.ts), so the
-- column default alone is not a reliable record of a lead's starting state.
CREATE OR REPLACE FUNCTION public.tg_log_lead_status_initial()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.lead_status_events (workspace_id, lead_id, previous_status, new_status, event_at)
  VALUES (NEW.workspace_id, NEW.id, NULL, NEW.status, NEW.created_at);
  RETURN NEW;
END;
$$ SET search_path = public;

DROP TRIGGER IF EXISTS trg_lead_status_initial ON public.leads;
CREATE TRIGGER trg_lead_status_initial
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_log_lead_status_initial();

-- leads(workspace_id, created_at) index — required independently for future
-- volume-over-time analytics (leads/calls/bookings trends); confirmed
-- missing from the live schema during Phase 2B.0/2B.1 research.
CREATE INDEX IF NOT EXISTS idx_leads_ws_created_at
  ON public.leads (workspace_id, created_at);
