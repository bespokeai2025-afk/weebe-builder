-- Index for lead upload categories.
--
-- CSV/Excel imports now stamp every lead with `meta.upload_type`, so a batch
-- can be filtered as a group — in Listing Leads and when choosing a campaign
-- audience. Without an index, `meta->>'upload_type'` forces a full scan of
-- `leads` and the query that lists the available categories times out.
--
-- Expression index rather than GIN on the whole `meta` blob: the only access
-- pattern is equality on this one key, scoped to a workspace.

create index if not exists leads_workspace_upload_type_idx
  on public.leads (workspace_id, (meta->>'upload_type'))
  where meta->>'upload_type' is not null;

comment on index public.leads_workspace_upload_type_idx is
  'Lead import categories (meta.upload_type) — powers the Listing Leads filter and campaign audience selection.';
