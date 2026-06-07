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
        }
        Relationships: []
      }
      agents: {
        Row: {
          cost_seconds: number
          created_at: string
          flow_data: Json
          id: string
          name: string
          retell_agent_id: string | null
          settings: Json
          updated_at: string
          user_id: string
          variables: Json
        }
        Insert: {
          cost_seconds?: number
          created_at?: string
          flow_data?: Json
          id?: string
          name?: string
          retell_agent_id?: string | null
          settings?: Json
          updated_at?: string
          user_id: string
          variables?: Json
        }
        Update: {
          cost_seconds?: number
          created_at?: string
          flow_data?: Json
          id?: string
          name?: string
          retell_agent_id?: string | null
          settings?: Json
          updated_at?: string
          user_id?: string
          variables?: Json
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
        }
        Relationships: []
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
        }
        Relationships: [
          {
            foreignKeyName: "bookings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
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
        }
        Relationships: []
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
        }
        Relationships: []
      }
      dashboard_sync_settings: {
        Row: {
          api_token: string | null
          api_token_last4: string | null
          created_at: string
          endpoint_url: string
          id: string
          last_sync_error: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          sync_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          api_token?: string | null
          api_token_last4?: string | null
          created_at?: string
          endpoint_url?: string
          id?: string
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          sync_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          api_token?: string | null
          api_token_last4?: string | null
          created_at?: string
          endpoint_url?: string
          id?: string
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          sync_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      profiles: {
        Row: {
          admin_reviewed_at: string | null
          admin_reviewed_by: string | null
          approval_decided_at: string | null
          approval_token: string
          approved: boolean
          created_at: string
          denied: boolean
          email: string
          id: string
          spend_limit_cents: number
          spend_used_cents: number
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          approval_decided_at?: string | null
          approval_token?: string
          approved?: boolean
          created_at?: string
          denied?: boolean
          email: string
          id?: string
          spend_limit_cents?: number
          spend_used_cents?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          approval_decided_at?: string | null
          approval_token?: string
          approved?: boolean
          created_at?: string
          denied?: boolean
          email?: string
          id?: string
          spend_limit_cents?: number
          spend_used_cents?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
        }
        Relationships: []
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
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
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
      workspace_calendar_settings: {
        Row: {
          buffer_minutes: number
          calcom_api_key: string | null
          created_at: string
          default_event_type_id: number | null
          id: string
          last_synced_at: string | null
          min_notice_hours: number
          timezone: string
          updated_at: string
          user_id: string
          working_hours: Json
        }
        Insert: {
          buffer_minutes?: number
          calcom_api_key?: string | null
          created_at?: string
          default_event_type_id?: number | null
          id?: string
          last_synced_at?: string | null
          min_notice_hours?: number
          timezone?: string
          updated_at?: string
          user_id: string
          working_hours?: Json
        }
        Update: {
          buffer_minutes?: number
          calcom_api_key?: string | null
          created_at?: string
          default_event_type_id?: number | null
          id?: string
          last_synced_at?: string | null
          min_notice_hours?: number
          timezone?: string
          updated_at?: string
          user_id?: string
          working_hours?: Json
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
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
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
