-- Atomic activation for approved SystemMind AccountsMind config drafts.
-- Wraps the whole field/stat/widget versioned-insert chain in ONE transaction
-- so a midway failure leaves the previous dashboard completely untouched
-- (task: prevent half-applied dashboards). Mirrors versionedInsert's
-- archive+version chain exactly: ONLY same-key live rows are archived —
-- unrelated live config is never touched (unlike the industry-preset RPC,
-- which replaces the whole dashboard).
-- SECURITY DEFINER + service_role-only: called exclusively by server code
-- (supabaseAdmin) which owns all validation / sanitisation / approval gates;
-- per-item client_visible and risk_level are computed server-side and passed in.

CREATE OR REPLACE FUNCTION public.activate_accountsmind_config_draft(
  p_workspace_id    UUID,
  p_created_by      UUID,
  p_source_draft_id UUID,
  p_fields          JSONB,  -- array of {field_key,label,field_type,entity_type,appears_in,required,options,client_visible,risk_level}
  p_stats           JSONB,  -- array of {stat_key,label,metric_key,format,description,client_visible,risk_level}
  p_widgets         JSONB   -- array of {widget_key,title,widget_type,metric_key,format,description,client_visible,risk_level}
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
  v_fields_created  INTEGER := 0;
  v_stats_created   INTEGER := 0;
  v_widgets_created INTEGER := 0;
  v_options         JSONB;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id missing';
  END IF;
  IF COALESCE(jsonb_array_length(p_fields), 0)
     + COALESCE(jsonb_array_length(p_stats), 0)
     + COALESCE(jsonb_array_length(p_widgets), 0) = 0 THEN
    RAISE EXCEPTION 'empty config';
  END IF;

  -- Fields: archive same-key live row (chaining version), insert new active row.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_fields, '[]'::jsonb)) LOOP
    SELECT id, version INTO v_existing_id, v_existing_ver
      FROM public.accountsmind_field_defs
     WHERE workspace_id = p_workspace_id
       AND field_key = v_item->>'field_key'
       AND status IN ('active','paused','hidden')
       AND is_deleted = FALSE
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.accountsmind_field_defs
         SET status = 'archived', updated_at = NOW()
       WHERE id = v_existing_id AND workspace_id = p_workspace_id;
    END IF;

    v_options := COALESCE(v_item->'options', '[]'::jsonb);

    INSERT INTO public.accountsmind_field_defs
      (workspace_id, created_by_user_id, created_by_system, source_draft_id,
       field_key, label, field_type, entity_type, appears_in, required, options,
       client_visible, risk_level, display_order,
       status, version, previous_version_id)
    VALUES
      (p_workspace_id, p_created_by, 'systemmind', p_source_draft_id,
       v_item->>'field_key', v_item->>'label', v_item->>'field_type',
       COALESCE(v_item->>'entity_type', 'client'),
       COALESCE(v_item->>'appears_in', 'client_section'),
       COALESCE((v_item->>'required')::boolean, FALSE),
       v_options,
       COALESCE((v_item->>'client_visible')::boolean, FALSE),
       COALESCE(v_item->>'risk_level', 'low'),
       v_order,
       'active',
       CASE WHEN v_existing_id IS NULL THEN 1 ELSE COALESCE(v_existing_ver, 1) + 1 END,
       v_existing_id);

    v_order := v_order + 1;
    v_fields_created := v_fields_created + 1;
    v_existing_id := NULL; v_existing_ver := NULL;
  END LOOP;

  -- Stats: same chain.
  v_order := 0;
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
      (p_workspace_id, p_created_by, 'systemmind', p_source_draft_id,
       v_item->>'stat_key', v_item->>'label', v_item->>'metric_key',
       COALESCE(v_item->>'format', 'number'), v_item->>'description',
       COALESCE((v_item->>'client_visible')::boolean, FALSE),
       COALESCE(v_item->>'risk_level', 'low'),
       v_order,
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
      (p_workspace_id, p_created_by, 'systemmind', p_source_draft_id,
       v_item->>'widget_key', v_item->>'title',
       COALESCE(v_item->>'widget_type', 'stat_card'), v_item->>'metric_key',
       COALESCE(v_item->>'format', 'number'), v_item->>'description',
       COALESCE((v_item->>'client_visible')::boolean, FALSE),
       COALESCE(v_item->>'risk_level', 'low'),
       v_order,
       'active',
       CASE WHEN v_existing_id IS NULL THEN 1 ELSE COALESCE(v_existing_ver, 1) + 1 END,
       v_existing_id);

    v_order := v_order + 1;
    v_widgets_created := v_widgets_created + 1;
    v_existing_id := NULL; v_existing_ver := NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'fields_created',  v_fields_created,
    'stats_created',   v_stats_created,
    'widgets_created', v_widgets_created
  );
END;
$$;

-- service_role only — never callable by clients.
REVOKE ALL ON FUNCTION public.activate_accountsmind_config_draft(UUID, UUID, UUID, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_accountsmind_config_draft(UUID, UUID, UUID, JSONB, JSONB, JSONB) TO service_role;
