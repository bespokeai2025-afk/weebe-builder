-- Atomic industry-preset apply for AccountsMind dashboards.
-- Wraps archive + versioned insert of stat/widget rows in ONE transaction so a
-- midway failure leaves the previous dashboard untouched (task: prevent
-- half-applied dashboards). Mirrors versionedInsertConfigRow's archive+version
-- chain exactly. SECURITY DEFINER + service_role-only: called exclusively by
-- server code (supabaseAdmin) which owns all validation/permission gates.

CREATE OR REPLACE FUNCTION public.apply_accountsmind_industry_preset(
  p_workspace_id UUID,
  p_created_by   UUID,
  p_stats        JSONB,   -- array of {stat_key,label,metric_key,format,description}
  p_widgets      JSONB    -- array of {widget_key,title,widget_type,metric_key,format,description}
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item            JSONB;
  v_existing_id     UUID;
  v_existing_ver    INTEGER;
  v_order           INTEGER := 0;
  v_stats_created   INTEGER := 0;
  v_widgets_created INTEGER := 0;
  v_stat_keys       TEXT[];
  v_widget_keys     TEXT[];
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id missing';
  END IF;
  IF COALESCE(jsonb_array_length(p_stats), 0) + COALESCE(jsonb_array_length(p_widgets), 0) = 0 THEN
    RAISE EXCEPTION 'empty preset';
  END IF;

  SELECT COALESCE(array_agg(x->>'stat_key'), '{}')   INTO v_stat_keys   FROM jsonb_array_elements(COALESCE(p_stats, '[]'::jsonb)) x;
  SELECT COALESCE(array_agg(x->>'widget_key'), '{}') INTO v_widget_keys FROM jsonb_array_elements(COALESCE(p_widgets, '[]'::jsonb)) x;

  -- Archive live rows whose keys are NOT part of the preset (matching keys are
  -- archived + re-versioned per-row below).
  UPDATE public.accountsmind_stat_defs
     SET status = 'archived', updated_at = NOW()
   WHERE workspace_id = p_workspace_id
     AND status IN ('active','paused','hidden')
     AND is_deleted = FALSE
     AND NOT (stat_key = ANY (v_stat_keys));

  UPDATE public.accountsmind_widget_defs
     SET status = 'archived', updated_at = NOW()
   WHERE workspace_id = p_workspace_id
     AND status IN ('active','paused','hidden')
     AND is_deleted = FALSE
     AND NOT (widget_key = ANY (v_widget_keys));

  -- Stats: archive same-key live row (chaining version), insert new active row.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_stats, '[]'::jsonb)) LOOP
    SELECT id, version INTO v_existing_id, v_existing_ver
      FROM public.accountsmind_stat_defs
     WHERE workspace_id = p_workspace_id
       AND stat_key = v_item->>'stat_key'
       AND status IN ('active','paused','hidden')
       AND is_deleted = FALSE
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.accountsmind_stat_defs
         SET status = 'archived', updated_at = NOW()
       WHERE id = v_existing_id AND workspace_id = p_workspace_id;
    END IF;

    INSERT INTO public.accountsmind_stat_defs
      (workspace_id, created_by_user_id, created_by_system, source_draft_id,
       stat_key, label, metric_key, format, description,
       client_visible, risk_level, display_order,
       status, version, previous_version_id)
    VALUES
      (p_workspace_id, p_created_by, 'industry_preset', NULL,
       v_item->>'stat_key', v_item->>'label', v_item->>'metric_key',
       COALESCE(v_item->>'format', 'number'), v_item->>'description',
       TRUE, 'low', v_order,
       'active',
       CASE WHEN v_existing_id IS NULL THEN 1 ELSE COALESCE(v_existing_ver, 1) + 1 END,
       v_existing_id);

    v_order := v_order + 1;
    v_stats_created := v_stats_created + 1;
    v_existing_id := NULL; v_existing_ver := NULL;
  END LOOP;

  -- Widgets: same chain.
  v_order := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_widgets, '[]'::jsonb)) LOOP
    SELECT id, version INTO v_existing_id, v_existing_ver
      FROM public.accountsmind_widget_defs
     WHERE workspace_id = p_workspace_id
       AND widget_key = v_item->>'widget_key'
       AND status IN ('active','paused','hidden')
       AND is_deleted = FALSE
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.accountsmind_widget_defs
         SET status = 'archived', updated_at = NOW()
       WHERE id = v_existing_id AND workspace_id = p_workspace_id;
    END IF;

    INSERT INTO public.accountsmind_widget_defs
      (workspace_id, created_by_user_id, created_by_system, source_draft_id,
       widget_key, title, widget_type, metric_key, format, description,
       client_visible, risk_level, display_order,
       status, version, previous_version_id)
    VALUES
      (p_workspace_id, p_created_by, 'industry_preset', NULL,
       v_item->>'widget_key', v_item->>'title',
       COALESCE(v_item->>'widget_type', 'stat_card'), v_item->>'metric_key',
       COALESCE(v_item->>'format', 'number'), v_item->>'description',
       TRUE, 'low', v_order,
       'active',
       CASE WHEN v_existing_id IS NULL THEN 1 ELSE COALESCE(v_existing_ver, 1) + 1 END,
       v_existing_id);

    v_order := v_order + 1;
    v_widgets_created := v_widgets_created + 1;
    v_existing_id := NULL; v_existing_ver := NULL;
  END LOOP;

  RETURN jsonb_build_object('stats_created', v_stats_created, 'widgets_created', v_widgets_created);
END;
$$;

-- service_role only — never callable by clients.
REVOKE ALL ON FUNCTION public.apply_accountsmind_industry_preset(UUID, UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_accountsmind_industry_preset(UUID, UUID, JSONB, JSONB) TO service_role;
