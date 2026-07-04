-- ─────────────────────────────────────────────────────────────────────────────
-- GrowthMind RLS policy correction.
-- The CMO + SEO/Email root migrations shipped a policy that gates rows on
-- current_setting('app.workspace_id') — a GUC the app never sets. All user-facing
-- GrowthMind server fns run under the `authenticated` role (context.supabase is
-- built with the publishable/anon key + user JWT via requireSupabaseAuth), so that
-- policy fails closed: SELECTs return nothing and INSERT/UPDATE/DELETE raise
-- "new row violates row-level security policy".
--
-- This replaces those policies with the repo's established multi-tenant pattern
-- (workspace_members / auth.uid()), matching growthmind_seo_sites,
-- growthmind_content_generations, growthmind_strategy_centre, etc.
--
-- Idempotent: DROP POLICY IF EXISTS then CREATE. Service-role code paths
-- (cmo-analysis-tick, executive-bridge.server) bypass RLS and are unaffected.
-- ─────────────────────────────────────────────────────────────────────────────

-- growthmind_service_scores
DROP POLICY IF EXISTS "growthmind_service_scores_workspace_isolation" ON growthmind_service_scores;
DROP POLICY IF EXISTS "growthmind_service_scores_workspace_members" ON growthmind_service_scores;
CREATE POLICY "growthmind_service_scores_workspace_members" ON growthmind_service_scores
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_trend_signals
DROP POLICY IF EXISTS "growthmind_trend_signals_workspace_isolation" ON growthmind_trend_signals;
DROP POLICY IF EXISTS "growthmind_trend_signals_workspace_members" ON growthmind_trend_signals;
CREATE POLICY "growthmind_trend_signals_workspace_members" ON growthmind_trend_signals
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_campaign_proposals
DROP POLICY IF EXISTS "growthmind_campaign_proposals_workspace_isolation" ON growthmind_campaign_proposals;
DROP POLICY IF EXISTS "growthmind_campaign_proposals_workspace_members" ON growthmind_campaign_proposals;
CREATE POLICY "growthmind_campaign_proposals_workspace_members" ON growthmind_campaign_proposals
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_video_proposals
DROP POLICY IF EXISTS "growthmind_video_proposals_workspace_isolation" ON growthmind_video_proposals;
DROP POLICY IF EXISTS "growthmind_video_proposals_workspace_members" ON growthmind_video_proposals;
CREATE POLICY "growthmind_video_proposals_workspace_members" ON growthmind_video_proposals
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_seo_briefs
DROP POLICY IF EXISTS "growthmind_seo_briefs_workspace_isolation" ON growthmind_seo_briefs;
DROP POLICY IF EXISTS "growthmind_seo_briefs_workspace_members" ON growthmind_seo_briefs;
CREATE POLICY "growthmind_seo_briefs_workspace_members" ON growthmind_seo_briefs
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_email_campaigns
DROP POLICY IF EXISTS "growthmind_email_campaigns_workspace_isolation" ON growthmind_email_campaigns;
DROP POLICY IF EXISTS "growthmind_email_campaigns_workspace_members" ON growthmind_email_campaigns;
CREATE POLICY "growthmind_email_campaigns_workspace_members" ON growthmind_email_campaigns
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- growthmind_domain_warmups
DROP POLICY IF EXISTS "growthmind_domain_warmups_workspace_isolation" ON growthmind_domain_warmups;
DROP POLICY IF EXISTS "growthmind_domain_warmups_workspace_members" ON growthmind_domain_warmups;
CREATE POLICY "growthmind_domain_warmups_workspace_members" ON growthmind_domain_warmups
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- End of RLS correction
-- ─────────────────────────────────────────────────────────────────────────────
