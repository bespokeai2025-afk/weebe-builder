export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accountsmind_alerts: {
        Row: {
          alert_type: string
          amount_cents: number | null
          created_at: string
          hivemind_action_id: string | null
          id: string
          message: string
          provider_category: string | null
          provider_name: string | null
          resolved_at: string | null
          severity: string
          status: string
          title: string
          workspace_id: string | null
        }
        Insert: {
          alert_type: string
          amount_cents?: number | null
          created_at?: string
          hivemind_action_id?: string | null
          id?: string
          message: string
          provider_category?: string | null
          provider_name?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title: string
          workspace_id?: string | null
        }
        Update: {
          alert_type?: string
          amount_cents?: number | null
          created_at?: string
          hivemind_action_id?: string | null
          id?: string
          message?: string
          provider_category?: string | null
          provider_name?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountsmind_alerts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      accountsmind_field_defs: {
        Row: {
          appears_in: string
          client_visible: boolean
          created_at: string
          created_by_system: string
          created_by_user_id: string | null
          default_value: Json | null
          display_order: number
          entity_type: string
          field_key: string
          field_type: string
          id: string
          is_deleted: boolean
          label: string
          options: Json
          previous_version_id: string | null
          required: boolean
          risk_level: string
          source_draft_id: string | null
          status: string
          updated_at: string
          validation: Json
          version: number
          workspace_id: string
        }
        Insert: {
          appears_in?: string
          client_visible?: boolean
          created_at?: string
          created_by_system?: string
          created_by_user_id?: string | null
          default_value?: Json | null
          display_order?: number
          entity_type?: string
          field_key: string
          field_type?: string
          id?: string
          is_deleted?: boolean
          label: string
          options?: Json
          previous_version_id?: string | null
          required?: boolean
          risk_level?: string
          source_draft_id?: string | null
          status?: string
          updated_at?: string
          validation?: Json
          version?: number
          workspace_id: string
        }
        Update: {
          appears_in?: string
          client_visible?: boolean
          created_at?: string
          created_by_system?: string
          created_by_user_id?: string | null
          default_value?: Json | null
          display_order?: number
          entity_type?: string
          field_key?: string
          field_type?: string
          id?: string
          is_deleted?: boolean
          label?: string
          options?: Json
          previous_version_id?: string | null
          required?: boolean
          risk_level?: string
          source_draft_id?: string | null
          status?: string
          updated_at?: string
          validation?: Json
          version?: number
          workspace_id?: string
        }
        Relationships: []
      }
      accountsmind_field_values: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          field_def_id: string
          id: string
          updated_at: string
          updated_by_user_id: string | null
          value: Json | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type?: string
          field_def_id: string
          id?: string
          updated_at?: string
          updated_by_user_id?: string | null
          value?: Json | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          field_def_id?: string
          id?: string
          updated_at?: string
          updated_by_user_id?: string | null
          value?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accountsmind_field_values_field_def_id_fkey"
            columns: ["field_def_id"]
            isOneToOne: false
            referencedRelation: "accountsmind_field_defs"
            referencedColumns: ["id"]
          },
        ]
      }
      accountsmind_metric_snapshots: {
        Row: {
          captured_on: string
          created_at: string
          id: string
          metric_key: string
          updated_at: string
          value: number
          workspace_id: string
        }
        Insert: {
          captured_on?: string
          created_at?: string
          id?: string
          metric_key: string
          updated_at?: string
          value: number
          workspace_id: string
        }
        Update: {
          captured_on?: string
          created_at?: string
          id?: string
          metric_key?: string
          updated_at?: string
          value?: number
          workspace_id?: string
        }
        Relationships: []
      }
      accountsmind_stat_defs: {
        Row: {
          client_visible: boolean
          created_at: string
          created_by_system: string
          created_by_user_id: string | null
          description: string | null
          display_order: number
          format: string
          id: string
          is_deleted: boolean
          label: string
          metric_key: string
          previous_version_id: string | null
          risk_level: string
          source_draft_id: string | null
          stat_key: string
          status: string
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          client_visible?: boolean
          created_at?: string
          created_by_system?: string
          created_by_user_id?: string | null
          description?: string | null
          display_order?: number
          format?: string
          id?: string
          is_deleted?: boolean
          label: string
          metric_key: string
          previous_version_id?: string | null
          risk_level?: string
          source_draft_id?: string | null
          stat_key: string
          status?: string
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          client_visible?: boolean
          created_at?: string
          created_by_system?: string
          created_by_user_id?: string | null
          description?: string | null
          display_order?: number
          format?: string
          id?: string
          is_deleted?: boolean
          label?: string
          metric_key?: string
          previous_version_id?: string | null
          risk_level?: string
          source_draft_id?: string | null
          stat_key?: string
          status?: string
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: []
      }
      accountsmind_widget_defs: {
        Row: {
          client_visible: boolean
          created_at: string
          created_by_system: string
          created_by_user_id: string | null
          description: string | null
          display_order: number
          format: string
          id: string
          is_deleted: boolean
          metric_key: string
          previous_version_id: string | null
          risk_level: string
          source_draft_id: string | null
          status: string
          title: string
          updated_at: string
          version: number
          widget_key: string
          widget_type: string
          workspace_id: string
        }
        Insert: {
          client_visible?: boolean
          created_at?: string
          created_by_system?: string
          created_by_user_id?: string | null
          description?: string | null
          display_order?: number
          format?: string
          id?: string
          is_deleted?: boolean
          metric_key: string
          previous_version_id?: string | null
          risk_level?: string
          source_draft_id?: string | null
          status?: string
          title: string
          updated_at?: string
          version?: number
          widget_key: string
          widget_type?: string
          workspace_id: string
        }
        Update: {
          client_visible?: boolean
          created_at?: string
          created_by_system?: string
          created_by_user_id?: string | null
          description?: string | null
          display_order?: number
          format?: string
          id?: string
          is_deleted?: boolean
          metric_key?: string
          previous_version_id?: string | null
          risk_level?: string
          source_draft_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          version?: number
          widget_key?: string
          widget_type?: string
          workspace_id?: string
        }
        Relationships: []
      }
      admin_change_requests: {
        Row: {
          admin_notes: string | null
          billable: boolean | null
          billing_status: string
          created_at: string | null
          estimated_effort: string | null
          id: string
          missing_capability: string | null
          quote_amount_pence: number | null
          request_type: string
          requested_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_agent_id: string | null
          source_config_id: string | null
          status: string
          technical_summary: string | null
          title: string
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          billable?: boolean | null
          billing_status?: string
          created_at?: string | null
          estimated_effort?: string | null
          id?: string
          missing_capability?: string | null
          quote_amount_pence?: number | null
          request_type?: string
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_agent_id?: string | null
          source_config_id?: string | null
          status?: string
          technical_summary?: string | null
          title: string
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          billable?: boolean | null
          billing_status?: string
          created_at?: string | null
          estimated_effort?: string | null
          id?: string
          missing_capability?: string | null
          quote_amount_pence?: number | null
          request_type?: string
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_agent_id?: string | null
          source_config_id?: string | null
          status?: string
          technical_summary?: string | null
          title?: string
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_change_requests_source_agent_id_fkey"
            columns: ["source_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_change_requests_source_config_id_fkey"
            columns: ["source_config_id"]
            isOneToOne: false
            referencedRelation: "custom_agent_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_change_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_retell_secrets: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          production_api_key: string
          production_api_key_masked: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          production_api_key: string
          production_api_key_masked: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          production_api_key?: string
          production_api_key_masked?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_retell_secrets_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_templates: {
        Row: {
          created_at: string
          description: string
          flow_data: Json
          id: string
          name: string
          owner_user_id: string | null
          scope: string
          settings: Json
          updated_at: string
          variables: Json
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string
          flow_data?: Json
          id?: string
          name?: string
          owner_user_id?: string | null
          scope: string
          settings?: Json
          updated_at?: string
          variables?: Json
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          flow_data?: Json
          id?: string
          name?: string
          owner_user_id?: string | null
          scope?: string
          settings?: Json
          updated_at?: string
          variables?: Json
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          agent_type: Database["public"]["Enums"]["agent_flow_type"]
          cost_seconds: number
          created_at: string
          deployment_mode: string
          flow_data: Json
          id: string
          inbound_phone_number: string | null
          name: string
          retell_agent_id: string | null
          retell_conversation_flow_id: string | null
          settings: Json
          updated_at: string
          user_id: string
          variables: Json
          voice_provider: string
          workspace_id: string | null
        }
        Insert: {
          agent_type?: Database["public"]["Enums"]["agent_flow_type"]
          cost_seconds?: number
          created_at?: string
          deployment_mode?: string
          flow_data?: Json
          id?: string
          inbound_phone_number?: string | null
          name?: string
          retell_agent_id?: string | null
          retell_conversation_flow_id?: string | null
          settings?: Json
          updated_at?: string
          user_id: string
          variables?: Json
          voice_provider?: string
          workspace_id?: string | null
        }
        Update: {
          agent_type?: Database["public"]["Enums"]["agent_flow_type"]
          cost_seconds?: number
          created_at?: string
          deployment_mode?: string
          flow_data?: Json
          id?: string
          inbound_phone_number?: string | null
          name?: string
          retell_agent_id?: string | null
          retell_conversation_flow_id?: string | null
          settings?: Json
          updated_at?: string
          user_id?: string
          variables?: Json
          voice_provider?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_engine_logs: {
        Row: {
          data_source_key: string
          endpoint_path: string
          error_msg: string | null
          http_method: string
          id: string
          latency_ms: number | null
          module_key: string
          page_fetched: number | null
          profile_id: string | null
          record_count: number | null
          requested_at: string
          status_code: number | null
          total_reported: number | null
          workspace_id: string
        }
        Insert: {
          data_source_key: string
          endpoint_path: string
          error_msg?: string | null
          http_method?: string
          id?: string
          latency_ms?: number | null
          module_key: string
          page_fetched?: number | null
          profile_id?: string | null
          record_count?: number | null
          requested_at?: string
          status_code?: number | null
          total_reported?: number | null
          workspace_id: string
        }
        Update: {
          data_source_key?: string
          endpoint_path?: string
          error_msg?: string | null
          http_method?: string
          id?: string
          latency_ms?: number | null
          module_key?: string
          page_fetched?: number | null
          profile_id?: string | null
          record_count?: number | null
          requested_at?: string
          status_code?: number | null
          total_reported?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_engine_logs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "workspace_api_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_engine_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_rate_limit_log: {
        Row: {
          id: string
          request_count: number
          token_id: string
          window_start: string
          workspace_id: string
        }
        Insert: {
          id?: string
          request_count?: number
          token_id: string
          window_start?: string
          workspace_id: string
        }
        Update: {
          id?: string
          request_count?: number
          token_id?: string
          window_start?: string
          workspace_id?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      ava_call_requests: {
        Row: {
          call_outcome: Json | null
          created_at: string
          email: string
          from_number: string | null
          full_name: string | null
          id: string
          ip_address: string | null
          lead_id: string | null
          otp_attempts: number
          otp_expires_at: string | null
          otp_hash: string | null
          phone: string
          processed_at: string | null
          retell_call_id: string | null
          status: string
          updated_at: string
          user_agent: string | null
          website: string | null
          workspace_id: string
        }
        Insert: {
          call_outcome?: Json | null
          created_at?: string
          email: string
          from_number?: string | null
          full_name?: string | null
          id?: string
          ip_address?: string | null
          lead_id?: string | null
          otp_attempts?: number
          otp_expires_at?: string | null
          otp_hash?: string | null
          phone: string
          processed_at?: string | null
          retell_call_id?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
          website?: string | null
          workspace_id: string
        }
        Update: {
          call_outcome?: Json | null
          created_at?: string
          email?: string
          from_number?: string | null
          full_name?: string | null
          id?: string
          ip_address?: string | null
          lead_id?: string | null
          otp_attempts?: number
          otp_expires_at?: string | null
          otp_hash?: string | null
          phone?: string
          processed_at?: string | null
          retell_call_id?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
          website?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      booking_summaries: {
        Row: {
          agent_id: string | null
          appointment_booked: boolean | null
          appointment_date: string | null
          appointment_reason: string | null
          booking_id: string | null
          calcom_booking_uid: string | null
          call_id: string
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          id: string
          raw: Json
          retell_agent_id: string | null
          summary: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          agent_id?: string | null
          appointment_booked?: boolean | null
          appointment_date?: string | null
          appointment_reason?: string | null
          booking_id?: string | null
          calcom_booking_uid?: string | null
          call_id: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          raw?: Json
          retell_agent_id?: string | null
          summary?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string | null
          appointment_booked?: boolean | null
          appointment_date?: string | null
          appointment_reason?: string | null
          booking_id?: string | null
          calcom_booking_uid?: string | null
          call_id?: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          raw?: Json
          retell_agent_id?: string | null
          summary?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_summaries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          agent_id: string | null
          attendee_email: string | null
          attendee_name: string | null
          attendee_phone: string | null
          calcom_booking_id: number | null
          calcom_booking_uid: string | null
          created_at: string
          end_at: string
          event_type_id: number | null
          id: string
          notes: string | null
          raw: Json
          retell_call_id: string | null
          start_at: string
          status: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          agent_id?: string | null
          attendee_email?: string | null
          attendee_name?: string | null
          attendee_phone?: string | null
          calcom_booking_id?: number | null
          calcom_booking_uid?: string | null
          created_at?: string
          end_at: string
          event_type_id?: number | null
          id?: string
          notes?: string | null
          raw?: Json
          retell_call_id?: string | null
          start_at: string
          status?: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string | null
          attendee_email?: string | null
          attendee_name?: string | null
          attendee_phone?: string | null
          calcom_booking_id?: number | null
          calcom_booking_uid?: string | null
          created_at?: string
          end_at?: string
          event_type_id?: number | null
          id?: string
          notes?: string | null
          raw?: Json
          retell_call_id?: string | null
          start_at?: string
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calcom_event_types: {
        Row: {
          active: boolean
          calcom_event_type_id: number
          created_at: string
          id: string
          last_synced_at: string | null
          length_minutes: number
          raw: Json
          slug: string | null
          title: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          active?: boolean
          calcom_event_type_id: number
          created_at?: string
          id?: string
          last_synced_at?: string | null
          length_minutes?: number
          raw?: Json
          slug?: string | null
          title: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          active?: boolean
          calcom_event_type_id?: number
          created_at?: string
          id?: string
          last_synced_at?: string | null
          length_minutes?: number
          raw?: Json
          slug?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calcom_event_types_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_bookings: {
        Row: {
          attendee_email: string | null
          attendee_name: string | null
          attendee_phone: string | null
          created_at: string
          description: string | null
          end_at: string
          external_id: string | null
          id: string
          lead_id: string | null
          meeting_url: string | null
          notes: string | null
          source: string
          start_at: string
          status: Database["public"]["Enums"]["booking_status"]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attendee_email?: string | null
          attendee_name?: string | null
          attendee_phone?: string | null
          created_at?: string
          description?: string | null
          end_at: string
          external_id?: string | null
          id?: string
          lead_id?: string | null
          meeting_url?: string | null
          notes?: string | null
          source?: string
          start_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          attendee_email?: string | null
          attendee_name?: string | null
          attendee_phone?: string | null
          created_at?: string
          description?: string | null
          end_at?: string
          external_id?: string | null
          id?: string
          lead_id?: string | null
          meeting_url?: string | null
          notes?: string | null
          source?: string
          start_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_bookings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_bookings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          calcom_credential_id: number | null
          created_at: string
          email: string | null
          external_id: string
          id: string
          is_availability: boolean
          is_primary_booking: boolean
          last_synced_at: string | null
          name: string | null
          provider: string
          read_only: boolean
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          calcom_credential_id?: number | null
          created_at?: string
          email?: string | null
          external_id: string
          id?: string
          is_availability?: boolean
          is_primary_booking?: boolean
          last_synced_at?: string | null
          name?: string | null
          provider?: string
          read_only?: boolean
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          calcom_credential_id?: number | null
          created_at?: string
          email?: string | null
          external_id?: string
          id?: string
          is_availability?: boolean
          is_primary_booking?: boolean
          last_synced_at?: string | null
          name?: string | null
          provider?: string
          read_only?: boolean
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      call_events: {
        Row: {
          call_id: string
          event_data: Json | null
          event_type: string
          id: string
          occurred_at: string
          workspace_id: string
        }
        Insert: {
          call_id: string
          event_data?: Json | null
          event_type: string
          id?: string
          occurred_at?: string
          workspace_id: string
        }
        Update: {
          call_id?: string
          event_data?: Json | null
          event_type?: string
          id?: string
          occurred_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_events_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "telephony_calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      call_profitability: {
        Row: {
          agent_id: string | null
          call_id: string | null
          created_at: string
          duration_seconds: number
          id: string
          infra_cost_cents: number
          llm_cost_cents: number
          margin_pct: number
          model: string | null
          profit_cents: number
          provider: string | null
          selling_price_cents: number
          telephony_cost_cents: number
          tool_cost_cents: number
          total_cost_cents: number
          voice: string | null
          voice_cost_cents: number
          workspace_id: string | null
        }
        Insert: {
          agent_id?: string | null
          call_id?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          infra_cost_cents?: number
          llm_cost_cents?: number
          margin_pct?: number
          model?: string | null
          profit_cents?: number
          provider?: string | null
          selling_price_cents?: number
          telephony_cost_cents?: number
          tool_cost_cents?: number
          total_cost_cents?: number
          voice?: string | null
          voice_cost_cents?: number
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string | null
          call_id?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          infra_cost_cents?: number
          llm_cost_cents?: number
          margin_pct?: number
          model?: string | null
          profit_cents?: number
          provider?: string | null
          selling_price_cents?: number
          telephony_cost_cents?: number
          tool_cost_cents?: number
          total_cost_cents?: number
          voice?: string | null
          voice_cost_cents?: number
          workspace_id?: string | null
        }
        Relationships: []
      }
      calls: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          call_outcome: string | null
          call_status: Database["public"]["Enums"]["call_status"]
          call_successful: boolean | null
          call_summary: string | null
          call_type: Database["public"]["Enums"]["call_type"]
          channel_type: string | null
          cost_cents: number | null
          created_at: string
          disconnection_reason: string | null
          duration_seconds: number | null
          ended_at: string | null
          from_number: string | null
          id: string
          in_voicemail: boolean | null
          is_voicemail: boolean
          lead_id: string | null
          provider: string | null
          recording_url: string | null
          retell_call_id: string | null
          sentiment: Database["public"]["Enums"]["sentiment_kind"] | null
          started_at: string | null
          to_number: string
          transcript: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          call_outcome?: string | null
          call_status?: Database["public"]["Enums"]["call_status"]
          call_successful?: boolean | null
          call_summary?: string | null
          call_type?: Database["public"]["Enums"]["call_type"]
          channel_type?: string | null
          cost_cents?: number | null
          created_at?: string
          disconnection_reason?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          in_voicemail?: boolean | null
          is_voicemail?: boolean
          lead_id?: string | null
          provider?: string | null
          recording_url?: string | null
          retell_call_id?: string | null
          sentiment?: Database["public"]["Enums"]["sentiment_kind"] | null
          started_at?: string | null
          to_number: string
          transcript?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          call_outcome?: string | null
          call_status?: Database["public"]["Enums"]["call_status"]
          call_successful?: boolean | null
          call_summary?: string | null
          call_type?: Database["public"]["Enums"]["call_type"]
          channel_type?: string | null
          cost_cents?: number | null
          created_at?: string
          disconnection_reason?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          in_voicemail?: boolean | null
          is_voicemail?: boolean
          lead_id?: string | null
          provider?: string | null
          recording_url?: string | null
          retell_call_id?: string | null
          sentiment?: Database["public"]["Enums"]["sentiment_kind"] | null
          started_at?: string | null
          to_number?: string
          transcript?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          agent_id: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          phone_number_id: string | null
          retry_config: Json | null
          schedule_config: Json | null
          stats: Json | null
          status: string
          targets: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          phone_number_id?: string | null
          retry_config?: Json | null
          schedule_config?: Json | null
          stats?: Json | null
          status?: string
          targets?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          phone_number_id?: string | null
          retry_config?: Json | null
          schedule_config?: Json | null
          stats?: Json | null
          status?: string
          targets?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_api_connections: {
        Row: {
          auth_type: string
          base_url: string
          client_id: string | null
          created_at: string
          encrypted_credentials: Json | null
          id: string
          name: string
          notes: string | null
          status: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          auth_type?: string
          base_url: string
          client_id?: string | null
          created_at?: string
          encrypted_credentials?: Json | null
          id?: string
          name: string
          notes?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          auth_type?: string
          base_url?: string
          client_id?: string | null
          created_at?: string
          encrypted_credentials?: Json | null
          id?: string
          name?: string
          notes?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_api_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_api_endpoint_mappings: {
        Row: {
          body_template: Json | null
          client_api_connection_id: string
          created_at: string
          detected_array_path: string | null
          endpoint_path: string
          field_mapping: Json | null
          id: string
          method: string
          module_key: string
          notes: string | null
          pagination_strategy: string | null
          query_params: Json | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          body_template?: Json | null
          client_api_connection_id: string
          created_at?: string
          detected_array_path?: string | null
          endpoint_path: string
          field_mapping?: Json | null
          id?: string
          method?: string
          module_key: string
          notes?: string | null
          pagination_strategy?: string | null
          query_params?: Json | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          body_template?: Json | null
          client_api_connection_id?: string
          created_at?: string
          detected_array_path?: string | null
          endpoint_path?: string
          field_mapping?: Json | null
          id?: string
          method?: string
          module_key?: string
          notes?: string | null
          pagination_strategy?: string | null
          query_params?: Json | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_api_endpoint_mappings_client_api_connection_id_fkey"
            columns: ["client_api_connection_id"]
            isOneToOne: false
            referencedRelation: "client_api_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_api_endpoint_mappings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_billing_profiles: {
        Row: {
          billing_cycle: string
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string
          currency: string
          id: string
          included_email_sends: number
          included_messages: number
          included_minutes: number
          included_storage_mb: number
          included_video_seconds: number
          monthly_charge_cents: number
          notes: string | null
          overage_rates_json: Json
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          billing_cycle?: string
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          currency?: string
          id?: string
          included_email_sends?: number
          included_messages?: number
          included_minutes?: number
          included_storage_mb?: number
          included_video_seconds?: number
          monthly_charge_cents?: number
          notes?: string | null
          overage_rates_json?: Json
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          billing_cycle?: string
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          currency?: string
          id?: string
          included_email_sends?: number
          included_messages?: number
          included_minutes?: number
          included_storage_mb?: number
          included_video_seconds?: number
          monthly_charge_cents?: number
          notes?: string | null
          overage_rates_json?: Json
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_billing_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_monthly_costs: {
        Row: {
          computed_at: string
          created_at: string
          email_cost_cents: number
          gross_margin_percent: number
          gross_profit_cents: number
          id: string
          image_cost_cents: number
          infrastructure_cost_cents: number
          llm_cost_cents: number
          month: string
          monthly_charge_cents: number
          source_breakdown_json: Json
          storage_cost_cents: number
          telephony_cost_cents: number
          total_cost_cents: number
          updated_at: string
          video_cost_cents: number
          voice_cost_cents: number
          whatsapp_cost_cents: number
          workspace_id: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          email_cost_cents?: number
          gross_margin_percent?: number
          gross_profit_cents?: number
          id?: string
          image_cost_cents?: number
          infrastructure_cost_cents?: number
          llm_cost_cents?: number
          month: string
          monthly_charge_cents?: number
          source_breakdown_json?: Json
          storage_cost_cents?: number
          telephony_cost_cents?: number
          total_cost_cents?: number
          updated_at?: string
          video_cost_cents?: number
          voice_cost_cents?: number
          whatsapp_cost_cents?: number
          workspace_id: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          email_cost_cents?: number
          gross_margin_percent?: number
          gross_profit_cents?: number
          id?: string
          image_cost_cents?: number
          infrastructure_cost_cents?: number
          llm_cost_cents?: number
          month?: string
          monthly_charge_cents?: number
          source_breakdown_json?: Json
          storage_cost_cents?: number
          telephony_cost_cents?: number
          total_cost_cents?: number
          updated_at?: string
          video_cost_cents?: number
          voice_cost_cents?: number
          whatsapp_cost_cents?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_monthly_costs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_documents: {
        Row: {
          contact_id: string
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          public_url: string
          storage_path: string
          uploaded_by: string
          workspace_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          public_url: string
          storage_path: string
          uploaded_by?: string
          workspace_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          public_url?: string
          storage_path?: string
          uploaded_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "data_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_engine_client_estimates: {
        Row: {
          client_email: string | null
          client_name: string
          created_at: string
          id: string
          monthly_addon_charges: Json
          notes: string | null
          plan_id: string | null
          project_weeks: number
          team_config: Json
          updated_at: string
        }
        Insert: {
          client_email?: string | null
          client_name: string
          created_at?: string
          id?: string
          monthly_addon_charges?: Json
          notes?: string | null
          plan_id?: string | null
          project_weeks?: number
          team_config?: Json
          updated_at?: string
        }
        Update: {
          client_email?: string | null
          client_name?: string
          created_at?: string
          id?: string
          monthly_addon_charges?: Json
          notes?: string | null
          plan_id?: string | null
          project_weeks?: number
          team_config?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_engine_client_estimates_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "cost_engine_customer_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_engine_customer_plans: {
        Row: {
          created_at: string
          description: string | null
          id: string
          included_minutes: number
          is_active: boolean
          plan_name: string
          price_per_minute: number
          price_per_month: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          included_minutes?: number
          is_active?: boolean
          plan_name: string
          price_per_minute?: number
          price_per_month?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          included_minutes?: number
          is_active?: boolean
          plan_name?: string
          price_per_minute?: number
          price_per_month?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      cost_engine_dev_roles: {
        Row: {
          created_at: string
          hours_per_week: number
          id: string
          notes: string | null
          rate_per_hour: number
          role_name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          hours_per_week?: number
          id?: string
          notes?: string | null
          rate_per_hour?: number
          role_name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          hours_per_week?: number
          id?: string
          notes?: string | null
          rate_per_hour?: number
          role_name?: string
          sort_order?: number
        }
        Relationships: []
      }
      cost_engine_infrastructure: {
        Row: {
          allocation_type: string
          bandwidth_cost: number
          created_at: string
          database_cost: number
          estimated_monthly_minutes: number
          id: string
          is_current: boolean
          notes: string | null
          server_cost: number
          storage_cost: number
          updated_at: string
        }
        Insert: {
          allocation_type?: string
          bandwidth_cost?: number
          created_at?: string
          database_cost?: number
          estimated_monthly_minutes?: number
          id?: string
          is_current?: boolean
          notes?: string | null
          server_cost?: number
          storage_cost?: number
          updated_at?: string
        }
        Update: {
          allocation_type?: string
          bandwidth_cost?: number
          created_at?: string
          database_cost?: number
          estimated_monthly_minutes?: number
          id?: string
          is_current?: boolean
          notes?: string | null
          server_cost?: number
          storage_cost?: number
          updated_at?: string
        }
        Relationships: []
      }
      cost_engine_knowledge: {
        Row: {
          created_at: string
          embedding_cost_per_1k: number
          id: string
          is_current: boolean
          notes: string | null
          retrieval_cost_per_query: number
          storage_per_gb_month: number
          updated_at: string
          vector_storage_per_gb_month: number
        }
        Insert: {
          created_at?: string
          embedding_cost_per_1k?: number
          id?: string
          is_current?: boolean
          notes?: string | null
          retrieval_cost_per_query?: number
          storage_per_gb_month?: number
          updated_at?: string
          vector_storage_per_gb_month?: number
        }
        Update: {
          created_at?: string
          embedding_cost_per_1k?: number
          id?: string
          is_current?: boolean
          notes?: string | null
          retrieval_cost_per_query?: number
          storage_per_gb_month?: number
          updated_at?: string
          vector_storage_per_gb_month?: number
        }
        Relationships: []
      }
      cost_engine_llm: {
        Row: {
          audio_input_cost: number
          audio_output_cost: number
          cached_token_cost: number
          created_at: string
          id: string
          input_token_cost: number
          is_current: boolean
          model: string
          notes: string | null
          output_token_cost: number
          provider: string
          updated_at: string
        }
        Insert: {
          audio_input_cost?: number
          audio_output_cost?: number
          cached_token_cost?: number
          created_at?: string
          id?: string
          input_token_cost?: number
          is_current?: boolean
          model: string
          notes?: string | null
          output_token_cost?: number
          provider: string
          updated_at?: string
        }
        Update: {
          audio_input_cost?: number
          audio_output_cost?: number
          cached_token_cost?: number
          created_at?: string
          id?: string
          input_token_cost?: number
          is_current?: boolean
          model?: string
          notes?: string | null
          output_token_cost?: number
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      cost_engine_markup: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          markup_type: string
          markup_value: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          markup_type?: string
          markup_value?: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          markup_type?: string
          markup_value?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cost_engine_retell: {
        Row: {
          created_at: string
          id: string
          is_current: boolean
          minute_cost: number
          notes: string | null
          number_cost_monthly: number
          subscription_cost_monthly: number
          transfer_cost_per_min: number
          updated_at: string
          voice_cost_per_min: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_current?: boolean
          minute_cost?: number
          notes?: string | null
          number_cost_monthly?: number
          subscription_cost_monthly?: number
          transfer_cost_per_min?: number
          updated_at?: string
          voice_cost_per_min?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_current?: boolean
          minute_cost?: number
          notes?: string | null
          number_cost_monthly?: number
          subscription_cost_monthly?: number
          transfer_cost_per_min?: number
          updated_at?: string
          voice_cost_per_min?: number
        }
        Relationships: []
      }
      cost_engine_systemmind: {
        Row: {
          base_charge_per_run_usd: number
          charge_per_1k_tokens_usd: number
          charge_per_minute_usd: number
          charge_per_tool_call_usd: number
          created_at: string
          expose_provider_cost: boolean
          id: string
          included_runs_per_month: number
          included_seconds_per_month: number
          included_tokens_per_month: number
          is_current: boolean
          notes: string | null
          overage_multiplier: number
          updated_at: string
        }
        Insert: {
          base_charge_per_run_usd?: number
          charge_per_1k_tokens_usd?: number
          charge_per_minute_usd?: number
          charge_per_tool_call_usd?: number
          created_at?: string
          expose_provider_cost?: boolean
          id?: string
          included_runs_per_month?: number
          included_seconds_per_month?: number
          included_tokens_per_month?: number
          is_current?: boolean
          notes?: string | null
          overage_multiplier?: number
          updated_at?: string
        }
        Update: {
          base_charge_per_run_usd?: number
          charge_per_1k_tokens_usd?: number
          charge_per_minute_usd?: number
          charge_per_tool_call_usd?: number
          created_at?: string
          expose_provider_cost?: boolean
          id?: string
          included_runs_per_month?: number
          included_seconds_per_month?: number
          included_tokens_per_month?: number
          is_current?: boolean
          notes?: string | null
          overage_multiplier?: number
          updated_at?: string
        }
        Relationships: []
      }
      cost_engine_telephony: {
        Row: {
          country: string
          created_at: string
          id: string
          inbound_cost_per_min: number
          is_current: boolean
          notes: string | null
          number_rental_monthly: number
          outbound_cost_per_min: number
          provider: string
          recording_cost_per_min: number
          updated_at: string
        }
        Insert: {
          country: string
          created_at?: string
          id?: string
          inbound_cost_per_min?: number
          is_current?: boolean
          notes?: string | null
          number_rental_monthly?: number
          outbound_cost_per_min?: number
          provider: string
          recording_cost_per_min?: number
          updated_at?: string
        }
        Update: {
          country?: string
          created_at?: string
          id?: string
          inbound_cost_per_min?: number
          is_current?: boolean
          notes?: string | null
          number_rental_monthly?: number
          outbound_cost_per_min?: number
          provider?: string
          recording_cost_per_min?: number
          updated_at?: string
        }
        Relationships: []
      }
      cost_engine_tools: {
        Row: {
          api_cost_per_call: number
          calendar_cost_per_month: number
          created_at: string
          crm_cost_per_month: number
          id: string
          is_current: boolean
          notes: string | null
          updated_at: string
          webhook_cost_per_call: number
        }
        Insert: {
          api_cost_per_call?: number
          calendar_cost_per_month?: number
          created_at?: string
          crm_cost_per_month?: number
          id?: string
          is_current?: boolean
          notes?: string | null
          updated_at?: string
          webhook_cost_per_call?: number
        }
        Update: {
          api_cost_per_call?: number
          calendar_cost_per_month?: number
          created_at?: string
          crm_cost_per_month?: number
          id?: string
          is_current?: boolean
          notes?: string | null
          updated_at?: string
          webhook_cost_per_call?: number
        }
        Relationships: []
      }
      cost_engine_voice: {
        Row: {
          cost_per_character: number
          cost_per_minute: number
          cost_per_request: number
          created_at: string
          id: string
          is_current: boolean
          notes: string | null
          provider: string
          updated_at: string
          voice_id: string
          voice_name: string
        }
        Insert: {
          cost_per_character?: number
          cost_per_minute?: number
          cost_per_request?: number
          created_at?: string
          id?: string
          is_current?: boolean
          notes?: string | null
          provider: string
          updated_at?: string
          voice_id: string
          voice_name: string
        }
        Update: {
          cost_per_character?: number
          cost_per_minute?: number
          cost_per_request?: number
          created_at?: string
          id?: string
          is_current?: boolean
          notes?: string | null
          provider?: string
          updated_at?: string
          voice_id?: string
          voice_name?: string
        }
        Relationships: []
      }
      custom_agent_configs: {
        Row: {
          agent_id: string | null
          agent_summary: string | null
          calendar_mapping: Json | null
          created_at: string | null
          crm_field_mapping: Json | null
          crm_mode: string
          deployment_config: Json | null
          deployment_readiness_score: number | null
          extraction_fields: Json | null
          go_live_checklist: Json | null
          id: string
          missing_capabilities: Json | null
          outcome_schema: Json | null
          required_tools: Json | null
          required_variables: Json | null
          source_script: string | null
          status: string
          title: string
          updated_at: string | null
          webhook_payload_schema: Json | null
          workspace_id: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_summary?: string | null
          calendar_mapping?: Json | null
          created_at?: string | null
          crm_field_mapping?: Json | null
          crm_mode?: string
          deployment_config?: Json | null
          deployment_readiness_score?: number | null
          extraction_fields?: Json | null
          go_live_checklist?: Json | null
          id?: string
          missing_capabilities?: Json | null
          outcome_schema?: Json | null
          required_tools?: Json | null
          required_variables?: Json | null
          source_script?: string | null
          status?: string
          title?: string
          updated_at?: string | null
          webhook_payload_schema?: Json | null
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_summary?: string | null
          calendar_mapping?: Json | null
          created_at?: string | null
          crm_field_mapping?: Json | null
          crm_mode?: string
          deployment_config?: Json | null
          deployment_readiness_score?: number | null
          extraction_fields?: Json | null
          go_live_checklist?: Json | null
          id?: string
          missing_capabilities?: Json | null
          outcome_schema?: Json | null
          required_tools?: Json | null
          required_variables?: Json | null
          source_script?: string | null
          status?: string
          title?: string
          updated_at?: string | null
          webhook_payload_schema?: Json | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_agent_configs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_agent_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      data_records: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          assigned_agent_id: string | null
          bedrooms: string | null
          call_status: Database["public"]["Enums"]["data_record_call_status"]
          campaign_id: string | null
          city: string | null
          client_name: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          last_call_at: string | null
          last_call_outcome: string | null
          last_call_sentiment: string | null
          last_name: string | null
          lead_external_id: string | null
          meta: Json
          mobile_number: string
          name: string
          need_to_call: boolean
          postal_code: string | null
          property_type: string | null
          scheduled_call_at: string | null
          source: string | null
          state: string | null
          title: string | null
          unique_id: string | null
          updated_at: string
          upload_token: string
          workspace_id: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          assigned_agent_id?: string | null
          bedrooms?: string | null
          call_status?: Database["public"]["Enums"]["data_record_call_status"]
          campaign_id?: string | null
          city?: string | null
          client_name?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          last_call_at?: string | null
          last_call_outcome?: string | null
          last_call_sentiment?: string | null
          last_name?: string | null
          lead_external_id?: string | null
          meta?: Json
          mobile_number: string
          name: string
          need_to_call?: boolean
          postal_code?: string | null
          property_type?: string | null
          scheduled_call_at?: string | null
          source?: string | null
          state?: string | null
          title?: string | null
          unique_id?: string | null
          updated_at?: string
          upload_token?: string
          workspace_id: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          assigned_agent_id?: string | null
          bedrooms?: string | null
          call_status?: Database["public"]["Enums"]["data_record_call_status"]
          campaign_id?: string | null
          city?: string | null
          client_name?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          last_call_at?: string | null
          last_call_outcome?: string | null
          last_call_sentiment?: string | null
          last_name?: string | null
          lead_external_id?: string | null
          meta?: Json
          mobile_number?: string
          name?: string
          need_to_call?: boolean
          postal_code?: string | null
          property_type?: string | null
          scheduled_call_at?: string | null
          source?: string | null
          state?: string | null
          title?: string | null
          unique_id?: string | null
          updated_at?: string
          upload_token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_records_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      deployments: {
        Row: {
          agent_id: string
          deployed_at: string
          deployed_by: string
          error: string | null
          id: string
          payload: Json | null
          provider: string
          provider_agent_id: string | null
          provider_flow_id: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          agent_id: string
          deployed_at?: string
          deployed_by: string
          error?: string | null
          id?: string
          payload?: Json | null
          provider?: string
          provider_agent_id?: string | null
          provider_flow_id?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string
          deployed_at?: string
          deployed_by?: string
          error?: string | null
          id?: string
          payload?: Json | null
          provider?: string
          provider_agent_id?: string | null
          provider_flow_id?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deployments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deployments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_deliverability_checks: {
        Row: {
          check_type: string
          created_at: string
          details: Json | null
          domain_id: string | null
          id: string
          status: string
          workspace_id: string
        }
        Insert: {
          check_type: string
          created_at?: string
          details?: Json | null
          domain_id?: string | null
          id?: string
          status: string
          workspace_id: string
        }
        Update: {
          check_type?: string
          created_at?: string
          details?: Json | null
          domain_id?: string | null
          id?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_deliverability_checks_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "email_sender_domains"
            referencedColumns: ["id"]
          },
        ]
      }
      email_mailboxes: {
        Row: {
          created_at: string
          daily_send_limit: number
          domain_id: string | null
          email_address: string
          id: string
          last_reset_at: string | null
          last_sent_at: string | null
          provider: string
          sends_today: number
          status: string
          updated_at: string
          warmup_stage: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          daily_send_limit?: number
          domain_id?: string | null
          email_address: string
          id?: string
          last_reset_at?: string | null
          last_sent_at?: string | null
          provider?: string
          sends_today?: number
          status?: string
          updated_at?: string
          warmup_stage?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          daily_send_limit?: number
          domain_id?: string | null
          email_address?: string
          id?: string
          last_reset_at?: string | null
          last_sent_at?: string | null
          provider?: string
          sends_today?: number
          status?: string
          updated_at?: string
          warmup_stage?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_mailboxes_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "email_sender_domains"
            referencedColumns: ["id"]
          },
        ]
      }
      email_reputation_events: {
        Row: {
          created_at: string
          description: string | null
          domain_id: string | null
          event_type: string
          id: string
          mailbox_id: string | null
          metadata: Json | null
          severity: string
          source: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          domain_id?: string | null
          event_type: string
          id?: string
          mailbox_id?: string | null
          metadata?: Json | null
          severity?: string
          source?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          domain_id?: string | null
          event_type?: string
          id?: string
          mailbox_id?: string | null
          metadata?: Json | null
          severity?: string
          source?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_reputation_events_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "email_sender_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_reputation_events_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "email_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_sender_domains: {
        Row: {
          created_at: string
          dkim_record: string | null
          dkim_selector: string | null
          dkim_status: string
          dmarc_record: string | null
          dmarc_status: string
          dns_checked_at: string | null
          domain: string
          id: string
          mx_records: Json | null
          mx_status: string
          provider: string
          spf_record: string | null
          spf_status: string
          status: string
          tracking_domain_status: string
          updated_at: string
          verified_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          dkim_record?: string | null
          dkim_selector?: string | null
          dkim_status?: string
          dmarc_record?: string | null
          dmarc_status?: string
          dns_checked_at?: string | null
          domain: string
          id?: string
          mx_records?: Json | null
          mx_status?: string
          provider?: string
          spf_record?: string | null
          spf_status?: string
          status?: string
          tracking_domain_status?: string
          updated_at?: string
          verified_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          dkim_record?: string | null
          dkim_selector?: string | null
          dkim_status?: string
          dmarc_record?: string | null
          dmarc_status?: string
          dns_checked_at?: string | null
          domain?: string
          id?: string
          mx_records?: Json | null
          mx_status?: string
          provider?: string
          spf_record?: string | null
          spf_status?: string
          status?: string
          tracking_domain_status?: string
          updated_at?: string
          verified_at?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      email_warmup_daily_targets: {
        Row: {
          actual_send_count: number
          bounce_count: number
          click_count: number
          complaint_count: number
          created_at: string
          day_number: number
          id: string
          open_count: number
          reply_count: number
          status: string
          target_send_count: number
          warmup_plan_id: string
          workspace_id: string
        }
        Insert: {
          actual_send_count?: number
          bounce_count?: number
          click_count?: number
          complaint_count?: number
          created_at?: string
          day_number: number
          id?: string
          open_count?: number
          reply_count?: number
          status?: string
          target_send_count?: number
          warmup_plan_id: string
          workspace_id: string
        }
        Update: {
          actual_send_count?: number
          bounce_count?: number
          click_count?: number
          complaint_count?: number
          created_at?: string
          day_number?: number
          id?: string
          open_count?: number
          reply_count?: number
          status?: string
          target_send_count?: number
          warmup_plan_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_warmup_daily_targets_warmup_plan_id_fkey"
            columns: ["warmup_plan_id"]
            isOneToOne: false
            referencedRelation: "email_warmup_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      email_warmup_plans: {
        Row: {
          created_at: string
          current_day: number
          domain_id: string | null
          id: string
          increment_type: string
          increment_value: number
          mailbox_id: string | null
          name: string
          start_date: string
          starting_daily_volume: number
          status: string
          target_daily_volume: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          current_day?: number
          domain_id?: string | null
          id?: string
          increment_type?: string
          increment_value?: number
          mailbox_id?: string | null
          name: string
          start_date: string
          starting_daily_volume?: number
          status?: string
          target_daily_volume?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          current_day?: number
          domain_id?: string | null
          id?: string
          increment_type?: string
          increment_value?: number
          mailbox_id?: string | null
          name?: string
          start_date?: string
          starting_daily_volume?: number
          status?: string
          target_daily_volume?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_warmup_plans_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "email_sender_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_warmup_plans_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "email_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprise_integrations: {
        Row: {
          access_token: string | null
          client_name: string
          created_at: string
          id: string
          integration_key: string
          refresh_token: string | null
          status: string
          updated_at: string
          user_payload: Json | null
          workspace_id: string | null
        }
        Insert: {
          access_token?: string | null
          client_name: string
          created_at?: string
          id?: string
          integration_key: string
          refresh_token?: string | null
          status?: string
          updated_at?: string
          user_payload?: Json | null
          workspace_id?: string | null
        }
        Update: {
          access_token?: string | null
          client_name?: string
          created_at?: string
          id?: string
          integration_key?: string
          refresh_token?: string | null
          status?: string
          updated_at?: string
          user_payload?: Json | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          entity_id: string
          entity_type: string
          id: string
          workspace_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          entity_id: string
          entity_type: string
          id?: string
          workspace_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      executive_document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding_vector: string | null
          id: string
          knowledge_base_id: string
          metadata: Json
          token_count: number
          workspace_id: string | null
        }
        Insert: {
          chunk_index?: number
          content: string
          created_at?: string
          document_id: string
          embedding_vector?: string | null
          id?: string
          knowledge_base_id: string
          metadata?: Json
          token_count?: number
          workspace_id?: string | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding_vector?: string | null
          id?: string
          knowledge_base_id?: string
          metadata?: Json
          token_count?: number
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "executive_document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "executive_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executive_document_chunks_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "executive_knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executive_document_chunks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      executive_documents: {
        Row: {
          chunk_count: number
          content_hash: string | null
          created_at: string
          embedding_status: string
          error_message: string | null
          file_name: string | null
          file_size: number | null
          id: string
          indexed_at: string | null
          knowledge_base_id: string
          mime_type: string | null
          seed_key: string | null
          source_type: string
          storage_path: string | null
          title: string
          workspace_id: string | null
        }
        Insert: {
          chunk_count?: number
          content_hash?: string | null
          created_at?: string
          embedding_status?: string
          error_message?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          indexed_at?: string | null
          knowledge_base_id: string
          mime_type?: string | null
          seed_key?: string | null
          source_type?: string
          storage_path?: string | null
          title: string
          workspace_id?: string | null
        }
        Update: {
          chunk_count?: number
          content_hash?: string | null
          created_at?: string
          embedding_status?: string
          error_message?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          indexed_at?: string | null
          knowledge_base_id?: string
          mime_type?: string | null
          seed_key?: string | null
          source_type?: string
          storage_path?: string | null
          title?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "executive_documents_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "executive_knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executive_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      executive_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          severity: string
          source: string
          summary: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          severity?: string
          source?: string
          summary: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          severity?: string
          source?: string
          summary?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "executive_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      executive_knowledge_bases: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_shared: boolean
          mind_type: string
          name: string
          scope: string
          slug: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_shared?: boolean
          mind_type: string
          name: string
          scope?: string
          slug: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_shared?: boolean
          mind_type?: string
          name?: string
          scope?: string
          slug?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "executive_knowledge_bases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      executive_knowledge_queries: {
        Row: {
          created_at: string
          id: string
          matched_count: number
          matched_kb_slugs: string[]
          mind_type: string
          query: string
          top_k: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          matched_count?: number
          matched_kb_slugs?: string[]
          mind_type: string
          query: string
          top_k?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          matched_count?: number
          matched_kb_slugs?: string[]
          mind_type?: string
          query?: string
          top_k?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "executive_knowledge_queries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_sequence_drafts: {
        Row: {
          activated_campaign_id: string | null
          compiled_campaign: Json
          created_at: string
          created_by_user_id: string | null
          generated_action_id: string
          id: string
          is_deleted: boolean
          name: string
          purpose: string | null
          sequence: Json
          stop_conditions: Json
          target_statuses: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activated_campaign_id?: string | null
          compiled_campaign?: Json
          created_at?: string
          created_by_user_id?: string | null
          generated_action_id: string
          id?: string
          is_deleted?: boolean
          name: string
          purpose?: string | null
          sequence?: Json
          stop_conditions?: Json
          target_statuses?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activated_campaign_id?: string | null
          compiled_campaign?: Json
          created_at?: string
          created_by_user_id?: string | null
          generated_action_id?: string
          id?: string
          is_deleted?: boolean
          name?: string
          purpose?: string | null
          sequence?: Json
          stop_conditions?: Json
          target_statuses?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_sequence_drafts_generated_action_id_fkey"
            columns: ["generated_action_id"]
            isOneToOne: true
            referencedRelation: "systemmind_generated_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_ad_budget_alerts: {
        Row: {
          acknowledged: boolean
          alert_type: string
          created_at: string
          current_value: number | null
          id: string
          message: string | null
          platform: string
          threshold: number | null
          workspace_id: string
        }
        Insert: {
          acknowledged?: boolean
          alert_type: string
          created_at?: string
          current_value?: number | null
          id?: string
          message?: string | null
          platform: string
          threshold?: number | null
          workspace_id: string
        }
        Update: {
          acknowledged?: boolean
          alert_type?: string
          created_at?: string
          current_value?: number | null
          id?: string
          message?: string | null
          platform?: string
          threshold?: number | null
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_ad_budget_caps: {
        Row: {
          alert_at_pct: number
          currency: string
          id: string
          monthly_budget_cap: number
          platform: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          alert_at_pct?: number
          currency?: string
          id?: string
          monthly_budget_cap: number
          platform: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          alert_at_pct?: number
          currency?: string
          id?: string
          monthly_budget_cap?: number
          platform?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_ad_campaigns: {
        Row: {
          clicks: number
          conversions: number
          date_end: string | null
          date_start: string | null
          external_id: string
          id: string
          impressions: number
          name: string
          platform: string
          revenue: number
          roas: number | null
          spend: number
          status: string
          synced_at: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          clicks?: number
          conversions?: number
          date_end?: string | null
          date_start?: string | null
          external_id: string
          id?: string
          impressions?: number
          name: string
          platform: string
          revenue?: number
          roas?: number | null
          spend?: number
          status?: string
          synced_at?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          clicks?: number
          conversions?: number
          date_end?: string | null
          date_start?: string | null
          external_id?: string
          id?: string
          impressions?: number
          name?: string
          platform?: string
          revenue?: number
          roas?: number | null
          spend?: number
          status?: string
          synced_at?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_ad_performance_log: {
        Row: {
          campaigns_synced: number
          clicks_total: number | null
          conversions_total: number | null
          error_message: string | null
          id: string
          impressions_total: number | null
          platform: string
          spend_total: number | null
          status: string
          synced_at: string
          workspace_id: string
        }
        Insert: {
          campaigns_synced?: number
          clicks_total?: number | null
          conversions_total?: number | null
          error_message?: string | null
          id?: string
          impressions_total?: number | null
          platform: string
          spend_total?: number | null
          status?: string
          synced_at?: string
          workspace_id: string
        }
        Update: {
          campaigns_synced?: number
          clicks_total?: number | null
          conversions_total?: number | null
          error_message?: string | null
          id?: string
          impressions_total?: number | null
          platform?: string
          spend_total?: number | null
          status?: string
          synced_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_ad_sync_log: {
        Row: {
          campaigns_synced: number
          clicks_total: number | null
          conversions_total: number | null
          error_message: string | null
          id: string
          impressions_total: number | null
          platform: string
          spend_total: number | null
          status: string
          synced_at: string
          workspace_id: string
        }
        Insert: {
          campaigns_synced?: number
          clicks_total?: number | null
          conversions_total?: number | null
          error_message?: string | null
          id?: string
          impressions_total?: number | null
          platform: string
          spend_total?: number | null
          status?: string
          synced_at?: string
          workspace_id: string
        }
        Update: {
          campaigns_synced?: number
          clicks_total?: number | null
          conversions_total?: number | null
          error_message?: string | null
          id?: string
          impressions_total?: number | null
          platform?: string
          spend_total?: number | null
          status?: string
          synced_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_ad_webhook_events: {
        Row: {
          created_at: string
          event_type: string | null
          id: string
          payload: Json | null
          platform: string
          processed: boolean
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          event_type?: string | null
          id?: string
          payload?: Json | null
          platform: string
          processed?: boolean
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string | null
          id?: string
          payload?: Json | null
          platform?: string
          processed?: boolean
          workspace_id?: string | null
        }
        Relationships: []
      }
      growthmind_ads_accounts: {
        Row: {
          account_id: string
          created_at: string
          currency: string
          id: string
          label: string
          last_synced_at: string | null
          meta_app_id: string | null
          meta_app_secret_enc: string | null
          meta_pixel_id: string | null
          monthly_budget: number | null
          platform: string
          status: string
          sync_error: string | null
          sync_status: string
          token_enc: string | null
          total_spend_synced: number | null
          updated_at: string
          webhook_id: string | null
          webhook_registered: boolean
          workspace_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          currency?: string
          id?: string
          label: string
          last_synced_at?: string | null
          meta_app_id?: string | null
          meta_app_secret_enc?: string | null
          meta_pixel_id?: string | null
          monthly_budget?: number | null
          platform: string
          status?: string
          sync_error?: string | null
          sync_status?: string
          token_enc?: string | null
          total_spend_synced?: number | null
          updated_at?: string
          webhook_id?: string | null
          webhook_registered?: boolean
          workspace_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          currency?: string
          id?: string
          label?: string
          last_synced_at?: string | null
          meta_app_id?: string | null
          meta_app_secret_enc?: string | null
          meta_pixel_id?: string | null
          monthly_budget?: number | null
          platform?: string
          status?: string
          sync_error?: string | null
          sync_status?: string
          token_enc?: string | null
          total_spend_synced?: number | null
          updated_at?: string
          webhook_id?: string | null
          webhook_registered?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_ads_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_business_dna: {
        Row: {
          average_deal_value: number | null
          best_customers: string
          brand_style: string
          brand_voice: string
          business_goals: string
          case_studies: string
          company_name: string
          competitors_summary: string
          compliance_notes: string
          confidence_scores: Json
          country: string
          created_at: string
          current_ad_platforms: string
          current_analytics: string
          current_calendar: string
          current_crm: string
          current_telephony: string
          discovery_run_count: number
          discovery_sources: Json
          growth_targets: string
          id: string
          ideal_customer_profiles: string
          industry: string
          last_discovery_at: string | null
          lead_sources: string
          locations: string
          main_growth_objective: string
          marketing_goals: string
          monthly_marketing_budget: number | null
          offers: string
          pricing: string
          products: string
          profit_margin_pct: number | null
          qualification_criteria: string
          revenue_goals: string
          risk_tolerance: string
          sales_process: string
          services: string
          sub_industry: string
          target_company_sizes: string
          target_countries: string
          target_industries: string
          target_job_titles: string
          target_markets: string
          tone_of_voice: string
          unique_selling_points: string
          updated_at: string
          website: string
          workspace_id: string
          worst_customers: string
        }
        Insert: {
          average_deal_value?: number | null
          best_customers?: string
          brand_style?: string
          brand_voice?: string
          business_goals?: string
          case_studies?: string
          company_name?: string
          competitors_summary?: string
          compliance_notes?: string
          confidence_scores?: Json
          country?: string
          created_at?: string
          current_ad_platforms?: string
          current_analytics?: string
          current_calendar?: string
          current_crm?: string
          current_telephony?: string
          discovery_run_count?: number
          discovery_sources?: Json
          growth_targets?: string
          id?: string
          ideal_customer_profiles?: string
          industry?: string
          last_discovery_at?: string | null
          lead_sources?: string
          locations?: string
          main_growth_objective?: string
          marketing_goals?: string
          monthly_marketing_budget?: number | null
          offers?: string
          pricing?: string
          products?: string
          profit_margin_pct?: number | null
          qualification_criteria?: string
          revenue_goals?: string
          risk_tolerance?: string
          sales_process?: string
          services?: string
          sub_industry?: string
          target_company_sizes?: string
          target_countries?: string
          target_industries?: string
          target_job_titles?: string
          target_markets?: string
          tone_of_voice?: string
          unique_selling_points?: string
          updated_at?: string
          website?: string
          workspace_id: string
          worst_customers?: string
        }
        Update: {
          average_deal_value?: number | null
          best_customers?: string
          brand_style?: string
          brand_voice?: string
          business_goals?: string
          case_studies?: string
          company_name?: string
          competitors_summary?: string
          compliance_notes?: string
          confidence_scores?: Json
          country?: string
          created_at?: string
          current_ad_platforms?: string
          current_analytics?: string
          current_calendar?: string
          current_crm?: string
          current_telephony?: string
          discovery_run_count?: number
          discovery_sources?: Json
          growth_targets?: string
          id?: string
          ideal_customer_profiles?: string
          industry?: string
          last_discovery_at?: string | null
          lead_sources?: string
          locations?: string
          main_growth_objective?: string
          marketing_goals?: string
          monthly_marketing_budget?: number | null
          offers?: string
          pricing?: string
          products?: string
          profit_margin_pct?: number | null
          qualification_criteria?: string
          revenue_goals?: string
          risk_tolerance?: string
          sales_process?: string
          services?: string
          sub_industry?: string
          target_company_sizes?: string
          target_countries?: string
          target_industries?: string
          target_job_titles?: string
          target_markets?: string
          tone_of_voice?: string
          unique_selling_points?: string
          updated_at?: string
          website?: string
          workspace_id?: string
          worst_customers?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_business_dna_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_campaign_drafts: {
        Row: {
          ad_structure: Json
          budget: number | null
          campaign_type: string
          channels: Json
          confidence_score: number
          copy_blocks: Json
          core_offer: string
          created_at: string
          description: string
          evidence: string
          expected_outcome: string
          generated_by_model: string | null
          goal: string
          hivemind_action_id: string | null
          id: string
          kpis: Json
          last_calculated_at: string
          name: string
          sequence: Json
          source_snapshot: Json
          status: string
          target_audience: string
          workspace_id: string
        }
        Insert: {
          ad_structure?: Json
          budget?: number | null
          campaign_type: string
          channels?: Json
          confidence_score?: number
          copy_blocks?: Json
          core_offer?: string
          created_at?: string
          description?: string
          evidence?: string
          expected_outcome?: string
          generated_by_model?: string | null
          goal?: string
          hivemind_action_id?: string | null
          id?: string
          kpis?: Json
          last_calculated_at?: string
          name: string
          sequence?: Json
          source_snapshot?: Json
          status?: string
          target_audience?: string
          workspace_id: string
        }
        Update: {
          ad_structure?: Json
          budget?: number | null
          campaign_type?: string
          channels?: Json
          confidence_score?: number
          copy_blocks?: Json
          core_offer?: string
          created_at?: string
          description?: string
          evidence?: string
          expected_outcome?: string
          generated_by_model?: string | null
          goal?: string
          hivemind_action_id?: string | null
          id?: string
          kpis?: Json
          last_calculated_at?: string
          name?: string
          sequence?: Json
          source_snapshot?: Json
          status?: string
          target_audience?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_campaign_drafts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_campaign_proposals: {
        Row: {
          ad_copy: Json | null
          audience: string | null
          budget_estimate: string | null
          call_campaign: Json | null
          channels: string[]
          content_plan: string | null
          created_at: string
          dna_snapshot: Json | null
          email_sequence: Json | null
          estimated_cost_pence: number | null
          estimated_cpl_pence: number | null
          estimated_leads: number | null
          evidence: string | null
          expected_outcome: string | null
          expected_roi_pct: number | null
          follow_up_campaign: Json | null
          generated_at: string
          id: string
          image_prompt: string | null
          landing_page_rec: string | null
          measurement_strategy: Json | null
          package_complete: boolean
          reason: string | null
          status: string
          title: string
          video_plan: string | null
          video_prompt: string | null
          whatsapp_sequence: Json | null
          workspace_id: string
        }
        Insert: {
          ad_copy?: Json | null
          audience?: string | null
          budget_estimate?: string | null
          call_campaign?: Json | null
          channels?: string[]
          content_plan?: string | null
          created_at?: string
          dna_snapshot?: Json | null
          email_sequence?: Json | null
          estimated_cost_pence?: number | null
          estimated_cpl_pence?: number | null
          estimated_leads?: number | null
          evidence?: string | null
          expected_outcome?: string | null
          expected_roi_pct?: number | null
          follow_up_campaign?: Json | null
          generated_at?: string
          id?: string
          image_prompt?: string | null
          landing_page_rec?: string | null
          measurement_strategy?: Json | null
          package_complete?: boolean
          reason?: string | null
          status?: string
          title: string
          video_plan?: string | null
          video_prompt?: string | null
          whatsapp_sequence?: Json | null
          workspace_id: string
        }
        Update: {
          ad_copy?: Json | null
          audience?: string | null
          budget_estimate?: string | null
          call_campaign?: Json | null
          channels?: string[]
          content_plan?: string | null
          created_at?: string
          dna_snapshot?: Json | null
          email_sequence?: Json | null
          estimated_cost_pence?: number | null
          estimated_cpl_pence?: number | null
          estimated_leads?: number | null
          evidence?: string | null
          expected_outcome?: string | null
          expected_roi_pct?: number | null
          follow_up_campaign?: Json | null
          generated_at?: string
          id?: string
          image_prompt?: string | null
          landing_page_rec?: string | null
          measurement_strategy?: Json | null
          package_complete?: boolean
          reason?: string | null
          status?: string
          title?: string
          video_plan?: string | null
          video_prompt?: string | null
          whatsapp_sequence?: Json | null
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_campaigns: {
        Row: {
          ads_account_id: string | null
          clicks: number
          conversions: number
          cpl: number | null
          created_at: string
          id: string
          impressions: number
          metadata: Json | null
          name: string
          period_end: string | null
          period_start: string | null
          platform: string
          roas: number | null
          spend: number
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ads_account_id?: string | null
          clicks?: number
          conversions?: number
          cpl?: number | null
          created_at?: string
          id?: string
          impressions?: number
          metadata?: Json | null
          name: string
          period_end?: string | null
          period_start?: string | null
          platform: string
          roas?: number | null
          spend?: number
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ads_account_id?: string | null
          clicks?: number
          conversions?: number
          cpl?: number | null
          created_at?: string
          id?: string
          impressions?: number
          metadata?: Json | null
          name?: string
          period_end?: string | null
          period_start?: string | null
          platform?: string
          roas?: number | null
          spend?: number
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_campaigns_ads_account_id_fkey"
            columns: ["ads_account_id"]
            isOneToOne: false
            referencedRelation: "growthmind_ads_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_competitors: {
        Row: {
          ai_analysed_at: string | null
          ai_analysis: string | null
          created_at: string
          id: string
          name: string
          observations: string
          offers: string
          positioning: string
          services: string
          updated_at: string
          website: string
          workspace_id: string
        }
        Insert: {
          ai_analysed_at?: string | null
          ai_analysis?: string | null
          created_at?: string
          id?: string
          name: string
          observations?: string
          offers?: string
          positioning?: string
          services?: string
          updated_at?: string
          website?: string
          workspace_id: string
        }
        Update: {
          ai_analysed_at?: string | null
          ai_analysis?: string | null
          created_at?: string
          id?: string
          name?: string
          observations?: string
          offers?: string
          positioning?: string
          services?: string
          updated_at?: string
          website?: string
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_content_assets: {
        Row: {
          brief: Json | null
          content: string | null
          content_type: string
          created_at: string
          folder_id: string | null
          id: string
          is_favourite: boolean
          scheduled_at: string | null
          seo_data: Json | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          brief?: Json | null
          content?: string | null
          content_type: string
          created_at?: string
          folder_id?: string | null
          id?: string
          is_favourite?: boolean
          scheduled_at?: string | null
          seo_data?: Json | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          brief?: Json | null
          content?: string | null
          content_type?: string
          created_at?: string
          folder_id?: string | null
          id?: string
          is_favourite?: boolean
          scheduled_at?: string | null
          seo_data?: Json | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_content_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_content_calendar: {
        Row: {
          campaign_id: string | null
          channel: string | null
          content_type: string
          created_at: string
          description: string | null
          id: string
          image_asset_id: string | null
          notes: string | null
          owner: string | null
          plan_id: string | null
          scheduled_date: string | null
          series_id: string | null
          sort_order: number | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          channel?: string | null
          content_type?: string
          created_at?: string
          description?: string | null
          id?: string
          image_asset_id?: string | null
          notes?: string | null
          owner?: string | null
          plan_id?: string | null
          scheduled_date?: string | null
          series_id?: string | null
          sort_order?: number | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string | null
          channel?: string | null
          content_type?: string
          created_at?: string
          description?: string | null
          id?: string
          image_asset_id?: string | null
          notes?: string | null
          owner?: string | null
          plan_id?: string | null
          scheduled_date?: string | null
          series_id?: string | null
          sort_order?: number | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_content_calendar_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "growthmind_growth_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_content_calendar_image_asset_id_fkey"
            columns: ["image_asset_id"]
            isOneToOne: false
            referencedRelation: "growthmind_image_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_content_calendar_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "growthmind_content_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_content_calendar_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_content_campaign_links: {
        Row: {
          asset_id: string
          campaign_id: string
          campaign_type: string
          created_at: string
          id: string
          workspace_id: string
        }
        Insert: {
          asset_id: string
          campaign_id: string
          campaign_type: string
          created_at?: string
          id?: string
          workspace_id: string
        }
        Update: {
          asset_id?: string
          campaign_id?: string
          campaign_type?: string
          created_at?: string
          id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_content_campaign_links_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "growthmind_content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_content_campaign_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_content_folders: {
        Row: {
          created_at: string
          icon: string
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          icon?: string
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          icon?: string
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_content_folders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_content_generations: {
        Row: {
          asset_id: string | null
          brief: Json
          content_type: string
          created_at: string
          id: string
          tokens_used: number | null
          workspace_id: string
        }
        Insert: {
          asset_id?: string | null
          brief?: Json
          content_type: string
          created_at?: string
          id?: string
          tokens_used?: number | null
          workspace_id: string
        }
        Update: {
          asset_id?: string | null
          brief?: Json
          content_type?: string
          created_at?: string
          id?: string
          tokens_used?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_content_generations_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "growthmind_content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_content_generations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_content_series: {
        Row: {
          cadence: string
          channel: string | null
          content_type: string
          created_at: string
          day_of_week: number | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          next_date: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cadence?: string
          channel?: string | null
          content_type?: string
          created_at?: string
          day_of_week?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          next_date?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cadence?: string
          channel?: string | null
          content_type?: string
          created_at?: string
          day_of_week?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          next_date?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_content_series_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_content_templates: {
        Row: {
          brief_defaults: Json
          content_type: string
          created_at: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          brief_defaults?: Json
          content_type: string
          created_at?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          brief_defaults?: Json
          content_type?: string
          created_at?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_content_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_domain_warmups: {
        Row: {
          bounce_rate: number | null
          completed_days: number[]
          created_at: string
          current_day: number
          daily_plan: Json
          domain: string
          from_email: string
          id: string
          notes: string | null
          phase: number
          reputation_score: number | null
          spam_rate: number | null
          started_at: string
          status: string
          total_days: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          bounce_rate?: number | null
          completed_days?: number[]
          created_at?: string
          current_day?: number
          daily_plan?: Json
          domain: string
          from_email: string
          id?: string
          notes?: string | null
          phase?: number
          reputation_score?: number | null
          spam_rate?: number | null
          started_at?: string
          status?: string
          total_days?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          bounce_rate?: number | null
          completed_days?: number[]
          created_at?: string
          current_day?: number
          daily_plan?: Json
          domain?: string
          from_email?: string
          id?: string
          notes?: string | null
          phase?: number
          reputation_score?: number | null
          spam_rate?: number | null
          started_at?: string
          status?: string
          total_days?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_email_campaigns: {
        Row: {
          ai_model: string | null
          audience: Json
          body_html: string
          body_text: string
          created_at: string
          cta_label: string | null
          cta_url: string | null
          from_email: string | null
          from_name: string | null
          generated_by_ai: boolean
          id: string
          name: string
          preview_text: string
          recipient_count: number | null
          scheduled_at: string | null
          send_result: Json | null
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_model?: string | null
          audience?: Json
          body_html?: string
          body_text?: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          from_email?: string | null
          from_name?: string | null
          generated_by_ai?: boolean
          id?: string
          name: string
          preview_text?: string
          recipient_count?: number | null
          scheduled_at?: string | null
          send_result?: Json | null
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_model?: string | null
          audience?: Json
          body_html?: string
          body_text?: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          from_email?: string | null
          from_name?: string | null
          generated_by_ai?: boolean
          id?: string
          name?: string
          preview_text?: string
          recipient_count?: number | null
          scheduled_at?: string | null
          send_result?: Json | null
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_events: {
        Row: {
          created_at: string
          description: string | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string | null
          event_type: string
          id: string
          is_read: boolean
          severity: string
          task_id: string | null
          title: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          is_read?: boolean
          severity?: string
          task_id?: string | null
          title: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          is_read?: boolean
          severity?: string
          task_id?: string | null
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "growthmind_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_forecasts: {
        Row: {
          buckets: Json
          created_at: string
          currency: string
          deal_value: number
          id: string
          period_weeks: number
          scenario: string
          summary: Json | null
          workspace_id: string
        }
        Insert: {
          buckets?: Json
          created_at?: string
          currency?: string
          deal_value?: number
          id?: string
          period_weeks?: number
          scenario?: string
          summary?: Json | null
          workspace_id: string
        }
        Update: {
          buckets?: Json
          created_at?: string
          currency?: string
          deal_value?: number
          id?: string
          period_weeks?: number
          scenario?: string
          summary?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_forecasts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_funnels: {
        Row: {
          created_at: string
          id: string
          name: string
          snapshot_at: string
          stages: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          snapshot_at?: string
          stages?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          snapshot_at?: string
          stages?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_funnels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_generation_audit: {
        Row: {
          created_at: string
          duration_ms: number | null
          entity_id: string | null
          entity_type: string | null
          error_message: string | null
          event_type: string
          id: string
          input_tokens: number | null
          model_used: string | null
          output_tokens: number | null
          status: string
          triggered_by: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          input_tokens?: number | null
          model_used?: string | null
          output_tokens?: number | null
          status?: string
          triggered_by?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          input_tokens?: number | null
          model_used?: string | null
          output_tokens?: number | null
          status?: string
          triggered_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_generation_audit_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_generation_logs: {
        Row: {
          asset_id: string | null
          created_at: string
          estimated_cost_usd: number | null
          fallback_from: string | null
          id: string
          input_tokens: number | null
          model: string
          output_tokens: number | null
          provider: string
          status: string
          task_type: string
          workspace_id: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          estimated_cost_usd?: number | null
          fallback_from?: string | null
          id?: string
          input_tokens?: number | null
          model: string
          output_tokens?: number | null
          provider: string
          status?: string
          task_type: string
          workspace_id: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          estimated_cost_usd?: number | null
          fallback_from?: string | null
          id?: string
          input_tokens?: number | null
          model?: string
          output_tokens?: number | null
          provider?: string
          status?: string
          task_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_generation_logs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "growthmind_content_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_generation_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_goals: {
        Row: {
          created_at: string
          deadline: string
          id: string
          label: string
          metric: string
          target: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deadline: string
          id?: string
          label: string
          metric: string
          target: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          deadline?: string
          id?: string
          label?: string
          metric?: string
          target?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_goals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_growth_campaigns: {
        Row: {
          budget: number | null
          campaign_type: string
          color: string | null
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          name: string
          start_date: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          budget?: number | null
          campaign_type?: string
          color?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          start_date?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          budget?: number | null
          campaign_type?: string
          color?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          start_date?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_growth_campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_growth_plans: {
        Row: {
          business_type: string | null
          created_at: string
          generated_at: string | null
          generated_summary: string | null
          growth_goals: string | null
          id: string
          industry: string | null
          keywords: string[] | null
          monthly_budget: number | null
          name: string
          offer: string | null
          plan_type: string
          status: string
          target_audience: string | null
          target_leads_per_month: number | null
          target_markets: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          business_type?: string | null
          created_at?: string
          generated_at?: string | null
          generated_summary?: string | null
          growth_goals?: string | null
          id?: string
          industry?: string | null
          keywords?: string[] | null
          monthly_budget?: number | null
          name: string
          offer?: string | null
          plan_type?: string
          status?: string
          target_audience?: string | null
          target_leads_per_month?: number | null
          target_markets?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          business_type?: string | null
          created_at?: string
          generated_at?: string | null
          generated_summary?: string | null
          growth_goals?: string | null
          id?: string
          industry?: string | null
          keywords?: string[] | null
          monthly_budget?: number | null
          name?: string
          offer?: string | null
          plan_type?: string
          status?: string
          target_audience?: string | null
          target_leads_per_month?: number | null
          target_markets?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_growth_plans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_image_assets: {
        Row: {
          asset_type: string
          business_name: string | null
          campaign_id: string | null
          content_asset_id: string | null
          cost_usd: number
          created_at: string
          error_message: string | null
          height: number | null
          id: string
          image_url: string
          knowledge_context_id: string | null
          knowledge_context_type: string
          parent_asset_id: string | null
          platform_hint: string
          prompt: string
          provider: string
          revised_prompt: string | null
          status: string
          strategy_id: string | null
          style: string | null
          thumbnail_url: string | null
          updated_at: string
          width: number | null
          workspace_id: string
        }
        Insert: {
          asset_type?: string
          business_name?: string | null
          campaign_id?: string | null
          content_asset_id?: string | null
          cost_usd?: number
          created_at?: string
          error_message?: string | null
          height?: number | null
          id?: string
          image_url?: string
          knowledge_context_id?: string | null
          knowledge_context_type?: string
          parent_asset_id?: string | null
          platform_hint?: string
          prompt?: string
          provider?: string
          revised_prompt?: string | null
          status?: string
          strategy_id?: string | null
          style?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          width?: number | null
          workspace_id: string
        }
        Update: {
          asset_type?: string
          business_name?: string | null
          campaign_id?: string | null
          content_asset_id?: string | null
          cost_usd?: number
          created_at?: string
          error_message?: string | null
          height?: number | null
          id?: string
          image_url?: string
          knowledge_context_id?: string | null
          knowledge_context_type?: string
          parent_asset_id?: string | null
          platform_hint?: string
          prompt?: string
          provider?: string
          revised_prompt?: string | null
          status?: string
          strategy_id?: string | null
          style?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_image_assets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "growthmind_campaign_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_image_assets_parent_asset_id_fkey"
            columns: ["parent_asset_id"]
            isOneToOne: false
            referencedRelation: "growthmind_image_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_image_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_marketing_tasks: {
        Row: {
          calendar_entry_id: string | null
          campaign_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          plan_id: string | null
          priority: string
          status: string
          task_type: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          calendar_entry_id?: string | null
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          plan_id?: string | null
          priority?: string
          status?: string
          task_type?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          calendar_entry_id?: string | null
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          plan_id?: string | null
          priority?: string
          status?: string
          task_type?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_marketing_tasks_calendar_entry_id_fkey"
            columns: ["calendar_entry_id"]
            isOneToOne: false
            referencedRelation: "growthmind_content_calendar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_marketing_tasks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "growthmind_growth_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_marketing_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_model_settings: {
        Row: {
          created_at: string
          id: string
          mode: string
          model: string | null
          provider: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mode?: string
          model?: string | null
          provider?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mode?: string
          model?: string | null
          provider?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_model_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_opportunities: {
        Row: {
          category: string
          confidence_score: number
          created_at: string
          estimated_effort: string
          evidence: string
          expected_impact: string
          id: string
          last_calculated_at: string
          recommended_action: string
          recommended_channel: string
          related_assets: Json
          source_data: Json
          source_snapshot: Json
          title: string
          urgency: string
          workspace_id: string
        }
        Insert: {
          category: string
          confidence_score?: number
          created_at?: string
          estimated_effort?: string
          evidence?: string
          expected_impact?: string
          id?: string
          last_calculated_at?: string
          recommended_action?: string
          recommended_channel?: string
          related_assets?: Json
          source_data?: Json
          source_snapshot?: Json
          title: string
          urgency?: string
          workspace_id: string
        }
        Update: {
          category?: string
          confidence_score?: number
          created_at?: string
          estimated_effort?: string
          evidence?: string
          expected_impact?: string
          id?: string
          last_calculated_at?: string
          recommended_action?: string
          recommended_channel?: string
          related_assets?: Json
          source_data?: Json
          source_snapshot?: Json
          title?: string
          urgency?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_opportunities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_playbooks: {
        Row: {
          activated_at: string
          created_at: string
          id: string
          industry: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activated_at?: string
          created_at?: string
          id?: string
          industry: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activated_at?: string
          created_at?: string
          id?: string
          industry?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_playbooks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_prompt_runs: {
        Row: {
          created_at: string | null
          duration_ms: number | null
          engine: string
          id: string
          input_context: Json | null
          model_used: string | null
          output_text: string | null
          prompt_type: string | null
          status: string | null
          strategy_id: string | null
          tokens_used: number | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          duration_ms?: number | null
          engine: string
          id?: string
          input_context?: Json | null
          model_used?: string | null
          output_text?: string | null
          prompt_type?: string | null
          status?: string | null
          strategy_id?: string | null
          tokens_used?: number | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          duration_ms?: number | null
          engine?: string
          id?: string
          input_context?: Json | null
          model_used?: string | null
          output_text?: string | null
          prompt_type?: string | null
          status?: string | null
          strategy_id?: string | null
          tokens_used?: number | null
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_prompt_stats: {
        Row: {
          avg_score: number | null
          id: string
          last_used_at: string | null
          success_rate: number | null
          template_id: string
          updated_at: string
          usage_count: number
          workspace_id: string
        }
        Insert: {
          avg_score?: number | null
          id?: string
          last_used_at?: string | null
          success_rate?: number | null
          template_id: string
          updated_at?: string
          usage_count?: number
          workspace_id: string
        }
        Update: {
          avg_score?: number | null
          id?: string
          last_used_at?: string | null
          success_rate?: number | null
          template_id?: string
          updated_at?: string
          usage_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_prompt_stats_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "growthmind_prompt_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_prompt_stats_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_prompt_templates: {
        Row: {
          category: string
          chain_steps: Json
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_favorite: boolean
          name: string
          system_prompt: string
          tags: string[]
          type: string
          updated_at: string
          user_prompt_template: string
          variables: Json
          workspace_id: string
        }
        Insert: {
          category?: string
          chain_steps?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_favorite?: boolean
          name: string
          system_prompt?: string
          tags?: string[]
          type?: string
          updated_at?: string
          user_prompt_template?: string
          variables?: Json
          workspace_id: string
        }
        Update: {
          category?: string
          chain_steps?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_favorite?: boolean
          name?: string
          system_prompt?: string
          tags?: string[]
          type?: string
          updated_at?: string
          user_prompt_template?: string
          variables?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_prompt_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_prompt_test_outputs: {
        Row: {
          cost_usd: number | null
          created_at: string
          id: string
          input_variables: Json
          model_used: string | null
          output_text: string
          provider_used: string | null
          scores: Json
          template_id: string | null
          test_id: string | null
          variant_label: string
          workspace_id: string
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_variables?: Json
          model_used?: string | null
          output_text?: string
          provider_used?: string | null
          scores?: Json
          template_id?: string | null
          test_id?: string | null
          variant_label?: string
          workspace_id: string
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_variables?: Json
          model_used?: string | null
          output_text?: string
          provider_used?: string | null
          scores?: Json
          template_id?: string | null
          test_id?: string | null
          variant_label?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_prompt_test_outputs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "growthmind_prompt_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_prompt_test_outputs_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "growthmind_prompt_tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_prompt_test_outputs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_prompt_tests: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          name: string
          status: string
          template_id: string | null
          variants: Json
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          name: string
          status?: string
          template_id?: string | null
          variants?: Json
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          name?: string
          status?: string
          template_id?: string | null
          variants?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_prompt_tests_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "growthmind_prompt_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_prompt_tests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_prompt_versions: {
        Row: {
          change_note: string | null
          created_at: string
          id: string
          system_prompt: string
          template_id: string
          user_prompt_template: string
          variables: Json
          version: number
          workspace_id: string
        }
        Insert: {
          change_note?: string | null
          created_at?: string
          id?: string
          system_prompt?: string
          template_id: string
          user_prompt_template?: string
          variables?: Json
          version?: number
          workspace_id: string
        }
        Update: {
          change_note?: string | null
          created_at?: string
          id?: string
          system_prompt?: string
          template_id?: string
          user_prompt_template?: string
          variables?: Json
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_prompt_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "growthmind_prompt_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_prompt_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_recommendations: {
        Row: {
          action_href: string | null
          action_label: string | null
          category: string
          created_at: string
          fix: string | null
          id: string
          impact: string | null
          is_dismissed: boolean
          priority: string
          problem: string
          refreshed_at: string
          workspace_id: string
        }
        Insert: {
          action_href?: string | null
          action_label?: string | null
          category: string
          created_at?: string
          fix?: string | null
          id?: string
          impact?: string | null
          is_dismissed?: boolean
          priority?: string
          problem: string
          refreshed_at?: string
          workspace_id: string
        }
        Update: {
          action_href?: string | null
          action_label?: string | null
          category?: string
          created_at?: string
          fix?: string | null
          id?: string
          impact?: string | null
          is_dismissed?: boolean
          priority?: string
          problem?: string
          refreshed_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_recommendations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_scheduled_content: {
        Row: {
          calendar_entry_id: string | null
          channel: string | null
          clicks: number | null
          content_type: string
          created_at: string
          external_url: string | null
          id: string
          impressions: number | null
          leads_generated: number | null
          notes: string | null
          platform_post_id: string | null
          published_date: string | null
          reach: number | null
          title: string
          workspace_id: string
        }
        Insert: {
          calendar_entry_id?: string | null
          channel?: string | null
          clicks?: number | null
          content_type?: string
          created_at?: string
          external_url?: string | null
          id?: string
          impressions?: number | null
          leads_generated?: number | null
          notes?: string | null
          platform_post_id?: string | null
          published_date?: string | null
          reach?: number | null
          title: string
          workspace_id: string
        }
        Update: {
          calendar_entry_id?: string | null
          channel?: string | null
          clicks?: number | null
          content_type?: string
          created_at?: string
          external_url?: string | null
          id?: string
          impressions?: number | null
          leads_generated?: number | null
          notes?: string | null
          platform_post_id?: string | null
          published_date?: string | null
          reach?: number | null
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_scheduled_content_calendar_entry_id_fkey"
            columns: ["calendar_entry_id"]
            isOneToOne: false
            referencedRelation: "growthmind_content_calendar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_scheduled_content_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_seo_briefs: {
        Row: {
          brief: string
          created_at: string
          generated_at: string
          id: string
          meta_desc: string | null
          meta_title: string | null
          page_title: string | null
          score: number | null
          target_kws: string[]
          url: string
          word_count: number | null
          workspace_id: string
        }
        Insert: {
          brief: string
          created_at?: string
          generated_at?: string
          id?: string
          meta_desc?: string | null
          meta_title?: string | null
          page_title?: string | null
          score?: number | null
          target_kws?: string[]
          url: string
          word_count?: number | null
          workspace_id: string
        }
        Update: {
          brief?: string
          created_at?: string
          generated_at?: string
          id?: string
          meta_desc?: string | null
          meta_title?: string | null
          page_title?: string | null
          score?: number | null
          target_kws?: string[]
          url?: string
          word_count?: number | null
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_seo_sites: {
        Row: {
          ai_rec_at: string | null
          ai_recs: Json
          content_ideas: Json
          created_at: string
          id: string
          keywords: Json
          updated_at: string
          url: string
          workspace_id: string
        }
        Insert: {
          ai_rec_at?: string | null
          ai_recs?: Json
          content_ideas?: Json
          created_at?: string
          id?: string
          keywords?: Json
          updated_at?: string
          url: string
          workspace_id: string
        }
        Update: {
          ai_rec_at?: string | null
          ai_recs?: Json
          content_ideas?: Json
          created_at?: string
          id?: string
          keywords?: Json
          updated_at?: string
          url?: string
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_service_scores: {
        Row: {
          computed_at: string
          created_at: string
          id: string
          recommendation: string | null
          scores: Json
          service_name: string
          total_score: number
          workspace_id: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          id?: string
          recommendation?: string | null
          scores?: Json
          service_name: string
          total_score?: number
          workspace_id: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          id?: string
          recommendation?: string | null
          scores?: Json
          service_name?: string
          total_score?: number
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_strategies: {
        Row: {
          ai_calling_plan: string
          campaigns: Json
          channels: Json
          confidence_score: number
          content_plan: string
          core_offer: string
          created_at: string
          email_plan: string
          evidence: string
          expected_outcomes: string
          follow_up_plan: string
          generated_by_model: string | null
          id: string
          kpis: Json
          last_calculated_at: string
          paid_ads_plan: string
          plan_period: string
          primary_angle: string
          seo_plan: string
          source_snapshot: Json
          target_audience: string
          tasks: Json
          whatsapp_plan: string
          workspace_id: string
        }
        Insert: {
          ai_calling_plan?: string
          campaigns?: Json
          channels?: Json
          confidence_score?: number
          content_plan?: string
          core_offer?: string
          created_at?: string
          email_plan?: string
          evidence?: string
          expected_outcomes?: string
          follow_up_plan?: string
          generated_by_model?: string | null
          id?: string
          kpis?: Json
          last_calculated_at?: string
          paid_ads_plan?: string
          plan_period: string
          primary_angle?: string
          seo_plan?: string
          source_snapshot?: Json
          target_audience?: string
          tasks?: Json
          whatsapp_plan?: string
          workspace_id: string
        }
        Update: {
          ai_calling_plan?: string
          campaigns?: Json
          channels?: Json
          confidence_score?: number
          content_plan?: string
          core_offer?: string
          created_at?: string
          email_plan?: string
          evidence?: string
          expected_outcomes?: string
          follow_up_plan?: string
          generated_by_model?: string | null
          id?: string
          kpis?: Json
          last_calculated_at?: string
          paid_ads_plan?: string
          plan_period?: string
          primary_angle?: string
          seo_plan?: string
          source_snapshot?: Json
          target_audience?: string
          tasks?: Json
          whatsapp_plan?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_strategies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_strategy_assets: {
        Row: {
          asset_type: string
          content: string | null
          created_at: string | null
          engine: string
          id: string
          metadata: Json | null
          status: string | null
          strategy_id: string
          title: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          asset_type: string
          content?: string | null
          created_at?: string | null
          engine: string
          id?: string
          metadata?: Json | null
          status?: string | null
          strategy_id: string
          title?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          asset_type?: string
          content?: string | null
          created_at?: string | null
          engine?: string
          id?: string
          metadata?: Json | null
          status?: string | null
          strategy_id?: string
          title?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_strategy_assets_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "growthmind_strategy_centre"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_strategy_centre: {
        Row: {
          ai_calling_plan: string | null
          approval_actions: Json | null
          budget_recommendation: string | null
          campaign_plan: string | null
          channel_recommendation: string[] | null
          confidence_score: number | null
          content_plan: string | null
          created_at: string | null
          email_plan: string | null
          executive_summary: string | null
          expected_outcome: string | null
          generated_by_model: string | null
          hivemind_action_id: string | null
          id: string
          kpis: Json | null
          landing_page_plan: string | null
          prompt_engines_used: string[] | null
          rejection_reason: string | null
          required_assets: Json | null
          risks: string | null
          selected_service: string | null
          seo_plan: string | null
          service_scores: Json | null
          service_selection_reason: string | null
          source_data_snapshot: Json | null
          status: string
          strategy_type: string
          target_audience: string | null
          updated_at: string | null
          user_budget: string | null
          user_goal: string | null
          video_plan: string | null
          whatsapp_plan: string | null
          workspace_id: string
        }
        Insert: {
          ai_calling_plan?: string | null
          approval_actions?: Json | null
          budget_recommendation?: string | null
          campaign_plan?: string | null
          channel_recommendation?: string[] | null
          confidence_score?: number | null
          content_plan?: string | null
          created_at?: string | null
          email_plan?: string | null
          executive_summary?: string | null
          expected_outcome?: string | null
          generated_by_model?: string | null
          hivemind_action_id?: string | null
          id?: string
          kpis?: Json | null
          landing_page_plan?: string | null
          prompt_engines_used?: string[] | null
          rejection_reason?: string | null
          required_assets?: Json | null
          risks?: string | null
          selected_service?: string | null
          seo_plan?: string | null
          service_scores?: Json | null
          service_selection_reason?: string | null
          source_data_snapshot?: Json | null
          status?: string
          strategy_type: string
          target_audience?: string | null
          updated_at?: string | null
          user_budget?: string | null
          user_goal?: string | null
          video_plan?: string | null
          whatsapp_plan?: string | null
          workspace_id: string
        }
        Update: {
          ai_calling_plan?: string | null
          approval_actions?: Json | null
          budget_recommendation?: string | null
          campaign_plan?: string | null
          channel_recommendation?: string[] | null
          confidence_score?: number | null
          content_plan?: string | null
          created_at?: string | null
          email_plan?: string | null
          executive_summary?: string | null
          expected_outcome?: string | null
          generated_by_model?: string | null
          hivemind_action_id?: string | null
          id?: string
          kpis?: Json | null
          landing_page_plan?: string | null
          prompt_engines_used?: string[] | null
          rejection_reason?: string | null
          required_assets?: Json | null
          risks?: string | null
          selected_service?: string | null
          seo_plan?: string | null
          service_scores?: Json | null
          service_selection_reason?: string | null
          source_data_snapshot?: Json | null
          status?: string
          strategy_type?: string
          target_audience?: string | null
          updated_at?: string | null
          user_budget?: string | null
          user_goal?: string | null
          video_plan?: string | null
          whatsapp_plan?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_strategy_tasks: {
        Row: {
          channel: string | null
          created_at: string | null
          description: string | null
          id: string
          priority: string | null
          status: string | null
          strategy_id: string
          title: string
          week_number: number | null
          workspace_id: string
        }
        Insert: {
          channel?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          priority?: string | null
          status?: string | null
          strategy_id: string
          title: string
          week_number?: number | null
          workspace_id: string
        }
        Update: {
          channel?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          priority?: string | null
          status?: string | null
          strategy_id?: string
          title?: string
          week_number?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_strategy_tasks_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "growthmind_strategy_centre"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_tasks: {
        Row: {
          created_at: string
          description: string | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          priority: string
          source: string
          status: string
          title: string
          trigger_type: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          priority?: string
          source?: string
          status?: string
          title: string
          trigger_type?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          priority?: string
          source?: string
          status?: string
          title?: string
          trigger_type?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_trend_signals: {
        Row: {
          action_hint: string | null
          change_percent: number | null
          classification: string
          computed_at: string
          created_at: string
          current_value: number
          id: string
          insight: string | null
          label: string
          previous_value: number
          signal_type: string
          workspace_id: string
        }
        Insert: {
          action_hint?: string | null
          change_percent?: number | null
          classification: string
          computed_at?: string
          created_at?: string
          current_value?: number
          id?: string
          insight?: string | null
          label: string
          previous_value?: number
          signal_type: string
          workspace_id: string
        }
        Update: {
          action_hint?: string | null
          change_percent?: number | null
          classification?: string
          computed_at?: string
          created_at?: string
          current_value?: number
          id?: string
          insight?: string | null
          label?: string
          previous_value?: number
          signal_type?: string
          workspace_id?: string
        }
        Relationships: []
      }
      growthmind_value_points: {
        Row: {
          best_channels: string
          confidence_score: number
          created_at: string
          current_highest_value: string
          evidence: string
          generated_by_model: string | null
          id: string
          last_calculated_at: string
          recommended_campaign: string
          recommended_content: string
          recommended_follow_up: string
          recommended_offer: string
          source_snapshot: Json
          who_to_target: string
          why_it_matters: string
          workspace_id: string
        }
        Insert: {
          best_channels?: string
          confidence_score?: number
          created_at?: string
          current_highest_value: string
          evidence?: string
          generated_by_model?: string | null
          id?: string
          last_calculated_at?: string
          recommended_campaign?: string
          recommended_content?: string
          recommended_follow_up?: string
          recommended_offer?: string
          source_snapshot?: Json
          who_to_target?: string
          why_it_matters?: string
          workspace_id: string
        }
        Update: {
          best_channels?: string
          confidence_score?: number
          created_at?: string
          current_highest_value?: string
          evidence?: string
          generated_by_model?: string | null
          id?: string
          last_calculated_at?: string
          recommended_campaign?: string
          recommended_content?: string
          recommended_follow_up?: string
          recommended_offer?: string
          source_snapshot?: Json
          who_to_target?: string
          why_it_matters?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_value_points_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_video_assets: {
        Row: {
          actual_duration_seconds: number | null
          aspect_ratio: string | null
          assembly_error: string | null
          assembly_status: string | null
          audio_url: string | null
          business_name: string | null
          campaign_id: string | null
          cost_estimate: number
          created_at: string
          creative_score: Json | null
          final_video_url: string | null
          generation_mode: string | null
          has_audio: boolean | null
          id: string
          is_composite: boolean | null
          knowledge_context_id: string | null
          knowledge_context_name: string | null
          knowledge_context_type: string | null
          optimized_prompt: string | null
          original_prompt: string | null
          platform: string | null
          provider: string | null
          quality_checks: Json | null
          quality_mode: string
          requested_duration_seconds: number | null
          scheduled_at: string | null
          script: string
          storyboard: Json
          title: string
          variant_group_id: string | null
          variant_type: string | null
          video_type: string
          video_url: string | null
          voice_id: string | null
          workspace_id: string
        }
        Insert: {
          actual_duration_seconds?: number | null
          aspect_ratio?: string | null
          assembly_error?: string | null
          assembly_status?: string | null
          audio_url?: string | null
          business_name?: string | null
          campaign_id?: string | null
          cost_estimate?: number
          created_at?: string
          creative_score?: Json | null
          final_video_url?: string | null
          generation_mode?: string | null
          has_audio?: boolean | null
          id?: string
          is_composite?: boolean | null
          knowledge_context_id?: string | null
          knowledge_context_name?: string | null
          knowledge_context_type?: string | null
          optimized_prompt?: string | null
          original_prompt?: string | null
          platform?: string | null
          provider?: string | null
          quality_checks?: Json | null
          quality_mode?: string
          requested_duration_seconds?: number | null
          scheduled_at?: string | null
          script?: string
          storyboard?: Json
          title: string
          variant_group_id?: string | null
          variant_type?: string | null
          video_type: string
          video_url?: string | null
          voice_id?: string | null
          workspace_id: string
        }
        Update: {
          actual_duration_seconds?: number | null
          aspect_ratio?: string | null
          assembly_error?: string | null
          assembly_status?: string | null
          audio_url?: string | null
          business_name?: string | null
          campaign_id?: string | null
          cost_estimate?: number
          created_at?: string
          creative_score?: Json | null
          final_video_url?: string | null
          generation_mode?: string | null
          has_audio?: boolean | null
          id?: string
          is_composite?: boolean | null
          knowledge_context_id?: string | null
          knowledge_context_name?: string | null
          knowledge_context_type?: string | null
          optimized_prompt?: string | null
          original_prompt?: string | null
          platform?: string | null
          provider?: string | null
          quality_checks?: Json | null
          quality_mode?: string
          requested_duration_seconds?: number | null
          scheduled_at?: string | null
          script?: string
          storyboard?: Json
          title?: string
          variant_group_id?: string | null
          variant_type?: string | null
          video_type?: string
          video_url?: string | null
          voice_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_video_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_video_clips: {
        Row: {
          archived_video_url: string | null
          asset_id: string
          created_at: string | null
          duration_seconds: number | null
          error_message: string | null
          id: string
          provider: string | null
          provider_job_id: string | null
          raw_video_url: string | null
          scene_index: number
          scene_prompt: string | null
          scene_title: string | null
          status: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          archived_video_url?: string | null
          asset_id: string
          created_at?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          provider?: string | null
          provider_job_id?: string | null
          raw_video_url?: string | null
          scene_index: number
          scene_prompt?: string | null
          scene_title?: string | null
          status?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          archived_video_url?: string | null
          asset_id?: string
          created_at?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          provider?: string | null
          provider_job_id?: string | null
          raw_video_url?: string | null
          scene_index?: number
          scene_prompt?: string | null
          scene_title?: string | null
          status?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_video_clips_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "growthmind_video_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_video_performance: {
        Row: {
          appointments: number
          campaign_id: string | null
          clicks: number
          cost_gbp: number | null
          created_at: string
          ctr_pct: number | null
          id: string
          leads: number
          notes: string | null
          platform: string
          recorded_at: string
          revenue_gbp: number | null
          roas: number | null
          video_asset_id: string
          views: number
          watch_time_avg_s: number | null
          workspace_id: string
        }
        Insert: {
          appointments?: number
          campaign_id?: string | null
          clicks?: number
          cost_gbp?: number | null
          created_at?: string
          ctr_pct?: number | null
          id?: string
          leads?: number
          notes?: string | null
          platform?: string
          recorded_at?: string
          revenue_gbp?: number | null
          roas?: number | null
          video_asset_id: string
          views?: number
          watch_time_avg_s?: number | null
          workspace_id: string
        }
        Update: {
          appointments?: number
          campaign_id?: string | null
          clicks?: number
          cost_gbp?: number | null
          created_at?: string
          ctr_pct?: number | null
          id?: string
          leads?: number
          notes?: string | null
          platform?: string
          recorded_at?: string
          revenue_gbp?: number | null
          roas?: number | null
          video_asset_id?: string
          views?: number
          watch_time_avg_s?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growthmind_video_performance_video_asset_id_fkey"
            columns: ["video_asset_id"]
            isOneToOne: false
            referencedRelation: "growthmind_video_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growthmind_video_performance_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      growthmind_video_proposals: {
        Row: {
          call_to_action: string | null
          created_at: string
          creative_angles: string[]
          duration: string | null
          expected_outcome: string | null
          generated_at: string
          hook: string | null
          id: string
          platform: string | null
          status: string
          storyboard: string | null
          target_audience: string | null
          title: string
          workspace_id: string
        }
        Insert: {
          call_to_action?: string | null
          created_at?: string
          creative_angles?: string[]
          duration?: string | null
          expected_outcome?: string | null
          generated_at?: string
          hook?: string | null
          id?: string
          platform?: string | null
          status?: string
          storyboard?: string | null
          target_audience?: string | null
          title: string
          workspace_id: string
        }
        Update: {
          call_to_action?: string | null
          created_at?: string
          creative_angles?: string[]
          duration?: string | null
          expected_outcome?: string | null
          generated_at?: string
          hook?: string | null
          id?: string
          platform?: string | null
          status?: string
          storyboard?: string | null
          target_audience?: string | null
          title?: string
          workspace_id?: string
        }
        Relationships: []
      }
      hexmail_campaign_enrollments: {
        Row: {
          campaign_id: string
          created_at: string
          current_day: number
          enrolled_at: string
          id: string
          last_executed: string | null
          lead_id: string
          notes: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          current_day?: number
          enrolled_at?: string
          id?: string
          last_executed?: string | null
          lead_id: string
          notes?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          current_day?: number
          enrolled_at?: string
          id?: string
          last_executed?: string | null
          lead_id?: string
          notes?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hexmail_campaign_enrollments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "hexmail_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hexmail_campaign_enrollments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hexmail_campaign_enrollments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      hexmail_campaign_steps: {
        Row: {
          actions: Json
          campaign_id: string
          created_at: string
          day_number: number
          id: string
        }
        Insert: {
          actions?: Json
          campaign_id: string
          created_at?: string
          day_number: number
          id?: string
        }
        Update: {
          actions?: Json
          campaign_id?: string
          created_at?: string
          day_number?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hexmail_campaign_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "hexmail_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      hexmail_campaigns: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          name: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      hexmail_templates: {
        Row: {
          content: string
          created_at: string
          id: string
          name: string
          status: string
          subject: string | null
          type: string
          updated_at: string
          usage_count: number
          workspace_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          name: string
          status?: string
          subject?: string | null
          type: string
          updated_at?: string
          usage_count?: number
          workspace_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          name?: string
          status?: string
          subject?: string | null
          type?: string
          updated_at?: string
          usage_count?: number
          workspace_id?: string
        }
        Relationships: []
      }
      hivemind_actions: {
        Row: {
          action_payload: Json
          action_type: string
          approved_by: string | null
          created_at: string
          description: string | null
          error_message: string | null
          executed_at: string | null
          id: string
          proposed_by: string
          result: Json | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          action_payload?: Json
          action_type: string
          approved_by?: string | null
          created_at?: string
          description?: string | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          proposed_by?: string
          result?: Json | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          action_payload?: Json
          action_type?: string
          approved_by?: string | null
          created_at?: string
          description?: string | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          proposed_by?: string
          result?: Json | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      hivemind_briefings: {
        Row: {
          created_at: string
          generated_by: string
          id: string
          is_read: boolean
          meta: Json
          sections: Json
          summary: string
          title: string
          type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          generated_by?: string
          id?: string
          is_read?: boolean
          meta?: Json
          sections?: Json
          summary?: string
          title: string
          type?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          generated_by?: string
          id?: string
          is_read?: boolean
          meta?: Json
          sections?: Json
          summary?: string
          title?: string
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hivemind_briefings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      hivemind_events: {
        Row: {
          created_at: string
          description: string | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string | null
          event_type: string
          id: string
          is_read: boolean
          severity: string
          task_id: string | null
          title: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          is_read?: boolean
          severity?: string
          task_id?: string | null
          title: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          is_read?: boolean
          severity?: string
          task_id?: string | null
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hivemind_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "hivemind_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      hivemind_tasks: {
        Row: {
          assigned_to: string | null
          comments: Json
          created_at: string
          description: string | null
          due_date: string | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          priority: string
          source: string
          status: string
          title: string
          trigger_type: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          comments?: Json
          created_at?: string
          description?: string | null
          due_date?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          priority?: string
          source?: string
          status?: string
          title: string
          trigger_type?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_to?: string | null
          comments?: Json
          created_at?: string
          description?: string | null
          due_date?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          priority?: string
          source?: string
          status?: string
          title?: string
          trigger_type?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      lead_email_log: {
        Row: {
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          lead_id: string
          message_id: string | null
          provider: string | null
          status: string
          subject: string | null
          template_id: string | null
          to_email: string
          trigger: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          lead_id: string
          message_id?: string | null
          provider?: string | null
          status?: string
          subject?: string | null
          template_id?: string | null
          to_email: string
          trigger?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          lead_id?: string
          message_id?: string | null
          provider?: string | null
          status?: string
          subject?: string | null
          template_id?: string | null
          to_email?: string
          trigger?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_email_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_email_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          attempt_count: number
          bank_statements_status: string | null
          bank_statements_uploaded: boolean
          budget_confirmed: boolean | null
          business_address: string | null
          business_type: string | null
          buying_intent: string | null
          call_outcome: string | null
          call_summary: string | null
          callback_date: string | null
          callback_requested: boolean
          company_name: string | null
          created_at: string
          decision_maker: boolean | null
          decision_maker_status: string | null
          email: string | null
          external_source_id: string | null
          full_name: string | null
          funding_amount: number | null
          id: string
          interest_level: string | null
          last_contacted_at: string | null
          lead_score: number | null
          meeting_requested: boolean
          meta: Json
          missing_information: string | null
          monthly_revenue: number | null
          next_action: string | null
          next_step: string | null
          notes: string | null
          objections: string | null
          phone: string
          pipeline_stage: string | null
          qualification_score: number | null
          qualification_status: string | null
          referrer: string | null
          sale_amount: number | null
          scheduled_agent_id: string | null
          scheduled_call_at: string | null
          scheduled_from_number: string | null
          sent_to_underwriting: boolean
          sentiment: Database["public"]["Enums"]["sentiment_kind"] | null
          source: Database["public"]["Enums"]["lead_source"]
          source_detail: string | null
          source_page: string | null
          source_type: string | null
          state_name: string | null
          status: Database["public"]["Enums"]["lead_status"]
          type: string | null
          updated_at: string
          urgency: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          workspace_id: string
        }
        Insert: {
          attempt_count?: number
          bank_statements_status?: string | null
          bank_statements_uploaded?: boolean
          budget_confirmed?: boolean | null
          business_address?: string | null
          business_type?: string | null
          buying_intent?: string | null
          call_outcome?: string | null
          call_summary?: string | null
          callback_date?: string | null
          callback_requested?: boolean
          company_name?: string | null
          created_at?: string
          decision_maker?: boolean | null
          decision_maker_status?: string | null
          email?: string | null
          external_source_id?: string | null
          full_name?: string | null
          funding_amount?: number | null
          id?: string
          interest_level?: string | null
          last_contacted_at?: string | null
          lead_score?: number | null
          meeting_requested?: boolean
          meta?: Json
          missing_information?: string | null
          monthly_revenue?: number | null
          next_action?: string | null
          next_step?: string | null
          notes?: string | null
          objections?: string | null
          phone: string
          pipeline_stage?: string | null
          qualification_score?: number | null
          qualification_status?: string | null
          referrer?: string | null
          sale_amount?: number | null
          scheduled_agent_id?: string | null
          scheduled_call_at?: string | null
          scheduled_from_number?: string | null
          sent_to_underwriting?: boolean
          sentiment?: Database["public"]["Enums"]["sentiment_kind"] | null
          source?: Database["public"]["Enums"]["lead_source"]
          source_detail?: string | null
          source_page?: string | null
          source_type?: string | null
          state_name?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          type?: string | null
          updated_at?: string
          urgency?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          workspace_id: string
        }
        Update: {
          attempt_count?: number
          bank_statements_status?: string | null
          bank_statements_uploaded?: boolean
          budget_confirmed?: boolean | null
          business_address?: string | null
          business_type?: string | null
          buying_intent?: string | null
          call_outcome?: string | null
          call_summary?: string | null
          callback_date?: string | null
          callback_requested?: boolean
          company_name?: string | null
          created_at?: string
          decision_maker?: boolean | null
          decision_maker_status?: string | null
          email?: string | null
          external_source_id?: string | null
          full_name?: string | null
          funding_amount?: number | null
          id?: string
          interest_level?: string | null
          last_contacted_at?: string | null
          lead_score?: number | null
          meeting_requested?: boolean
          meta?: Json
          missing_information?: string | null
          monthly_revenue?: number | null
          next_action?: string | null
          next_step?: string | null
          notes?: string | null
          objections?: string | null
          phone?: string
          pipeline_stage?: string | null
          qualification_score?: number | null
          qualification_status?: string | null
          referrer?: string | null
          sale_amount?: number | null
          scheduled_agent_id?: string | null
          scheduled_call_at?: string | null
          scheduled_from_number?: string | null
          sent_to_underwriting?: boolean
          sentiment?: Database["public"]["Enums"]["sentiment_kind"] | null
          source?: Database["public"]["Enums"]["lead_source"]
          source_detail?: string | null
          source_page?: string | null
          source_type?: string | null
          state_name?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          type?: string | null
          updated_at?: string
          urgency?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_scheduled_agent_id_fkey"
            columns: ["scheduled_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      live_call_sessions: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          call_status: string
          call_type: string | null
          created_at: string
          direction: string | null
          ended_at: string | null
          from_number: string | null
          id: string
          retell_call_id: string
          started_at: string | null
          to_number: string | null
          transcript: Json
          transcript_len: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          call_status?: string
          call_type?: string | null
          created_at?: string
          direction?: string | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          retell_call_id: string
          started_at?: string | null
          to_number?: string | null
          transcript?: Json
          transcript_len?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          call_status?: string
          call_type?: string | null
          created_at?: string
          direction?: string | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          retell_call_id?: string
          started_at?: string | null
          to_number?: string | null
          transcript?: Json
          transcript_len?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      module_upgrade_requests: {
        Row: {
          created_at: string
          id: string
          module_id: string
          module_name: string
          notes: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          module_id: string
          module_name: string
          notes?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          module_id?: string
          module_name?: string
          notes?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_upgrade_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_numbers: {
        Row: {
          agent_id: string | null
          capabilities: Json
          created_at: string
          friendly_name: string | null
          id: string
          is_active: boolean
          phone_number: string
          provider: string
          provider_sid: string | null
          telephony_config_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          capabilities?: Json
          created_at?: string
          friendly_name?: string | null
          id?: string
          is_active?: boolean
          phone_number: string
          provider?: string
          provider_sid?: string | null
          telephony_config_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          capabilities?: Json
          created_at?: string
          friendly_name?: string | null
          id?: string
          is_active?: boolean
          phone_number?: string
          provider?: string
          provider_sid?: string | null
          telephony_config_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_numbers_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_numbers_telephony_config_id_fkey"
            columns: ["telephony_config_id"]
            isOneToOne: false
            referencedRelation: "telephony_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_numbers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      production_webhook_updates: {
        Row: {
          created_at: string
          error: string | null
          id: string
          new_url: string
          old_url: string | null
          provider: string
          status: string
          triggered_by: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          new_url: string
          old_url?: string | null
          provider: string
          status: string
          triggered_by?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          new_url?: string
          old_url?: string | null
          provider?: string
          status?: string
          triggered_by?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_webhook_updates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_settings"
            referencedColumns: ["workspace_id"]
          },
        ]
      }
      profiles: {
        Row: {
          admin_reviewed_at: string | null
          admin_reviewed_by: string | null
          approval_decided_at: string | null
          approval_token: string
          approved: boolean
          created_at: string
          default_workspace_id: string | null
          denied: boolean
          email: string
          full_name: string | null
          id: string
          retell_go_live_override: boolean
          retell_live_enabled: boolean
          retell_production_api_key: string | null
          retell_provisioned_at: string | null
          retell_workspace_external_id: string | null
          spend_limit_cents: number
          spend_used_cents: number
          updated_at: string
          user_id: string
          user_type: Database["public"]["Enums"]["user_type"]
        }
        Insert: {
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          approval_decided_at?: string | null
          approval_token?: string
          approved?: boolean
          created_at?: string
          default_workspace_id?: string | null
          denied?: boolean
          email: string
          full_name?: string | null
          id?: string
          retell_go_live_override?: boolean
          retell_live_enabled?: boolean
          retell_production_api_key?: string | null
          retell_provisioned_at?: string | null
          retell_workspace_external_id?: string | null
          spend_limit_cents?: number
          spend_used_cents?: number
          updated_at?: string
          user_id: string
          user_type?: Database["public"]["Enums"]["user_type"]
        }
        Update: {
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          approval_decided_at?: string | null
          approval_token?: string
          approved?: boolean
          created_at?: string
          default_workspace_id?: string | null
          denied?: boolean
          email?: string
          full_name?: string | null
          id?: string
          retell_go_live_override?: boolean
          retell_live_enabled?: boolean
          retell_production_api_key?: string | null
          retell_provisioned_at?: string | null
          retell_workspace_external_id?: string | null
          spend_limit_cents?: number
          spend_used_cents?: number
          updated_at?: string
          user_id?: string
          user_type?: Database["public"]["Enums"]["user_type"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_workspace_id_fkey"
            columns: ["default_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_cost_rates: {
        Row: {
          cost_per_unit_usd: number
          created_at: string
          currency: string
          id: string
          notes: string | null
          provider_category: string
          provider_name: string
          unit_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cost_per_unit_usd?: number
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          provider_category: string
          provider_name: string
          unit_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cost_per_unit_usd?: number
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          provider_category?: string
          provider_name?: string
          unit_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_cost_rates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_credential_audit: {
        Row: {
          action: string
          created_at: string
          id: string
          latency_ms: number | null
          provider_category: string
          provider_name: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          provider_category: string
          provider_name: string
          user_id: string
          workspace_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          provider_category?: string
          provider_name?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_credential_audit_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_recharge_events: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          description: string | null
          detected_at: string
          event_type: string
          id: string
          provider_category: string
          provider_name: string
          raw_payload: Json | null
          source: string
          workspace_id: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          currency?: string
          description?: string | null
          detected_at?: string
          event_type?: string
          id?: string
          provider_category: string
          provider_name: string
          raw_payload?: Json | null
          source?: string
          workspace_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          description?: string | null
          detected_at?: string
          event_type?: string
          id?: string
          provider_category?: string
          provider_name?: string
          raw_payload?: Json | null
          source?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_recharge_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_settings: {
        Row: {
          created_at: string
          credentials: Json
          id: string
          is_default: boolean
          is_fallback: boolean
          last_sync: string | null
          priority: number
          provider_category: string
          provider_name: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          credentials?: Json
          id?: string
          is_default?: boolean
          is_fallback?: boolean
          last_sync?: string | null
          priority?: number
          provider_category: string
          provider_name: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          credentials?: Json
          id?: string
          is_default?: boolean
          is_fallback?: boolean
          last_sync?: string | null
          priority?: number
          provider_category?: string
          provider_name?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_usage: {
        Row: {
          cost_per_unit_usd: number | null
          created_at: string
          errors: number
          id: string
          last_used_at: string | null
          provider_category: string
          provider_name: string
          requests: number
          total_cost_usd: number
          total_duration_ms: number
          unit_type: string | null
          units_consumed: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cost_per_unit_usd?: number | null
          created_at?: string
          errors?: number
          id?: string
          last_used_at?: string | null
          provider_category: string
          provider_name: string
          requests?: number
          total_cost_usd?: number
          total_duration_ms?: number
          unit_type?: string | null
          units_consumed?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cost_per_unit_usd?: number | null
          created_at?: string
          errors?: number
          id?: string
          last_used_at?: string | null
          provider_category?: string
          provider_name?: string
          requests?: number
          total_cost_usd?: number
          total_duration_ms?: number
          unit_type?: string | null
          units_consumed?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_usage_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_usage_log: {
        Row: {
          cost_usd: number
          created_at: string
          duration_ms: number
          errors: number
          id: string
          provider_category: string
          provider_name: string
          requests: number
          workspace_id: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          duration_ms?: number
          errors?: number
          id?: string
          provider_category: string
          provider_name: string
          requests?: number
          workspace_id: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          duration_ms?: number
          errors?: number
          id?: string
          provider_category?: string
          provider_name?: string
          requests?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_usage_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      retell_webhook_events: {
        Row: {
          error_message: string | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          processing_status: string
          received_at: string
          retell_agent_id: string | null
          retell_call_id: string | null
          signature_valid: boolean | null
          workspace_id: string | null
        }
        Insert: {
          error_message?: string | null
          event_type: string
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          retell_agent_id?: string | null
          retell_call_id?: string | null
          signature_valid?: boolean | null
          workspace_id?: string | null
        }
        Update: {
          error_message?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          retell_agent_id?: string | null
          retell_call_id?: string | null
          signature_valid?: boolean | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retell_webhook_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      seat_overage_events: {
        Row: {
          active_users: number
          billing_period: string
          created_at: string
          extra_users: number
          id: string
          included_users: number
          price_per_user_pence: number
          stripe_invoice_item_id: string | null
          total_pence: number
          workspace_id: string
        }
        Insert: {
          active_users: number
          billing_period: string
          created_at?: string
          extra_users?: number
          id?: string
          included_users: number
          price_per_user_pence: number
          stripe_invoice_item_id?: string | null
          total_pence?: number
          workspace_id: string
        }
        Update: {
          active_users?: number
          billing_period?: string
          created_at?: string
          extra_users?: number
          id?: string
          included_users?: number
          price_per_user_pence?: number
          stripe_invoice_item_id?: string | null
          total_pence?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seat_overage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string
          product_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id: string
          product_id: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string
          product_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      sync_state: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          last_attempted_sync_at: string | null
          last_cursor: string | null
          last_external_updated_at: string | null
          last_successful_sync_at: string | null
          module: string
          records_created: number | null
          records_skipped: number | null
          records_updated: number | null
          source_name: string
          sync_status: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_attempted_sync_at?: string | null
          last_cursor?: string | null
          last_external_updated_at?: string | null
          last_successful_sync_at?: string | null
          module: string
          records_created?: number | null
          records_skipped?: number | null
          records_updated?: number | null
          source_name: string
          sync_status?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_attempted_sync_at?: string | null
          last_cursor?: string | null
          last_external_updated_at?: string | null
          last_successful_sync_at?: string | null
          module?: string
          records_created?: number | null
          records_skipped?: number | null
          records_updated?: number | null
          source_name?: string
          sync_status?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      systemmind_audit_logs: {
        Row: {
          action_type: string
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          before_state: Json | null
          created_at: string
          error: string | null
          executed_at: string | null
          final_after_state: Json | null
          id: string
          instructed_by: string
          proposed_after_state: Json | null
          source_agent: string
          target_id: string | null
          target_type: string | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          action_type: string
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          before_state?: Json | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          final_after_state?: Json | null
          id?: string
          instructed_by?: string
          proposed_after_state?: Json | null
          source_agent?: string
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          action_type?: string
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          before_state?: Json | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          final_after_state?: Json | null
          id?: string
          instructed_by?: string
          proposed_after_state?: Json | null
          source_agent?: string
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      systemmind_audits: {
        Row: {
          completed_at: string | null
          created_at: string
          findings: Json
          id: string
          score: number | null
          status: string
          summary: Json
          triggered_by: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          findings?: Json
          id?: string
          score?: number | null
          status?: string
          summary?: Json
          triggered_by?: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          findings?: Json
          id?: string
          score?: number | null
          status?: string
          summary?: Json
          triggered_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_audits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_build_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
          user_id: string | null
          version_id: string | null
          workspace_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          role: string
          session_id: string
          user_id?: string | null
          version_id?: string | null
          workspace_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          user_id?: string | null
          version_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_build_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "systemmind_build_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_build_sessions: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          current_version_id: string | null
          id: string
          is_deleted: boolean
          linked_workflow_id: string | null
          source_page: string
          status: string
          target_agent_id: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          current_version_id?: string | null
          id?: string
          is_deleted?: boolean
          linked_workflow_id?: string | null
          source_page?: string
          status?: string
          target_agent_id?: string | null
          title?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          current_version_id?: string | null
          id?: string
          is_deleted?: boolean
          linked_workflow_id?: string | null
          source_page?: string
          status?: string
          target_agent_id?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      systemmind_build_versions: {
        Row: {
          applied_at: string | null
          applied_workflow_id: string | null
          assistant_summary: string | null
          created_at: string
          created_by_user_id: string | null
          deployed_at: string | null
          generated_config: Json
          hub_action_id: string | null
          id: string
          model_id: string | null
          model_provider: string | null
          notes: string | null
          restored_from_version_id: string | null
          risk_level: string
          risk_reasons: Json
          session_id: string
          status: string
          updated_at: string
          user_prompt: string | null
          version_number: number
          workspace_id: string
        }
        Insert: {
          applied_at?: string | null
          applied_workflow_id?: string | null
          assistant_summary?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deployed_at?: string | null
          generated_config?: Json
          hub_action_id?: string | null
          id?: string
          model_id?: string | null
          model_provider?: string | null
          notes?: string | null
          restored_from_version_id?: string | null
          risk_level?: string
          risk_reasons?: Json
          session_id: string
          status?: string
          updated_at?: string
          user_prompt?: string | null
          version_number: number
          workspace_id: string
        }
        Update: {
          applied_at?: string | null
          applied_workflow_id?: string | null
          assistant_summary?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deployed_at?: string | null
          generated_config?: Json
          hub_action_id?: string | null
          id?: string
          model_id?: string | null
          model_provider?: string | null
          notes?: string | null
          restored_from_version_id?: string | null
          risk_level?: string
          risk_reasons?: Json
          session_id?: string
          status?: string
          updated_at?: string
          user_prompt?: string | null
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_build_versions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "systemmind_build_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_deployment_plans: {
        Row: {
          confidence: number | null
          created_at: string
          created_by: string | null
          estimated_minutes: number | null
          execution_status: string
          generated_by: string
          id: string
          plan: Json
          request_text: string
          required_template_ids: string[]
          risk_rating: string | null
          status: string
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          estimated_minutes?: number | null
          execution_status?: string
          generated_by?: string
          id?: string
          plan?: Json
          request_text: string
          required_template_ids?: string[]
          risk_rating?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          estimated_minutes?: number | null
          execution_status?: string
          generated_by?: string
          id?: string
          plan?: Json
          request_text?: string
          required_template_ids?: string[]
          risk_rating?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_deployment_plans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_fix_plans: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          source_id: string | null
          source_type: string | null
          status: string
          steps: Json
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          source_id?: string | null
          source_type?: string | null
          status?: string
          steps?: Json
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          source_id?: string | null
          source_type?: string | null
          status?: string
          steps?: Json
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_fix_plans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_generated_actions: {
        Row: {
          action_kind: string
          activated_at: string | null
          activated_target_id: string | null
          activated_target_type: string | null
          approval_required: boolean
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by_user_id: string | null
          error_message: string | null
          hivemind_action_id: string | null
          id: string
          instructed_by: string
          is_deleted: boolean
          model_id: string | null
          model_provider: string | null
          payload: Json
          previous_version_id: string | null
          purpose: string | null
          required_credentials: Json
          risk_level: string
          risk_reasons: Json
          run_id: string | null
          source: string
          status: string
          test_plan: Json
          title: string
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          action_kind?: string
          activated_at?: string | null
          activated_target_id?: string | null
          activated_target_type?: string | null
          approval_required?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by_user_id?: string | null
          error_message?: string | null
          hivemind_action_id?: string | null
          id?: string
          instructed_by?: string
          is_deleted?: boolean
          model_id?: string | null
          model_provider?: string | null
          payload?: Json
          previous_version_id?: string | null
          purpose?: string | null
          required_credentials?: Json
          risk_level?: string
          risk_reasons?: Json
          run_id?: string | null
          source?: string
          status?: string
          test_plan?: Json
          title: string
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          action_kind?: string
          activated_at?: string | null
          activated_target_id?: string | null
          activated_target_type?: string | null
          approval_required?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by_user_id?: string | null
          error_message?: string | null
          hivemind_action_id?: string | null
          id?: string
          instructed_by?: string
          is_deleted?: boolean
          model_id?: string | null
          model_provider?: string | null
          payload?: Json
          previous_version_id?: string | null
          purpose?: string | null
          required_credentials?: Json
          risk_level?: string
          risk_reasons?: Json
          run_id?: string | null
          source?: string
          status?: string
          test_plan?: Json
          title?: string
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_generated_actions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "systemmind_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_graph_builds: {
        Row: {
          built_by: string | null
          created_at: string
          edge_count: number
          errors: Json
          finished_at: string | null
          id: string
          node_count: number
          source_results: Json
          started_at: string
          workspace_id: string
        }
        Insert: {
          built_by?: string | null
          created_at?: string
          edge_count?: number
          errors?: Json
          finished_at?: string | null
          id?: string
          node_count?: number
          source_results?: Json
          started_at?: string
          workspace_id: string
        }
        Update: {
          built_by?: string | null
          created_at?: string
          edge_count?: number
          errors?: Json
          finished_at?: string | null
          id?: string
          node_count?: number
          source_results?: Json
          started_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_graph_builds_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_graph_edges: {
        Row: {
          created_at: string
          edge_type: string
          from_node_id: string
          id: string
          metadata: Json
          to_node_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          edge_type: string
          from_node_id: string
          id?: string
          metadata?: Json
          to_node_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          edge_type?: string
          from_node_id?: string
          id?: string
          metadata?: Json
          to_node_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_graph_edges_from_node_id_fkey"
            columns: ["from_node_id"]
            isOneToOne: false
            referencedRelation: "systemmind_graph_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "systemmind_graph_edges_to_node_id_fkey"
            columns: ["to_node_id"]
            isOneToOne: false
            referencedRelation: "systemmind_graph_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "systemmind_graph_edges_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_graph_nodes: {
        Row: {
          created_at: string
          id: string
          label: string
          metadata: Json
          node_key: string
          node_type: string
          source_id: string | null
          source_table: string | null
          status: string | null
          summary: string | null
          tags: string[]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          metadata?: Json
          node_key: string
          node_type: string
          source_id?: string | null
          source_table?: string | null
          status?: string | null
          summary?: string | null
          tags?: string[]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          metadata?: Json
          node_key?: string
          node_type?: string
          source_id?: string | null
          source_table?: string | null
          status?: string | null
          summary?: string | null
          tags?: string[]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_graph_nodes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_intelligence_settings: {
        Row: {
          autonomous_deployment_enabled: boolean
          confidence_threshold: number
          created_at: string
          id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          autonomous_deployment_enabled?: boolean
          confidence_threshold?: number
          created_at?: string
          id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          autonomous_deployment_enabled?: boolean
          confidence_threshold?: number
          created_at?: string
          id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_intelligence_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_n8n_workflows: {
        Row: {
          active: boolean
          ai_model: string | null
          classification: Json | null
          classified_at: string | null
          classified_by: string | null
          confidence: number | null
          connection_count: number
          discovered_at: string
          folder: string | null
          has_webhook: boolean
          id: string
          integrations: string[]
          metadata: Json
          n8n_created_at: string | null
          n8n_updated_at: string | null
          n8n_workflow_id: string
          name: string
          node_count: number
          node_types: string[]
          raw_snapshot: Json
          tags: string[]
          template_type: string | null
          trigger_types: string[]
          understanding: Json | null
          understood_at: string | null
          updated_at: string
          workflow_category: string | null
          workspace_id: string
        }
        Insert: {
          active?: boolean
          ai_model?: string | null
          classification?: Json | null
          classified_at?: string | null
          classified_by?: string | null
          confidence?: number | null
          connection_count?: number
          discovered_at?: string
          folder?: string | null
          has_webhook?: boolean
          id?: string
          integrations?: string[]
          metadata?: Json
          n8n_created_at?: string | null
          n8n_updated_at?: string | null
          n8n_workflow_id: string
          name?: string
          node_count?: number
          node_types?: string[]
          raw_snapshot?: Json
          tags?: string[]
          template_type?: string | null
          trigger_types?: string[]
          understanding?: Json | null
          understood_at?: string | null
          updated_at?: string
          workflow_category?: string | null
          workspace_id: string
        }
        Update: {
          active?: boolean
          ai_model?: string | null
          classification?: Json | null
          classified_at?: string | null
          classified_by?: string | null
          confidence?: number | null
          connection_count?: number
          discovered_at?: string
          folder?: string | null
          has_webhook?: boolean
          id?: string
          integrations?: string[]
          metadata?: Json
          n8n_created_at?: string | null
          n8n_updated_at?: string | null
          n8n_workflow_id?: string
          name?: string
          node_count?: number
          node_types?: string[]
          raw_snapshot?: Json
          tags?: string[]
          template_type?: string | null
          trigger_types?: string[]
          understanding?: Json | null
          understood_at?: string | null
          updated_at?: string
          workflow_category?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_n8n_workflows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_recommendations: {
        Row: {
          body: string | null
          category: string
          created_at: string
          dismissed_at: string | null
          id: string
          priority: string
          source: string | null
          title: string
          workspace_id: string
        }
        Insert: {
          body?: string | null
          category?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          priority?: string
          source?: string | null
          title: string
          workspace_id: string
        }
        Update: {
          body?: string | null
          category?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          priority?: string
          source?: string | null
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_recommendations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_repair_playbooks: {
        Row: {
          affected_files: string[]
          category: string
          checks: string[]
          created_at: string
          fix_steps: string[]
          id: string
          playbook_key: string
          problem: string
          provider: string | null
          risk_level: string
          rollback_plan: string | null
          symptoms: string[]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          affected_files?: string[]
          category?: string
          checks?: string[]
          created_at?: string
          fix_steps?: string[]
          id?: string
          playbook_key: string
          problem: string
          provider?: string | null
          risk_level?: string
          rollback_plan?: string | null
          symptoms?: string[]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          affected_files?: string[]
          category?: string
          checks?: string[]
          created_at?: string
          fix_steps?: string[]
          id?: string
          playbook_key?: string
          problem?: string
          provider?: string | null
          risk_level?: string
          rollback_plan?: string | null
          symptoms?: string[]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_repair_playbooks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_reports: {
        Row: {
          body: string
          created_at: string
          id: string
          model: string
          title: string
          workspace_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          model?: string
          title: string
          workspace_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          model?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_runs: {
        Row: {
          completed_at: string | null
          cost_usd: number
          created_at: string
          created_by_user_id: string | null
          error: string | null
          fallback_from: string | null
          id: string
          input_description: string | null
          input_tokens: number
          instructed_by: string
          model_id: string | null
          model_provider: string | null
          output_tokens: number
          run_type: string
          started_at: string
          status: string
          updated_at: string
          used_fallback: boolean
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          cost_usd?: number
          created_at?: string
          created_by_user_id?: string | null
          error?: string | null
          fallback_from?: string | null
          id?: string
          input_description?: string | null
          input_tokens?: number
          instructed_by?: string
          model_id?: string | null
          model_provider?: string | null
          output_tokens?: number
          run_type?: string
          started_at?: string
          status?: string
          updated_at?: string
          used_fallback?: boolean
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          cost_usd?: number
          created_at?: string
          created_by_user_id?: string | null
          error?: string | null
          fallback_from?: string | null
          id?: string
          input_description?: string | null
          input_tokens?: number
          instructed_by?: string
          model_id?: string | null
          model_provider?: string | null
          output_tokens?: number
          run_type?: string
          started_at?: string
          status?: string
          updated_at?: string
          used_fallback?: boolean
          workspace_id?: string
        }
        Relationships: []
      }
      systemmind_tasks: {
        Row: {
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          priority: string
          status: string
          tags: string[]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_template_confidence: {
        Row: {
          computed_at: string
          created_at: string
          crm_portability: number
          dependency: number
          deployment_readiness: number
          documentation: number
          id: string
          overall_score: number
          reuse: number
          risk_rating: string
          signals: Json
          template_current_version: number
          template_id: string
          understanding: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          crm_portability?: number
          dependency?: number
          deployment_readiness?: number
          documentation?: number
          id?: string
          overall_score?: number
          reuse?: number
          risk_rating?: string
          signals?: Json
          template_current_version?: number
          template_id: string
          understanding?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          crm_portability?: number
          dependency?: number
          deployment_readiness?: number
          documentation?: number
          id?: string
          overall_score?: number
          reuse?: number
          risk_rating?: string
          signals?: Json
          template_current_version?: number
          template_id?: string
          understanding?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_template_confidence_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: true
            referencedRelation: "systemmind_workflow_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "systemmind_template_confidence_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_template_versions: {
        Row: {
          change_note: string | null
          created_at: string
          created_by: string | null
          id: string
          snapshot: Json
          status: string | null
          template_id: string
          version: number
          workspace_id: string
        }
        Insert: {
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          snapshot?: Json
          status?: string | null
          template_id: string
          version: number
          workspace_id: string
        }
        Update: {
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          snapshot?: Json
          status?: string | null
          template_id?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "systemmind_workflow_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "systemmind_template_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_usage_events: {
        Row: {
          billable_units: number
          billing_status: string
          cached_tokens: number
          completed_at: string | null
          completion_tokens: number
          created_at: string
          customer_charge_usd: number
          elapsed_ms: number
          error: string | null
          estimated_provider_cost_usd: number
          id: string
          model_id: string | null
          model_provider: string | null
          pricing_config_id: string | null
          prompt_tokens: number
          session_id: string | null
          source_page: string
          started_at: string | null
          success: boolean
          task_type: string
          tool_call_count: number
          total_tokens: number
          user_id: string | null
          version_id: string | null
          workflow_id: string | null
          workspace_id: string
        }
        Insert: {
          billable_units?: number
          billing_status?: string
          cached_tokens?: number
          completed_at?: string | null
          completion_tokens?: number
          created_at?: string
          customer_charge_usd?: number
          elapsed_ms?: number
          error?: string | null
          estimated_provider_cost_usd?: number
          id?: string
          model_id?: string | null
          model_provider?: string | null
          pricing_config_id?: string | null
          prompt_tokens?: number
          session_id?: string | null
          source_page?: string
          started_at?: string | null
          success?: boolean
          task_type?: string
          tool_call_count?: number
          total_tokens?: number
          user_id?: string | null
          version_id?: string | null
          workflow_id?: string | null
          workspace_id: string
        }
        Update: {
          billable_units?: number
          billing_status?: string
          cached_tokens?: number
          completed_at?: string | null
          completion_tokens?: number
          created_at?: string
          customer_charge_usd?: number
          elapsed_ms?: number
          error?: string | null
          estimated_provider_cost_usd?: number
          id?: string
          model_id?: string | null
          model_provider?: string | null
          pricing_config_id?: string | null
          prompt_tokens?: number
          session_id?: string | null
          source_page?: string
          started_at?: string | null
          success?: boolean
          task_type?: string
          tool_call_count?: number
          total_tokens?: number
          user_id?: string | null
          version_id?: string | null
          workflow_id?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      systemmind_workflow_drafts: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          edges: Json
          follow_up_suggestions: string[]
          generated_by: string
          id: string
          kb_suggestions: string[]
          missing_capabilities_json: Json
          nodes: Json
          required_integrations_json: Json
          source_patterns: string[]
          status: string
          title: string
          tools: Json
          updated_at: string
          validation_results_json: Json
          variables: Json
          webhook_suggestions: Json
          workflow_type: string | null
          workspace_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          edges?: Json
          follow_up_suggestions?: string[]
          generated_by?: string
          id?: string
          kb_suggestions?: string[]
          missing_capabilities_json?: Json
          nodes?: Json
          required_integrations_json?: Json
          source_patterns?: string[]
          status?: string
          title: string
          tools?: Json
          updated_at?: string
          validation_results_json?: Json
          variables?: Json
          webhook_suggestions?: Json
          workflow_type?: string | null
          workspace_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          edges?: Json
          follow_up_suggestions?: string[]
          generated_by?: string
          id?: string
          kb_suggestions?: string[]
          missing_capabilities_json?: Json
          nodes?: Json
          required_integrations_json?: Json
          source_patterns?: string[]
          status?: string
          title?: string
          tools?: Json
          updated_at?: string
          validation_results_json?: Json
          variables?: Json
          webhook_suggestions?: Json
          workflow_type?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_workflow_drafts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_workflow_library: {
        Row: {
          agent_id: string | null
          agent_type: string | null
          category: string | null
          channel: string | null
          created_at: string
          deployment_mode: string | null
          edge_count: number
          flow_snapshot: Json | null
          has_booking: boolean
          has_knowledge_base: boolean
          has_transfer: boolean
          has_webhook: boolean
          id: string
          last_used_at: string | null
          node_count: number
          node_types: string[]
          provider: string | null
          scanned_at: string
          success_score: number | null
          tool_ids: string[]
          workflow_name: string
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          agent_type?: string | null
          category?: string | null
          channel?: string | null
          created_at?: string
          deployment_mode?: string | null
          edge_count?: number
          flow_snapshot?: Json | null
          has_booking?: boolean
          has_knowledge_base?: boolean
          has_transfer?: boolean
          has_webhook?: boolean
          id?: string
          last_used_at?: string | null
          node_count?: number
          node_types?: string[]
          provider?: string | null
          scanned_at?: string
          success_score?: number | null
          tool_ids?: string[]
          workflow_name: string
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          agent_type?: string | null
          category?: string | null
          channel?: string | null
          created_at?: string
          deployment_mode?: string | null
          edge_count?: number
          flow_snapshot?: Json | null
          has_booking?: boolean
          has_knowledge_base?: boolean
          has_transfer?: boolean
          has_webhook?: boolean
          id?: string
          last_used_at?: string | null
          node_count?: number
          node_types?: string[]
          provider?: string | null
          scanned_at?: string
          success_score?: number | null
          tool_ids?: string[]
          workflow_name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_workflow_library_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "systemmind_workflow_library_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_workflow_patterns: {
        Row: {
          booking_pattern: string | null
          category: string
          common_tools: string[]
          common_variables: string[]
          confidence_score: number
          description: string | null
          document_pattern: string | null
          example_workflow_ids: string[]
          generated_at: string
          id: string
          logic_split_pattern: string | null
          node_sequence: string[]
          pattern_name: string
          transfer_pattern: string | null
          workspace_id: string
        }
        Insert: {
          booking_pattern?: string | null
          category: string
          common_tools?: string[]
          common_variables?: string[]
          confidence_score?: number
          description?: string | null
          document_pattern?: string | null
          example_workflow_ids?: string[]
          generated_at?: string
          id?: string
          logic_split_pattern?: string | null
          node_sequence?: string[]
          pattern_name: string
          transfer_pattern?: string | null
          workspace_id: string
        }
        Update: {
          booking_pattern?: string | null
          category?: string
          common_tools?: string[]
          common_variables?: string[]
          confidence_score?: number
          description?: string | null
          document_pattern?: string | null
          example_workflow_ids?: string[]
          generated_at?: string
          id?: string
          logic_split_pattern?: string | null
          node_sequence?: string[]
          pattern_name?: string
          transfer_pattern?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_workflow_patterns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      systemmind_workflow_templates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_purpose: string | null
          business_summary: string | null
          category: string | null
          confidence: number | null
          created_at: string
          created_by: string | null
          current_version: number
          dependencies: string[]
          deployment_variables: Json
          description: string | null
          id: string
          is_trusted: boolean
          known_limitations: string[]
          linked_builder_template_ids: string[]
          linked_n8n_workflow_ids: string[]
          linked_retell_agent_ids: string[]
          name: string
          readiness: string | null
          required_apis: string[]
          required_credentials: string[]
          risk_rating: string | null
          source_kind: string
          status: string
          structure: Json
          supported_agent_providers: string[]
          supported_calendar_providers: string[]
          supported_crm_providers: string[]
          supported_messaging_providers: string[]
          supported_telephony_providers: string[]
          tags: string[]
          technical_summary: string | null
          template_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_purpose?: string | null
          business_summary?: string | null
          category?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          current_version?: number
          dependencies?: string[]
          deployment_variables?: Json
          description?: string | null
          id?: string
          is_trusted?: boolean
          known_limitations?: string[]
          linked_builder_template_ids?: string[]
          linked_n8n_workflow_ids?: string[]
          linked_retell_agent_ids?: string[]
          name: string
          readiness?: string | null
          required_apis?: string[]
          required_credentials?: string[]
          risk_rating?: string | null
          source_kind?: string
          status?: string
          structure?: Json
          supported_agent_providers?: string[]
          supported_calendar_providers?: string[]
          supported_crm_providers?: string[]
          supported_messaging_providers?: string[]
          supported_telephony_providers?: string[]
          tags?: string[]
          technical_summary?: string | null
          template_type?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_purpose?: string | null
          business_summary?: string | null
          category?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          current_version?: number
          dependencies?: string[]
          deployment_variables?: Json
          description?: string | null
          id?: string
          is_trusted?: boolean
          known_limitations?: string[]
          linked_builder_template_ids?: string[]
          linked_n8n_workflow_ids?: string[]
          linked_retell_agent_ids?: string[]
          name?: string
          readiness?: string | null
          required_apis?: string[]
          required_credentials?: string[]
          risk_rating?: string | null
          source_kind?: string
          status?: string
          structure?: Json
          supported_agent_providers?: string[]
          supported_calendar_providers?: string[]
          supported_crm_providers?: string[]
          supported_messaging_providers?: string[]
          supported_telephony_providers?: string[]
          tags?: string[]
          technical_summary?: string | null
          template_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "systemmind_workflow_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      telephony_calls: {
        Row: {
          agent_id: string | null
          answered_at: string | null
          call_sid: string | null
          campaign_id: string | null
          cost_cents: number | null
          created_at: string
          direction: string
          duration_seconds: number | null
          ended_at: string | null
          from_number: string | null
          id: string
          metadata: Json | null
          outcome: string | null
          phone_number_id: string | null
          provider: string
          recording_sid: string | null
          recording_status: string | null
          recording_url: string | null
          started_at: string
          status: string
          to_number: string | null
          transcript: Json | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          answered_at?: string | null
          call_sid?: string | null
          campaign_id?: string | null
          cost_cents?: number | null
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          metadata?: Json | null
          outcome?: string | null
          phone_number_id?: string | null
          provider?: string
          recording_sid?: string | null
          recording_status?: string | null
          recording_url?: string | null
          started_at?: string
          status?: string
          to_number?: string | null
          transcript?: Json | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          answered_at?: string | null
          call_sid?: string | null
          campaign_id?: string | null
          cost_cents?: number | null
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          metadata?: Json | null
          outcome?: string | null
          phone_number_id?: string | null
          provider?: string
          recording_sid?: string | null
          recording_status?: string | null
          recording_url?: string | null
          started_at?: string
          status?: string
          to_number?: string | null
          transcript?: Json | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telephony_calls_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telephony_calls_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telephony_calls_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telephony_calls_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      telephony_configs: {
        Row: {
          account_sid: string | null
          api_key: string | null
          api_secret: string | null
          auth_token: string | null
          created_at: string
          id: string
          is_active: boolean
          provider: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_sid?: string | null
          api_key?: string | null
          api_secret?: string | null
          auth_token?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          provider?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_sid?: string | null
          api_key?: string | null
          api_secret?: string | null
          auth_token?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          provider?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telephony_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          agent_id: string | null
          cost_cents: number
          created_at: string
          environment: string
          id: string
          minutes: number
          model_id: string | null
          occurred_at: string
          retell_call_id: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          agent_id?: string | null
          cost_cents?: number
          created_at?: string
          environment?: string
          id?: string
          minutes?: number
          model_id?: string | null
          occurred_at?: string
          retell_call_id?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string | null
          cost_cents?: number
          created_at?: string
          environment?: string
          id?: string
          minutes?: number
          model_id?: string | null
          occurred_at?: string
          retell_call_id?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wati_campaigns: {
        Row: {
          broadcast_name: string | null
          delivered: number | null
          failed: number | null
          id: string
          name: string
          read_count: number | null
          sent: number | null
          status: string | null
          synced_at: string | null
          template_name: string | null
          wati_campaign_id: string
          workspace_id: string
        }
        Insert: {
          broadcast_name?: string | null
          delivered?: number | null
          failed?: number | null
          id?: string
          name: string
          read_count?: number | null
          sent?: number | null
          status?: string | null
          synced_at?: string | null
          template_name?: string | null
          wati_campaign_id: string
          workspace_id: string
        }
        Update: {
          broadcast_name?: string | null
          delivered?: number | null
          failed?: number | null
          id?: string
          name?: string
          read_count?: number | null
          sent?: number | null
          status?: string | null
          synced_at?: string | null
          template_name?: string | null
          wati_campaign_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      wati_connections: {
        Row: {
          api_key: string
          created_at: string | null
          error_message: string | null
          id: string
          last_tested_at: string | null
          status: string
          tenant_id: string
          updated_at: string | null
          webhook_secret: string | null
          workspace_id: string
        }
        Insert: {
          api_key: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_tested_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string | null
          webhook_secret?: string | null
          workspace_id: string
        }
        Update: {
          api_key?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_tested_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string | null
          webhook_secret?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      wati_contacts: {
        Row: {
          id: string
          name: string | null
          opted_in: boolean | null
          phone: string
          synced_at: string | null
          tags: string[] | null
          wati_contact_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          name?: string | null
          opted_in?: boolean | null
          phone: string
          synced_at?: string | null
          tags?: string[] | null
          wati_contact_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          name?: string | null
          opted_in?: boolean | null
          phone?: string
          synced_at?: string | null
          tags?: string[] | null
          wati_contact_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      wati_sync_logs: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          records_synced: number | null
          status: string
          sync_type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          records_synced?: number | null
          status: string
          sync_type: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          records_synced?: number | null
          status?: string
          sync_type?: string
          workspace_id?: string
        }
        Relationships: []
      }
      wati_templates: {
        Row: {
          category: string | null
          components: Json | null
          id: string
          language: string | null
          name: string
          status: string | null
          synced_at: string | null
          wati_template_id: string
          workspace_id: string
        }
        Insert: {
          category?: string | null
          components?: Json | null
          id?: string
          language?: string | null
          name: string
          status?: string | null
          synced_at?: string | null
          wati_template_id: string
          workspace_id: string
        }
        Update: {
          category?: string | null
          components?: Json | null
          id?: string
          language?: string | null
          name?: string
          status?: string | null
          synced_at?: string | null
          wati_template_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      wbah_calls: {
        Row: {
          agent_name: string | null
          appointment_date: string | null
          appointment_time: string | null
          booking_status: string | null
          calendly_booking_url: string | null
          call_count: number | null
          call_status: string | null
          call_summary: string | null
          call_type: string | null
          customer_name: string | null
          disconnection_reason: string | null
          duration_seconds: number | null
          end_reason: string | null
          id: string
          meta: Json | null
          phone: string | null
          recording_url: string | null
          sentiment: string | null
          started_at: string | null
          synced_at: string | null
          transcript: string | null
          workspace_id: string
        }
        Insert: {
          agent_name?: string | null
          appointment_date?: string | null
          appointment_time?: string | null
          booking_status?: string | null
          calendly_booking_url?: string | null
          call_count?: number | null
          call_status?: string | null
          call_summary?: string | null
          call_type?: string | null
          customer_name?: string | null
          disconnection_reason?: string | null
          duration_seconds?: number | null
          end_reason?: string | null
          id: string
          meta?: Json | null
          phone?: string | null
          recording_url?: string | null
          sentiment?: string | null
          started_at?: string | null
          synced_at?: string | null
          transcript?: string | null
          workspace_id: string
        }
        Update: {
          agent_name?: string | null
          appointment_date?: string | null
          appointment_time?: string | null
          booking_status?: string | null
          calendly_booking_url?: string | null
          call_count?: number | null
          call_status?: string | null
          call_summary?: string | null
          call_type?: string | null
          customer_name?: string | null
          disconnection_reason?: string | null
          duration_seconds?: number | null
          end_reason?: string | null
          id?: string
          meta?: Json | null
          phone?: string | null
          recording_url?: string | null
          sentiment?: string | null
          started_at?: string | null
          synced_at?: string | null
          transcript?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      wbah_categorized_leads: {
        Row: {
          address: string | null
          city: string | null
          created_at: string | null
          email: string | null
          external_lead_id: string
          external_source: string
          external_status_code: string | null
          external_status_label: string | null
          first_name: string | null
          full_name: string | null
          id: string
          last_name: string | null
          last_synced_at: string | null
          meta: Json | null
          phone: string | null
          postcode: string | null
          property_type: string | null
          webee_category: string
          workspace_id: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          external_lead_id: string
          external_source?: string
          external_status_code?: string | null
          external_status_label?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          last_synced_at?: string | null
          meta?: Json | null
          phone?: string | null
          postcode?: string | null
          property_type?: string | null
          webee_category: string
          workspace_id: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          external_lead_id?: string
          external_source?: string
          external_status_code?: string | null
          external_status_label?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          last_synced_at?: string | null
          meta?: Json | null
          phone?: string | null
          postcode?: string | null
          property_type?: string | null
          webee_category?: string
          workspace_id?: string
        }
        Relationships: []
      }
      wbah_category_sync_log: {
        Row: {
          category: string
          duration_ms: number | null
          endpoint_used: string | null
          error_message: string | null
          external_status_codes: string[] | null
          failed: number | null
          id: string
          imported: number | null
          skipped: number | null
          synced_at: string | null
          total_records: number | null
          updated: number | null
          workspace_id: string
        }
        Insert: {
          category: string
          duration_ms?: number | null
          endpoint_used?: string | null
          error_message?: string | null
          external_status_codes?: string[] | null
          failed?: number | null
          id?: string
          imported?: number | null
          skipped?: number | null
          synced_at?: string | null
          total_records?: number | null
          updated?: number | null
          workspace_id: string
        }
        Update: {
          category?: string
          duration_ms?: number | null
          endpoint_used?: string | null
          error_message?: string | null
          external_status_codes?: string[] | null
          failed?: number | null
          id?: string
          imported?: number | null
          skipped?: number | null
          synced_at?: string | null
          total_records?: number | null
          updated?: number | null
          workspace_id?: string
        }
        Relationships: []
      }
      wbah_crm_contacts: {
        Row: {
          agent_name: string | null
          appointment_date: string | null
          appointment_time: string | null
          booking_status: string | null
          calendly_booking_url: string | null
          call_status: string | null
          crm_loaded_at: string | null
          dedup_key: string
          disconnection_reason: string | null
          duration_ms: number | null
          email: string | null
          end_reason: string | null
          external_id: string | null
          lead_status: string | null
          meta: Json | null
          name: string | null
          phone: string | null
          recording_url: string | null
          sentiment: string | null
          start_timestamp: number | null
          synced_at: string | null
          transcript: string | null
          workspace_id: string
        }
        Insert: {
          agent_name?: string | null
          appointment_date?: string | null
          appointment_time?: string | null
          booking_status?: string | null
          calendly_booking_url?: string | null
          call_status?: string | null
          crm_loaded_at?: string | null
          dedup_key: string
          disconnection_reason?: string | null
          duration_ms?: number | null
          email?: string | null
          end_reason?: string | null
          external_id?: string | null
          lead_status?: string | null
          meta?: Json | null
          name?: string | null
          phone?: string | null
          recording_url?: string | null
          sentiment?: string | null
          start_timestamp?: number | null
          synced_at?: string | null
          transcript?: string | null
          workspace_id: string
        }
        Update: {
          agent_name?: string | null
          appointment_date?: string | null
          appointment_time?: string | null
          booking_status?: string | null
          calendly_booking_url?: string | null
          call_status?: string | null
          crm_loaded_at?: string | null
          dedup_key?: string
          disconnection_reason?: string | null
          duration_ms?: number | null
          email?: string | null
          end_reason?: string | null
          external_id?: string | null
          lead_status?: string | null
          meta?: Json | null
          name?: string | null
          phone?: string | null
          recording_url?: string | null
          sentiment?: string | null
          start_timestamp?: number | null
          synced_at?: string | null
          transcript?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      webespoke_enterprise_cache: {
        Row: {
          client_name: string
          data_type: string
          external_id: string | null
          id: string
          payload: Json
          synced_at: string
          workspace_id: string | null
        }
        Insert: {
          client_name?: string
          data_type: string
          external_id?: string | null
          id?: string
          payload: Json
          synced_at?: string
          workspace_id?: string | null
        }
        Update: {
          client_name?: string
          data_type?: string
          external_id?: string | null
          id?: string
          payload?: Json
          synced_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webespoke_enterprise_cache_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webform_rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      webform_sources: {
        Row: {
          allowed_domains: string[] | null
          created_at: string
          created_by: string | null
          default_source_detail: string | null
          default_source_type: string
          field_mapping_json: Json | null
          form_token: string
          id: string
          name: string
          notify_email: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          allowed_domains?: string[] | null
          created_at?: string
          created_by?: string | null
          default_source_detail?: string | null
          default_source_type?: string
          field_mapping_json?: Json | null
          form_token?: string
          id?: string
          name: string
          notify_email?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          allowed_domains?: string[] | null
          created_at?: string
          created_by?: string | null
          default_source_detail?: string | null
          default_source_type?: string
          field_mapping_json?: Json | null
          form_token?: string
          id?: string
          name?: string
          notify_email?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webform_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webform_submissions: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          lead_id: string | null
          mapped_payload: Json
          raw_payload: Json
          referrer: string | null
          source_detail: string | null
          source_type: string
          status: string
          user_agent: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          webform_source_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          lead_id?: string | null
          mapped_payload?: Json
          raw_payload?: Json
          referrer?: string | null
          source_detail?: string | null
          source_type?: string
          status?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          webform_source_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          lead_id?: string | null
          mapped_payload?: Json
          raw_payload?: Json
          referrer?: string | null
          source_detail?: string | null
          source_type?: string
          status?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          webform_source_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webform_submissions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webform_submissions_webform_source_id_fkey"
            columns: ["webform_source_id"]
            isOneToOne: false
            referencedRelation: "webform_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webform_submissions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempt_count: number
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          next_retry_at: string | null
          payload: Json
          response_body: string | null
          response_code: number | null
          status: string
          webhook_id: string | null
          workspace_id: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: string
          next_retry_at?: string | null
          payload?: Json
          response_body?: string | null
          response_code?: number | null
          status?: string
          webhook_id?: string | null
          workspace_id: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          next_retry_at?: string | null
          payload?: Json
          response_body?: string | null
          response_code?: number | null
          status?: string
          webhook_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "workspace_webhooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_campaigns: {
        Row: {
          audience_filter: Json | null
          created_at: string | null
          id: string
          name: string
          scheduled_at: string | null
          stats: Json | null
          status: string | null
          template_id: string | null
          type: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          audience_filter?: Json | null
          created_at?: string | null
          id?: string
          name: string
          scheduled_at?: string | null
          stats?: Json | null
          status?: string | null
          template_id?: string | null
          type?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          audience_filter?: Json | null
          created_at?: string | null
          id?: string
          name?: string
          scheduled_at?: string | null
          stats?: Json | null
          status?: string | null
          template_id?: string | null
          type?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_contacts: {
        Row: {
          archived: boolean | null
          created_at: string | null
          id: string
          lead_status: string | null
          name: string | null
          notes: string | null
          phone: string
          source: string | null
          tags: string[] | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          archived?: boolean | null
          created_at?: string | null
          id?: string
          lead_status?: string | null
          name?: string | null
          notes?: string | null
          phone: string
          source?: string | null
          tags?: string[] | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          archived?: boolean | null
          created_at?: string | null
          id?: string
          lead_status?: string | null
          name?: string | null
          notes?: string | null
          phone?: string
          source?: string | null
          tags?: string[] | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          body: string | null
          contact_name: string | null
          contact_phone: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_id: string | null
          id: string
          lead_id: string | null
          media_url: string | null
          sent_at: string
          status: Database["public"]["Enums"]["message_status"]
          workspace_id: string
        }
        Insert: {
          body?: string | null
          contact_name?: string | null
          contact_phone: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_id?: string | null
          id?: string
          lead_id?: string | null
          media_url?: string | null
          sent_at?: string
          status?: Database["public"]["Enums"]["message_status"]
          workspace_id: string
        }
        Update: {
          body?: string | null
          contact_name?: string | null
          contact_phone?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          external_id?: string | null
          id?: string
          lead_id?: string | null
          media_url?: string | null
          sent_at?: string
          status?: Database["public"]["Enums"]["message_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sessions: {
        Row: {
          agent_id: string | null
          contact_phone: string
          context: Json | null
          created_at: string | null
          current_node_id: string | null
          ended: boolean | null
          id: string
          message_count: number | null
          updated_at: string | null
          waiting_for_reply: boolean
          workflow_variables: Json
          workspace_id: string
        }
        Insert: {
          agent_id?: string | null
          contact_phone: string
          context?: Json | null
          created_at?: string | null
          current_node_id?: string | null
          ended?: boolean | null
          id?: string
          message_count?: number | null
          updated_at?: string | null
          waiting_for_reply?: boolean
          workflow_variables?: Json
          workspace_id: string
        }
        Update: {
          agent_id?: string | null
          contact_phone?: string
          context?: Json | null
          created_at?: string | null
          current_node_id?: string | null
          ended?: boolean | null
          id?: string
          message_count?: number | null
          updated_at?: string | null
          waiting_for_reply?: boolean
          workflow_variables?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sessions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_setup_drafts: {
        Row: {
          agent_binding: Json
          created_at: string
          created_by_user_id: string | null
          generated_action_id: string
          id: string
          is_deleted: boolean
          message_templates: Json
          provider: string
          setup_steps: Json
          updated_at: string
          webhook_config: Json
          workspace_id: string
        }
        Insert: {
          agent_binding?: Json
          created_at?: string
          created_by_user_id?: string | null
          generated_action_id: string
          id?: string
          is_deleted?: boolean
          message_templates?: Json
          provider: string
          setup_steps?: Json
          updated_at?: string
          webhook_config?: Json
          workspace_id: string
        }
        Update: {
          agent_binding?: Json
          created_at?: string
          created_by_user_id?: string | null
          generated_action_id?: string
          id?: string
          is_deleted?: boolean
          message_templates?: Json
          provider?: string
          setup_steps?: Json
          updated_at?: string
          webhook_config?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_setup_drafts_generated_action_id_fkey"
            columns: ["generated_action_id"]
            isOneToOne: true
            referencedRelation: "systemmind_generated_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          body: string
          category: string | null
          created_at: string | null
          id: string
          name: string
          status: string | null
          updated_at: string | null
          variables: string[] | null
          workspace_id: string
        }
        Insert: {
          body: string
          category?: string | null
          created_at?: string | null
          id?: string
          name: string
          status?: string | null
          updated_at?: string | null
          variables?: string[] | null
          workspace_id: string
        }
        Update: {
          body?: string
          category?: string | null
          created_at?: string | null
          id?: string
          name?: string
          status?: string | null
          updated_at?: string | null
          variables?: string[] | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whitelabel_partners: {
        Row: {
          accent_color: string
          active: boolean
          allowed_modules: string[]
          brand_name: string
          created_at: string
          custom_css: string | null
          custom_domain: string | null
          favicon_url: string | null
          hide_powered_by: boolean
          id: string
          logo_url: string | null
          monthly_fee_pence: number
          notes: string | null
          onboarded_at: string | null
          partner_name: string
          partner_tier: string
          primary_color: string
          revenue_share_pct: number | null
          secondary_color: string
          slug: string
          support_email: string | null
          support_url: string | null
          tagline: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          accent_color?: string
          active?: boolean
          allowed_modules?: string[]
          brand_name: string
          created_at?: string
          custom_css?: string | null
          custom_domain?: string | null
          favicon_url?: string | null
          hide_powered_by?: boolean
          id?: string
          logo_url?: string | null
          monthly_fee_pence?: number
          notes?: string | null
          onboarded_at?: string | null
          partner_name: string
          partner_tier?: string
          primary_color?: string
          revenue_share_pct?: number | null
          secondary_color?: string
          slug: string
          support_email?: string | null
          support_url?: string | null
          tagline?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          accent_color?: string
          active?: boolean
          allowed_modules?: string[]
          brand_name?: string
          created_at?: string
          custom_css?: string | null
          custom_domain?: string | null
          favicon_url?: string | null
          hide_powered_by?: boolean
          id?: string
          logo_url?: string | null
          monthly_fee_pence?: number
          notes?: string | null
          onboarded_at?: string | null
          partner_name?: string
          partner_tier?: string
          primary_color?: string
          revenue_share_pct?: number | null
          secondary_color?: string
          slug?: string
          support_email?: string | null
          support_url?: string | null
          tagline?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whitelabel_partners_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_blueprints: {
        Row: {
          activated_workflow_id: string | null
          blueprint: Json
          created_at: string
          created_by_user_id: string | null
          generated_action_id: string | null
          id: string
          is_deleted: boolean
          mapping_report: Json
          source: string
          source_name: string | null
          source_row_id: string | null
          source_workflow_id: string | null
          unconvertible_count: number
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          activated_workflow_id?: string | null
          blueprint?: Json
          created_at?: string
          created_by_user_id?: string | null
          generated_action_id?: string | null
          id?: string
          is_deleted?: boolean
          mapping_report?: Json
          source?: string
          source_name?: string | null
          source_row_id?: string | null
          source_workflow_id?: string | null
          unconvertible_count?: number
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          activated_workflow_id?: string | null
          blueprint?: Json
          created_at?: string
          created_by_user_id?: string | null
          generated_action_id?: string | null
          id?: string
          is_deleted?: boolean
          mapping_report?: Json
          source?: string
          source_name?: string | null
          source_row_id?: string | null
          source_workflow_id?: string | null
          unconvertible_count?: number
          updated_at?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_blueprints_generated_action_id_fkey"
            columns: ["generated_action_id"]
            isOneToOne: true
            referencedRelation: "systemmind_generated_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_run_events: {
        Row: {
          created_at: string
          error: string | null
          id: string
          input: Json
          output: Json
          run_id: string
          status: string
          step_id: string | null
          step_type: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          input?: Json
          output?: Json
          run_id: string
          status?: string
          step_id?: string | null
          step_type?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          input?: Json
          output?: Json
          run_id?: string
          status?: string
          step_id?: string | null
          step_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_run_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          completed_at: string | null
          error: string | null
          id: string
          started_at: string
          status: string
          summary: Json
          trigger_data: Json
          trigger_type: string | null
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          error?: string | null
          id?: string
          started_at?: string
          status?: string
          summary?: Json
          trigger_data?: Json
          trigger_type?: string | null
          workflow_id: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          error?: string | null
          id?: string
          started_at?: string
          status?: string
          summary?: Json
          trigger_data?: Json
          trigger_type?: string | null
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workspace_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_schedules: {
        Row: {
          created_at: string
          cron_expr: string | null
          enabled: boolean
          id: string
          interval_ms: number | null
          last_run_at: string | null
          next_run_at: string | null
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          cron_expr?: string | null
          enabled?: boolean
          id?: string
          interval_ms?: number | null
          last_run_at?: string | null
          next_run_at?: string | null
          workflow_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          cron_expr?: string | null
          enabled?: boolean
          id?: string
          interval_ms?: number | null
          last_run_at?: string | null
          next_run_at?: string | null
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_schedules_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workspace_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_template_categories: {
        Row: {
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      workflow_template_versions: {
        Row: {
          change_note: string | null
          created_at: string
          flow_definition: Json
          id: string
          template_id: string
          version: number
        }
        Insert: {
          change_note?: string | null
          created_at?: string
          flow_definition?: Json
          id?: string
          template_id: string
          version: number
        }
        Update: {
          change_note?: string | null
          created_at?: string
          flow_definition?: Json
          id?: string
          template_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workflow_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          flow_definition: Json
          id: string
          name: string
          status: string
          tags: string[] | null
          trigger_type: string
          updated_at: string
          version: number
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          flow_definition?: Json
          id?: string
          name: string
          status?: string
          tags?: string[] | null
          trigger_type?: string
          updated_at?: string
          version?: number
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          flow_definition?: Json
          id?: string
          name?: string
          status?: string
          tags?: string[] | null
          trigger_type?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workflow_templates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "workflow_template_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_api_profiles: {
        Row: {
          auth_strategy: string
          connection_id: string | null
          created_at: string
          data_source_key: string
          display_name: string
          engine_config: Json
          id: string
          is_active: boolean
          module_mappings: Json
          pagination_strategy: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auth_strategy?: string
          connection_id?: string | null
          created_at?: string
          data_source_key: string
          display_name: string
          engine_config?: Json
          id?: string
          is_active?: boolean
          module_mappings?: Json
          pagination_strategy?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          auth_strategy?: string
          connection_id?: string | null
          created_at?: string
          data_source_key?: string
          display_name?: string
          engine_config?: Json
          id?: string
          is_active?: boolean
          module_mappings?: Json
          pagination_strategy?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_api_profiles_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "client_api_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_api_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_api_tokens: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          permissions_json: Json
          prefix: string
          revoked_at: string | null
          token_hash: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          permissions_json?: Json
          prefix: string
          revoked_at?: string | null
          token_hash: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          permissions_json?: Json
          prefix?: string
          revoked_at?: string | null
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_api_tokens_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_health_runs: {
        Row: {
          created_at: string
          created_by_system: string
          created_by_user_id: string | null
          error: string | null
          findings: Json
          id: string
          max_score: number | null
          proposed_action_ids: Json
          score: number | null
          status: string
          summary: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by_system?: string
          created_by_user_id?: string | null
          error?: string | null
          findings?: Json
          id?: string
          max_score?: number | null
          proposed_action_ids?: Json
          score?: number | null
          status?: string
          summary?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by_system?: string
          created_by_user_id?: string | null
          error?: string | null
          findings?: Json
          id?: string
          max_score?: number | null
          proposed_action_ids?: Json
          score?: number | null
          status?: string
          summary?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["workspace_role"]
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["workspace_role"]
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_onboarding: {
        Row: {
          analysis_done: boolean
          business_dna_done: boolean
          completed: boolean
          connections_done: boolean
          created_at: string
          crm_choice: string | null
          dismissed: boolean
          first_agent_done: boolean
          first_campaign_done: boolean
          knowledge_uploaded: boolean
          path: string | null
          telephony_done: boolean
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          analysis_done?: boolean
          business_dna_done?: boolean
          completed?: boolean
          connections_done?: boolean
          created_at?: string
          crm_choice?: string | null
          dismissed?: boolean
          first_agent_done?: boolean
          first_campaign_done?: boolean
          knowledge_uploaded?: boolean
          path?: string | null
          telephony_done?: boolean
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          analysis_done?: boolean
          business_dna_done?: boolean
          completed?: boolean
          connections_done?: boolean
          created_at?: string
          crm_choice?: string | null
          dismissed?: boolean
          first_agent_done?: boolean
          first_campaign_done?: boolean
          knowledge_uploaded?: boolean
          path?: string | null
          telephony_done?: boolean
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_onboarding_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          status: string
          updated_at: string
          user_id: string
          workspace_name: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          status?: string
          updated_at?: string
          user_id: string
          workspace_name: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
          workspace_name?: string
        }
        Relationships: []
      }
      workspace_seat_billing: {
        Row: {
          additional_user_price_pence: number
          created_at: string
          current_user_count: number
          custom_seat_price_override: number | null
          id: string
          included_users: number
          notes: string | null
          plan_tier: string
          seat_limit_warning_threshold: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          additional_user_price_pence?: number
          created_at?: string
          current_user_count?: number
          custom_seat_price_override?: number | null
          id?: string
          included_users?: number
          notes?: string | null
          plan_tier: string
          seat_limit_warning_threshold?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          additional_user_price_pence?: number
          created_at?: string
          current_user_count?: number
          custom_seat_price_override?: number | null
          id?: string
          included_users?: number
          notes?: string | null
          plan_tier?: string
          seat_limit_warning_threshold?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_seat_billing_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          active_modules: string[]
          buffer_minutes: number
          business_hours: Json
          business_name: string | null
          calcom_api_key: string | null
          calcom_api_token: string | null
          calcom_event_type_id: string | null
          calcom_webhook_secret: string | null
          call_schedule: Json
          created_at: string
          default_event_type_id: number | null
          elevenlabs_api_key: string | null
          generation_limits: Json
          ghl_api_key: string | null
          ghl_location_id: string | null
          growthmind_settings: Json
          gsc_access_token: string | null
          gsc_auto_matched: boolean | null
          gsc_property_url: string | null
          gsc_refresh_token: string | null
          gsc_token_expiry: string | null
          hexmail_active_provider: string | null
          hexmail_postmark_from_email: string | null
          hexmail_postmark_from_name: string | null
          hexmail_postmark_server_token: string | null
          hexmail_resend_api_key: string | null
          hexmail_resend_from_email: string | null
          hexmail_resend_from_name: string | null
          hexmail_sendgrid_api_key: string | null
          hexmail_sendgrid_from_email: string | null
          hexmail_sendgrid_from_name: string | null
          hivemind_mode: string
          hubspot_api_key: string | null
          last_synced_at: string | null
          lead_auto_call_agent_id: string | null
          lead_auto_call_enabled: boolean
          lead_auto_email_enabled: boolean | null
          lead_auto_email_template_id: string | null
          meta_access_token: string | null
          meta_ads_access_token: string | null
          meta_ads_account_id: string | null
          meta_phone_number_id: string | null
          meta_verify_token: string | null
          meta_waba_id: string | null
          min_notice_hours: number
          modules_updated_at: string
          notification_email: string | null
          openai_api_key: string | null
          openai_realtime_inbound_url: string | null
          pipedrive_api_token: string | null
          plan_tier: string
          retell_default_agent_id: string | null
          retell_workspace_id: string | null
          salesforce_access_token: string | null
          salesforce_instance_url: string | null
          systemmind_cto_settings: Json | null
          timezone: string
          twilio_account_sid: string | null
          twilio_auth_token: string | null
          updated_at: string
          webespoke_api_key: string | null
          webespoke_api_url: string | null
          whatsapp_phone_id: string | null
          whatsapp_provider: string | null
          working_hours: Json
          workspace_id: string
        }
        Insert: {
          active_modules?: string[]
          buffer_minutes?: number
          business_hours?: Json
          business_name?: string | null
          calcom_api_key?: string | null
          calcom_api_token?: string | null
          calcom_event_type_id?: string | null
          calcom_webhook_secret?: string | null
          call_schedule?: Json
          created_at?: string
          default_event_type_id?: number | null
          elevenlabs_api_key?: string | null
          generation_limits?: Json
          ghl_api_key?: string | null
          ghl_location_id?: string | null
          growthmind_settings?: Json
          gsc_access_token?: string | null
          gsc_auto_matched?: boolean | null
          gsc_property_url?: string | null
          gsc_refresh_token?: string | null
          gsc_token_expiry?: string | null
          hexmail_active_provider?: string | null
          hexmail_postmark_from_email?: string | null
          hexmail_postmark_from_name?: string | null
          hexmail_postmark_server_token?: string | null
          hexmail_resend_api_key?: string | null
          hexmail_resend_from_email?: string | null
          hexmail_resend_from_name?: string | null
          hexmail_sendgrid_api_key?: string | null
          hexmail_sendgrid_from_email?: string | null
          hexmail_sendgrid_from_name?: string | null
          hivemind_mode?: string
          hubspot_api_key?: string | null
          last_synced_at?: string | null
          lead_auto_call_agent_id?: string | null
          lead_auto_call_enabled?: boolean
          lead_auto_email_enabled?: boolean | null
          lead_auto_email_template_id?: string | null
          meta_access_token?: string | null
          meta_ads_access_token?: string | null
          meta_ads_account_id?: string | null
          meta_phone_number_id?: string | null
          meta_verify_token?: string | null
          meta_waba_id?: string | null
          min_notice_hours?: number
          modules_updated_at?: string
          notification_email?: string | null
          openai_api_key?: string | null
          openai_realtime_inbound_url?: string | null
          pipedrive_api_token?: string | null
          plan_tier?: string
          retell_default_agent_id?: string | null
          retell_workspace_id?: string | null
          salesforce_access_token?: string | null
          salesforce_instance_url?: string | null
          systemmind_cto_settings?: Json | null
          timezone?: string
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          updated_at?: string
          webespoke_api_key?: string | null
          webespoke_api_url?: string | null
          whatsapp_phone_id?: string | null
          whatsapp_provider?: string | null
          working_hours?: Json
          workspace_id: string
        }
        Update: {
          active_modules?: string[]
          buffer_minutes?: number
          business_hours?: Json
          business_name?: string | null
          calcom_api_key?: string | null
          calcom_api_token?: string | null
          calcom_event_type_id?: string | null
          calcom_webhook_secret?: string | null
          call_schedule?: Json
          created_at?: string
          default_event_type_id?: number | null
          elevenlabs_api_key?: string | null
          generation_limits?: Json
          ghl_api_key?: string | null
          ghl_location_id?: string | null
          growthmind_settings?: Json
          gsc_access_token?: string | null
          gsc_auto_matched?: boolean | null
          gsc_property_url?: string | null
          gsc_refresh_token?: string | null
          gsc_token_expiry?: string | null
          hexmail_active_provider?: string | null
          hexmail_postmark_from_email?: string | null
          hexmail_postmark_from_name?: string | null
          hexmail_postmark_server_token?: string | null
          hexmail_resend_api_key?: string | null
          hexmail_resend_from_email?: string | null
          hexmail_resend_from_name?: string | null
          hexmail_sendgrid_api_key?: string | null
          hexmail_sendgrid_from_email?: string | null
          hexmail_sendgrid_from_name?: string | null
          hivemind_mode?: string
          hubspot_api_key?: string | null
          last_synced_at?: string | null
          lead_auto_call_agent_id?: string | null
          lead_auto_call_enabled?: boolean
          lead_auto_email_enabled?: boolean | null
          lead_auto_email_template_id?: string | null
          meta_access_token?: string | null
          meta_ads_access_token?: string | null
          meta_ads_account_id?: string | null
          meta_phone_number_id?: string | null
          meta_verify_token?: string | null
          meta_waba_id?: string | null
          min_notice_hours?: number
          modules_updated_at?: string
          notification_email?: string | null
          openai_api_key?: string | null
          openai_realtime_inbound_url?: string | null
          pipedrive_api_token?: string | null
          plan_tier?: string
          retell_default_agent_id?: string | null
          retell_workspace_id?: string | null
          salesforce_access_token?: string | null
          salesforce_instance_url?: string | null
          systemmind_cto_settings?: Json | null
          timezone?: string
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          updated_at?: string
          webespoke_api_key?: string | null
          webespoke_api_url?: string | null
          whatsapp_phone_id?: string | null
          whatsapp_provider?: string | null
          working_hours?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_lead_auto_call_agent_id_fkey"
            columns: ["lead_auto_call_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_setup_checklists: {
        Row: {
          business_summary: string | null
          created_at: string
          created_by_system: string
          created_by_user_id: string | null
          id: string
          is_deleted: boolean
          items: Json
          previous_version_id: string | null
          source_draft_id: string | null
          status: string
          title: string
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          business_summary?: string | null
          created_at?: string
          created_by_system?: string
          created_by_user_id?: string | null
          id?: string
          is_deleted?: boolean
          items?: Json
          previous_version_id?: string | null
          source_draft_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          business_summary?: string | null
          created_at?: string
          created_by_system?: string
          created_by_user_id?: string | null
          id?: string
          is_deleted?: boolean
          items?: Json
          previous_version_id?: string | null
          source_draft_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: []
      }
      workspace_webhooks: {
        Row: {
          active: boolean
          created_at: string
          event_type: string
          id: string
          name: string
          secret: string
          target_url: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          event_type: string
          id?: string
          name: string
          secret?: string
          target_url: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          event_type?: string
          id?: string
          name?: string
          secret?: string
          target_url?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_webhooks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_workflows: {
        Row: {
          created_at: string
          description: string | null
          flow_definition: Json
          id: string
          name: string
          source: string | null
          source_build_session_id: string | null
          source_build_version: number | null
          status: string
          template_id: string | null
          template_version: number | null
          trigger_config: Json
          trigger_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          flow_definition?: Json
          id?: string
          name: string
          source?: string | null
          source_build_session_id?: string | null
          source_build_version?: number | null
          status?: string
          template_id?: string | null
          template_version?: number | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          flow_definition?: Json
          id?: string
          name?: string
          source?: string | null
          source_build_session_id?: string | null
          source_build_version?: number | null
          status?: string
          template_id?: string | null
          template_version?: number | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_workflows_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      seat_utilisation: {
        Row: {
          active_users: number | null
          additional_user_price_pence: number | null
          extra_users: number | null
          included_users: number | null
          is_over_limit: boolean | null
          plan_tier: string | null
          seat_limit_warning_threshold: number | null
          utilisation_ratio: number | null
          warning_active: boolean | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_seat_billing_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      match_executive_document_chunks: {
        Args: {
          p_knowledge_base_ids: string[]
          p_match_count?: number
          p_query_embedding: string
          p_workspace_id: string
        }
        Returns: {
          chunk_id: string
          content: string
          document_id: string
          knowledge_base_id: string
          metadata: Json
          similarity: number
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      trigger_ads_sync: { Args: never; Returns: undefined }
      trigger_campaign_executor: { Args: never; Returns: undefined }
      trigger_provider_health_sweep: { Args: never; Returns: undefined }
      workspace_role_of: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: Database["public"]["Enums"]["workspace_role"]
      }
    }
    Enums: {
      agent_flow_type: "lead_gen" | "receptionist"
      app_role: "admin" | "user"
      booking_status:
        | "pending"
        | "accepted"
        | "completed"
        | "cancelled"
        | "rescheduled"
        | "no_show"
      call_status:
        | "initiated"
        | "ringing"
        | "in_progress"
        | "completed"
        | "no_answer"
        | "busy"
        | "failed"
        | "voicemail"
      call_type: "inbound" | "outbound"
      data_record_call_status:
        | "needs_to_call"
        | "queued"
        | "calling"
        | "completed"
        | "failed"
        | "do_not_call"
      lead_source:
        | "website"
        | "inbound"
        | "outbound"
        | "referral"
        | "import"
        | "website_form"
        | "landing_page"
        | "facebook_lead_form"
        | "google_ads_lead_form"
        | "tiktok_lead_form"
        | "linkedin_lead_form"
        | "zapier"
        | "make"
        | "custom_form"
        | "webee_website_form"
        | "api"
      lead_status:
        | "need_to_call"
        | "calling"
        | "completed"
        | "interested"
        | "not_interested"
        | "not_connected"
        | "do_not_call"
        | "qualified"
      message_direction: "inbound" | "outbound"
      message_status: "queued" | "sent" | "delivered" | "read" | "failed"
      sentiment_kind: "positive" | "neutral" | "negative"
      user_type: "admin" | "user"
      workspace_role: "owner" | "admin" | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agent_flow_type: ["lead_gen", "receptionist"],
      app_role: ["admin", "user"],
      booking_status: [
        "pending",
        "accepted",
        "completed",
        "cancelled",
        "rescheduled",
        "no_show",
      ],
      call_status: [
        "initiated",
        "ringing",
        "in_progress",
        "completed",
        "no_answer",
        "busy",
        "failed",
        "voicemail",
      ],
      call_type: ["inbound", "outbound"],
      data_record_call_status: [
        "needs_to_call",
        "queued",
        "calling",
        "completed",
        "failed",
        "do_not_call",
      ],
      lead_source: [
        "website",
        "inbound",
        "outbound",
        "referral",
        "import",
        "website_form",
        "landing_page",
        "facebook_lead_form",
        "google_ads_lead_form",
        "tiktok_lead_form",
        "linkedin_lead_form",
        "zapier",
        "make",
        "custom_form",
        "webee_website_form",
        "api",
      ],
      lead_status: [
        "need_to_call",
        "calling",
        "completed",
        "interested",
        "not_interested",
        "not_connected",
        "do_not_call",
        "qualified",
      ],
      message_direction: ["inbound", "outbound"],
      message_status: ["queued", "sent", "delivered", "read", "failed"],
      sentiment_kind: ["positive", "neutral", "negative"],
      user_type: ["admin", "user"],
      workspace_role: ["owner", "admin", "member"],
    },
  },
} as const
