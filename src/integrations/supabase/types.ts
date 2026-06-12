export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      agent_retell_secrets: {
        Row: {
          agent_id: string;
          created_at: string;
          id: string;
          production_api_key: string;
          production_api_key_masked: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          agent_id: string;
          created_at?: string;
          id?: string;
          production_api_key: string;
          production_api_key_masked: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          agent_id?: string;
          created_at?: string;
          id?: string;
          production_api_key?: string;
          production_api_key_masked?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_retell_secrets_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_templates: {
        Row: {
          created_at: string;
          description: string;
          flow_data: Json;
          id: string;
          name: string;
          owner_user_id: string | null;
          scope: string;
          settings: Json;
          updated_at: string;
          variables: Json;
          workspace_id: string | null;
        };
        Insert: {
          created_at?: string;
          description?: string;
          flow_data?: Json;
          id?: string;
          name?: string;
          owner_user_id?: string | null;
          scope: string;
          settings?: Json;
          updated_at?: string;
          variables?: Json;
          workspace_id?: string | null;
        };
        Update: {
          created_at?: string;
          description?: string;
          flow_data?: Json;
          id?: string;
          name?: string;
          owner_user_id?: string | null;
          scope?: string;
          settings?: Json;
          updated_at?: string;
          variables?: Json;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_templates_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      agents: {
        Row: {
          agent_type: Database["public"]["Enums"]["agent_flow_type"];
          cost_seconds: number;
          created_at: string;
          flow_data: Json;
          id: string;
          inbound_phone_number: string | null;
          name: string;
          retell_agent_id: string | null;
          retell_conversation_flow_id: string | null;
          settings: Json;
          updated_at: string;
          user_id: string;
          variables: Json;
          voice_provider: string;
          workspace_id: string | null;
        };
        Insert: {
          agent_type?: Database["public"]["Enums"]["agent_flow_type"];
          cost_seconds?: number;
          created_at?: string;
          flow_data?: Json;
          id?: string;
          inbound_phone_number?: string | null;
          name?: string;
          retell_agent_id?: string | null;
          retell_conversation_flow_id?: string | null;
          settings?: Json;
          updated_at?: string;
          user_id: string;
          variables?: Json;
          voice_provider?: string;
          workspace_id?: string | null;
        };
        Update: {
          agent_type?: Database["public"]["Enums"]["agent_flow_type"];
          cost_seconds?: number;
          created_at?: string;
          flow_data?: Json;
          id?: string;
          inbound_phone_number?: string | null;
          name?: string;
          retell_agent_id?: string | null;
          retell_conversation_flow_id?: string | null;
          settings?: Json;
          updated_at?: string;
          user_id?: string;
          variables?: Json;
          voice_provider?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agents_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_summaries: {
        Row: {
          agent_id: string | null;
          appointment_booked: boolean | null;
          appointment_date: string | null;
          appointment_reason: string | null;
          booking_id: string | null;
          calcom_booking_uid: string | null;
          call_id: string;
          created_at: string;
          customer_name: string | null;
          customer_phone: string | null;
          id: string;
          raw: Json;
          retell_agent_id: string | null;
          summary: string | null;
          updated_at: string;
          user_id: string;
          workspace_id: string | null;
        };
        Insert: {
          agent_id?: string | null;
          appointment_booked?: boolean | null;
          appointment_date?: string | null;
          appointment_reason?: string | null;
          booking_id?: string | null;
          calcom_booking_uid?: string | null;
          call_id: string;
          created_at?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          raw?: Json;
          retell_agent_id?: string | null;
          summary?: string | null;
          updated_at?: string;
          user_id: string;
          workspace_id?: string | null;
        };
        Update: {
          agent_id?: string | null;
          appointment_booked?: boolean | null;
          appointment_date?: string | null;
          appointment_reason?: string | null;
          booking_id?: string | null;
          calcom_booking_uid?: string | null;
          call_id?: string;
          created_at?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          raw?: Json;
          retell_agent_id?: string | null;
          summary?: string | null;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "booking_summaries_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          agent_id: string | null;
          attendee_email: string | null;
          attendee_name: string | null;
          attendee_phone: string | null;
          calcom_booking_id: number | null;
          calcom_booking_uid: string | null;
          created_at: string;
          end_at: string;
          event_type_id: number | null;
          id: string;
          notes: string | null;
          raw: Json;
          retell_call_id: string | null;
          start_at: string;
          status: string;
          updated_at: string;
          user_id: string;
          workspace_id: string | null;
        };
        Insert: {
          agent_id?: string | null;
          attendee_email?: string | null;
          attendee_name?: string | null;
          attendee_phone?: string | null;
          calcom_booking_id?: number | null;
          calcom_booking_uid?: string | null;
          created_at?: string;
          end_at: string;
          event_type_id?: number | null;
          id?: string;
          notes?: string | null;
          raw?: Json;
          retell_call_id?: string | null;
          start_at: string;
          status?: string;
          updated_at?: string;
          user_id: string;
          workspace_id?: string | null;
        };
        Update: {
          agent_id?: string | null;
          attendee_email?: string | null;
          attendee_name?: string | null;
          attendee_phone?: string | null;
          calcom_booking_id?: number | null;
          calcom_booking_uid?: string | null;
          created_at?: string;
          end_at?: string;
          event_type_id?: number | null;
          id?: string;
          notes?: string | null;
          raw?: Json;
          retell_call_id?: string | null;
          start_at?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      calcom_event_types: {
        Row: {
          active: boolean;
          calcom_event_type_id: number;
          created_at: string;
          id: string;
          last_synced_at: string | null;
          length_minutes: number;
          raw: Json;
          slug: string | null;
          title: string;
          updated_at: string;
          user_id: string;
          workspace_id: string | null;
        };
        Insert: {
          active?: boolean;
          calcom_event_type_id: number;
          created_at?: string;
          id?: string;
          last_synced_at?: string | null;
          length_minutes?: number;
          raw?: Json;
          slug?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
          workspace_id?: string | null;
        };
        Update: {
          active?: boolean;
          calcom_event_type_id?: number;
          created_at?: string;
          id?: string;
          last_synced_at?: string | null;
          length_minutes?: number;
          raw?: Json;
          slug?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "calcom_event_types_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_bookings: {
        Row: {
          attendee_email: string | null;
          attendee_name: string | null;
          attendee_phone: string | null;
          created_at: string;
          description: string | null;
          end_at: string;
          external_id: string | null;
          id: string;
          lead_id: string | null;
          meeting_url: string | null;
          notes: string | null;
          source: string;
          start_at: string;
          status: Database["public"]["Enums"]["booking_status"];
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          attendee_email?: string | null;
          attendee_name?: string | null;
          attendee_phone?: string | null;
          created_at?: string;
          description?: string | null;
          end_at: string;
          external_id?: string | null;
          id?: string;
          lead_id?: string | null;
          meeting_url?: string | null;
          notes?: string | null;
          source?: string;
          start_at: string;
          status?: Database["public"]["Enums"]["booking_status"];
          title: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          attendee_email?: string | null;
          attendee_name?: string | null;
          attendee_phone?: string | null;
          created_at?: string;
          description?: string | null;
          end_at?: string;
          external_id?: string | null;
          id?: string;
          lead_id?: string | null;
          meeting_url?: string | null;
          notes?: string | null;
          source?: string;
          start_at?: string;
          status?: Database["public"]["Enums"]["booking_status"];
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "calendar_bookings_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calendar_bookings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_connections: {
        Row: {
          calcom_credential_id: number | null;
          created_at: string;
          email: string | null;
          external_id: string;
          id: string;
          is_availability: boolean;
          is_primary_booking: boolean;
          last_synced_at: string | null;
          name: string | null;
          provider: string;
          read_only: boolean;
          updated_at: string;
          user_id: string;
          workspace_id: string | null;
        };
        Insert: {
          calcom_credential_id?: number | null;
          created_at?: string;
          email?: string | null;
          external_id: string;
          id?: string;
          is_availability?: boolean;
          is_primary_booking?: boolean;
          last_synced_at?: string | null;
          name?: string | null;
          provider?: string;
          read_only?: boolean;
          updated_at?: string;
          user_id: string;
          workspace_id?: string | null;
        };
        Update: {
          calcom_credential_id?: number | null;
          created_at?: string;
          email?: string | null;
          external_id?: string;
          id?: string;
          is_availability?: boolean;
          is_primary_booking?: boolean;
          last_synced_at?: string | null;
          name?: string | null;
          provider?: string;
          read_only?: boolean;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "calendar_connections_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      calls: {
        Row: {
          agent_id: string | null;
          agent_name: string | null;
          call_outcome: string | null;
          call_status: Database["public"]["Enums"]["call_status"];
          call_successful: boolean | null;
          call_summary: string | null;
          call_type: Database["public"]["Enums"]["call_type"];
          cost_cents: number | null;
          created_at: string;
          disconnection_reason: string | null;
          duration_seconds: number | null;
          ended_at: string | null;
          from_number: string | null;
          id: string;
          in_voicemail: boolean | null;
          lead_id: string | null;
          recording_url: string | null;
          retell_call_id: string | null;
          sentiment: Database["public"]["Enums"]["sentiment_kind"] | null;
          started_at: string | null;
          to_number: string;
          transcript: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          agent_id?: string | null;
          agent_name?: string | null;
          call_outcome?: string | null;
          call_status?: Database["public"]["Enums"]["call_status"];
          call_successful?: boolean | null;
          call_summary?: string | null;
          call_type?: Database["public"]["Enums"]["call_type"];
          cost_cents?: number | null;
          created_at?: string;
          disconnection_reason?: string | null;
          duration_seconds?: number | null;
          ended_at?: string | null;
          from_number?: string | null;
          id?: string;
          in_voicemail?: boolean | null;
          lead_id?: string | null;
          recording_url?: string | null;
          retell_call_id?: string | null;
          sentiment?: Database["public"]["Enums"]["sentiment_kind"] | null;
          started_at?: string | null;
          to_number: string;
          transcript?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          agent_id?: string | null;
          agent_name?: string | null;
          call_outcome?: string | null;
          call_status?: Database["public"]["Enums"]["call_status"];
          call_successful?: boolean | null;
          call_summary?: string | null;
          call_type?: Database["public"]["Enums"]["call_type"];
          cost_cents?: number | null;
          created_at?: string;
          disconnection_reason?: string | null;
          duration_seconds?: number | null;
          ended_at?: string | null;
          from_number?: string | null;
          id?: string;
          in_voicemail?: boolean | null;
          lead_id?: string | null;
          recording_url?: string | null;
          retell_call_id?: string | null;
          sentiment?: Database["public"]["Enums"]["sentiment_kind"] | null;
          started_at?: string | null;
          to_number?: string;
          transcript?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "calls_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calls_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      data_records: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          assigned_agent_id: string | null;
          bedrooms: string | null;
          call_status: Database["public"]["Enums"]["data_record_call_status"];
          city: string | null;
          client_name: string | null;
          created_at: string;
          email: string | null;
          first_name: string | null;
          id: string;
          is_active: boolean;
          is_deleted: boolean;
          last_call_at: string | null;
          last_call_outcome: string | null;
          last_call_sentiment: string | null;
          last_name: string | null;
          lead_external_id: string | null;
          meta: Json;
          mobile_number: string;
          name: string;
          need_to_call: boolean;
          postal_code: string | null;
          property_type: string | null;
          scheduled_call_at: string | null;
          state: string | null;
          title: string | null;
          unique_id: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          assigned_agent_id?: string | null;
          bedrooms?: string | null;
          call_status?: Database["public"]["Enums"]["data_record_call_status"];
          city?: string | null;
          client_name?: string | null;
          created_at?: string;
          email?: string | null;
          first_name?: string | null;
          id?: string;
          is_active?: boolean;
          is_deleted?: boolean;
          last_call_at?: string | null;
          last_call_outcome?: string | null;
          last_call_sentiment?: string | null;
          last_name?: string | null;
          lead_external_id?: string | null;
          meta?: Json;
          mobile_number: string;
          name: string;
          need_to_call?: boolean;
          postal_code?: string | null;
          property_type?: string | null;
          scheduled_call_at?: string | null;
          state?: string | null;
          title?: string | null;
          unique_id?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          assigned_agent_id?: string | null;
          bedrooms?: string | null;
          call_status?: Database["public"]["Enums"]["data_record_call_status"];
          city?: string | null;
          client_name?: string | null;
          created_at?: string;
          email?: string | null;
          first_name?: string | null;
          id?: string;
          is_active?: boolean;
          is_deleted?: boolean;
          last_call_at?: string | null;
          last_call_outcome?: string | null;
          last_call_sentiment?: string | null;
          last_name?: string | null;
          lead_external_id?: string | null;
          meta?: Json;
          mobile_number?: string;
          name?: string;
          need_to_call?: boolean;
          postal_code?: string | null;
          property_type?: string | null;
          scheduled_call_at?: string | null;
          state?: string | null;
          title?: string | null;
          unique_id?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "data_records_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      deployments: {
        Row: {
          agent_id: string;
          deployed_at: string;
          deployed_by: string;
          error: string | null;
          id: string;
          payload: Json | null;
          provider: string;
          provider_agent_id: string | null;
          provider_flow_id: string | null;
          status: string;
          workspace_id: string;
        };
        Insert: {
          agent_id: string;
          deployed_at?: string;
          deployed_by: string;
          error?: string | null;
          id?: string;
          payload?: Json | null;
          provider?: string;
          provider_agent_id?: string | null;
          provider_flow_id?: string | null;
          status?: string;
          workspace_id: string;
        };
        Update: {
          agent_id?: string;
          deployed_at?: string;
          deployed_by?: string;
          error?: string | null;
          id?: string;
          payload?: Json | null;
          provider?: string;
          provider_agent_id?: string | null;
          provider_flow_id?: string | null;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deployments_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deployments_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      email_send_log: {
        Row: {
          created_at: string;
          error_message: string | null;
          id: string;
          message_id: string | null;
          metadata: Json | null;
          recipient_email: string;
          status: string;
          template_name: string;
        };
        Insert: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          message_id?: string | null;
          metadata?: Json | null;
          recipient_email: string;
          status: string;
          template_name: string;
        };
        Update: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          message_id?: string | null;
          metadata?: Json | null;
          recipient_email?: string;
          status?: string;
          template_name?: string;
        };
        Relationships: [];
      };
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number;
          batch_size: number;
          id: number;
          retry_after_until: string | null;
          send_delay_ms: number;
          transactional_email_ttl_minutes: number;
          updated_at: string;
        };
        Insert: {
          auth_email_ttl_minutes?: number;
          batch_size?: number;
          id?: number;
          retry_after_until?: string | null;
          send_delay_ms?: number;
          transactional_email_ttl_minutes?: number;
          updated_at?: string;
        };
        Update: {
          auth_email_ttl_minutes?: number;
          batch_size?: number;
          id?: number;
          retry_after_until?: string | null;
          send_delay_ms?: number;
          transactional_email_ttl_minutes?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_unsubscribe_tokens: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          token: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          token: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          attempt_count: number;
          bank_statements_status: string | null;
          bank_statements_uploaded: boolean;
          business_address: string | null;
          business_type: string | null;
          call_outcome: string | null;
          callback_requested: boolean;
          company_name: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          funding_amount: number | null;
          id: string;
          last_contacted_at: string | null;
          missing_information: string | null;
          monthly_revenue: number | null;
          notes: string | null;
          phone: string;
          sent_to_underwriting: boolean;
          sentiment: Database["public"]["Enums"]["sentiment_kind"] | null;
          source: Database["public"]["Enums"]["lead_source"];
          state_name: string | null;
          status: Database["public"]["Enums"]["lead_status"];
          type: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          attempt_count?: number;
          bank_statements_status?: string | null;
          bank_statements_uploaded?: boolean;
          business_address?: string | null;
          business_type?: string | null;
          call_outcome?: string | null;
          callback_requested?: boolean;
          company_name?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          funding_amount?: number | null;
          id?: string;
          last_contacted_at?: string | null;
          missing_information?: string | null;
          monthly_revenue?: number | null;
          notes?: string | null;
          phone: string;
          sent_to_underwriting?: boolean;
          sentiment?: Database["public"]["Enums"]["sentiment_kind"] | null;
          source?: Database["public"]["Enums"]["lead_source"];
          state_name?: string | null;
          status?: Database["public"]["Enums"]["lead_status"];
          type?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          attempt_count?: number;
          bank_statements_status?: string | null;
          bank_statements_uploaded?: boolean;
          business_address?: string | null;
          business_type?: string | null;
          call_outcome?: string | null;
          callback_requested?: boolean;
          company_name?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          funding_amount?: number | null;
          id?: string;
          last_contacted_at?: string | null;
          missing_information?: string | null;
          monthly_revenue?: number | null;
          notes?: string | null;
          phone?: string;
          sent_to_underwriting?: boolean;
          sentiment?: Database["public"]["Enums"]["sentiment_kind"] | null;
          source?: Database["public"]["Enums"]["lead_source"];
          state_name?: string | null;
          status?: Database["public"]["Enums"]["lead_status"];
          type?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leads_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          admin_reviewed_at: string | null;
          admin_reviewed_by: string | null;
          approval_decided_at: string | null;
          approval_token: string;
          approved: boolean;
          created_at: string;
          default_workspace_id: string | null;
          denied: boolean;
          email: string;
          full_name: string | null;
          id: string;
          spend_limit_cents: number;
          spend_used_cents: number;
          updated_at: string;
          user_id: string;
          user_type: Database["public"]["Enums"]["user_type"];
        };
        Insert: {
          admin_reviewed_at?: string | null;
          admin_reviewed_by?: string | null;
          approval_decided_at?: string | null;
          approval_token?: string;
          approved?: boolean;
          created_at?: string;
          default_workspace_id?: string | null;
          denied?: boolean;
          email: string;
          full_name?: string | null;
          id?: string;
          spend_limit_cents?: number;
          spend_used_cents?: number;
          updated_at?: string;
          user_id: string;
          user_type?: Database["public"]["Enums"]["user_type"];
        };
        Update: {
          admin_reviewed_at?: string | null;
          admin_reviewed_by?: string | null;
          approval_decided_at?: string | null;
          approval_token?: string;
          approved?: boolean;
          created_at?: string;
          default_workspace_id?: string | null;
          denied?: boolean;
          email?: string;
          full_name?: string | null;
          id?: string;
          spend_limit_cents?: number;
          spend_used_cents?: number;
          updated_at?: string;
          user_id?: string;
          user_type?: Database["public"]["Enums"]["user_type"];
        };
        Relationships: [
          {
            foreignKeyName: "profiles_default_workspace_id_fkey";
            columns: ["default_workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      retell_webhook_events: {
        Row: {
          error_message: string | null;
          event_type: string;
          id: string;
          payload: Json;
          processed_at: string | null;
          processing_status: string;
          received_at: string;
          retell_agent_id: string | null;
          retell_call_id: string | null;
          signature_valid: boolean | null;
          workspace_id: string | null;
        };
        Insert: {
          error_message?: string | null;
          event_type: string;
          id?: string;
          payload?: Json;
          processed_at?: string | null;
          processing_status?: string;
          received_at?: string;
          retell_agent_id?: string | null;
          retell_call_id?: string | null;
          signature_valid?: boolean | null;
          workspace_id?: string | null;
        };
        Update: {
          error_message?: string | null;
          event_type?: string;
          id?: string;
          payload?: Json;
          processed_at?: string | null;
          processing_status?: string;
          received_at?: string;
          retell_agent_id?: string | null;
          retell_call_id?: string | null;
          signature_valid?: boolean | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "retell_webhook_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          environment: string;
          id: string;
          price_id: string;
          product_id: string;
          status: string;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          updated_at: string;
          user_id: string;
          workspace_id: string | null;
        };
        Insert: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          environment?: string;
          id?: string;
          price_id: string;
          product_id: string;
          status?: string;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          updated_at?: string;
          user_id: string;
          workspace_id?: string | null;
        };
        Update: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          environment?: string;
          id?: string;
          price_id?: string;
          product_id?: string;
          status?: string;
          stripe_customer_id?: string;
          stripe_subscription_id?: string;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      suppressed_emails: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          metadata: Json | null;
          reason: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          metadata?: Json | null;
          reason: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          metadata?: Json | null;
          reason?: string;
        };
        Relationships: [];
      };
      usage_events: {
        Row: {
          agent_id: string | null;
          cost_cents: number;
          created_at: string;
          environment: string;
          id: string;
          minutes: number;
          model_id: string | null;
          occurred_at: string;
          retell_call_id: string | null;
          user_id: string;
          workspace_id: string | null;
        };
        Insert: {
          agent_id?: string | null;
          cost_cents?: number;
          created_at?: string;
          environment?: string;
          id?: string;
          minutes?: number;
          model_id?: string | null;
          occurred_at?: string;
          retell_call_id?: string | null;
          user_id: string;
          workspace_id?: string | null;
        };
        Update: {
          agent_id?: string | null;
          cost_cents?: number;
          created_at?: string;
          environment?: string;
          id?: string;
          minutes?: number;
          model_id?: string | null;
          occurred_at?: string;
          retell_call_id?: string | null;
          user_id?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "usage_events_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usage_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      whatsapp_messages: {
        Row: {
          body: string | null;
          contact_name: string | null;
          contact_phone: string;
          created_at: string;
          direction: Database["public"]["Enums"]["message_direction"];
          external_id: string | null;
          id: string;
          lead_id: string | null;
          media_url: string | null;
          sent_at: string;
          status: Database["public"]["Enums"]["message_status"];
          workspace_id: string;
        };
        Insert: {
          body?: string | null;
          contact_name?: string | null;
          contact_phone: string;
          created_at?: string;
          direction: Database["public"]["Enums"]["message_direction"];
          external_id?: string | null;
          id?: string;
          lead_id?: string | null;
          media_url?: string | null;
          sent_at?: string;
          status?: Database["public"]["Enums"]["message_status"];
          workspace_id: string;
        };
        Update: {
          body?: string | null;
          contact_name?: string | null;
          contact_phone?: string;
          created_at?: string;
          direction?: Database["public"]["Enums"]["message_direction"];
          external_id?: string | null;
          id?: string;
          lead_id?: string | null;
          media_url?: string | null;
          sent_at?: string;
          status?: Database["public"]["Enums"]["message_status"];
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_messages_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_api_tokens: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          last_used_at: string | null;
          name: string;
          prefix: string;
          revoked_at: string | null;
          token_hash: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          last_used_at?: string | null;
          name: string;
          prefix: string;
          revoked_at?: string | null;
          token_hash: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          last_used_at?: string | null;
          name?: string;
          prefix?: string;
          revoked_at?: string | null;
          token_hash?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_api_tokens_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_invites: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string;
          role: Database["public"]["Enums"]["workspace_role"];
          token: string;
          workspace_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          token?: string;
          workspace_id: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          token?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_requests: {
        Row: {
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          id: string;
          status: string;
          updated_at: string;
          user_id: string;
          workspace_name: string;
        };
        Insert: {
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          id?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
          workspace_name: string;
        };
        Update: {
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
          workspace_name?: string;
        };
        Relationships: [];
      };
      workspace_settings: {
        Row: {
          buffer_minutes: number;
          business_hours: Json;
          business_name: string | null;
          calcom_api_key: string | null;
          calcom_api_token: string | null;
          calcom_event_type_id: string | null;
          calcom_webhook_secret: string | null;
          call_schedule: Json;
          created_at: string;
          default_event_type_id: number | null;
          ghl_api_key: string | null;
          ghl_location_id: string | null;
          hubspot_api_key: string | null;
          last_synced_at: string | null;
          min_notice_hours: number;
          notification_email: string | null;
          retell_default_agent_id: string | null;
          openai_realtime_inbound_url: string | null;
          retell_workspace_id: string | null;
          timezone: string;
          twilio_account_sid: string | null;
          twilio_auth_token: string | null;
          updated_at: string;
          whatsapp_phone_id: string | null;
          whatsapp_provider: string | null;
          working_hours: Json;
          workspace_id: string;
        };
        Insert: {
          buffer_minutes?: number;
          business_hours?: Json;
          business_name?: string | null;
          calcom_api_key?: string | null;
          calcom_api_token?: string | null;
          calcom_event_type_id?: string | null;
          calcom_webhook_secret?: string | null;
          call_schedule?: Json;
          created_at?: string;
          default_event_type_id?: number | null;
          ghl_api_key?: string | null;
          ghl_location_id?: string | null;
          hubspot_api_key?: string | null;
          last_synced_at?: string | null;
          min_notice_hours?: number;
          notification_email?: string | null;
          openai_realtime_inbound_url?: string | null;
          retell_default_agent_id?: string | null;
          retell_workspace_id?: string | null;
          timezone?: string;
          twilio_account_sid?: string | null;
          twilio_auth_token?: string | null;
          updated_at?: string;
          whatsapp_phone_id?: string | null;
          whatsapp_provider?: string | null;
          working_hours?: Json;
          workspace_id: string;
        };
        Update: {
          buffer_minutes?: number;
          business_hours?: Json;
          business_name?: string | null;
          calcom_api_key?: string | null;
          calcom_api_token?: string | null;
          calcom_event_type_id?: string | null;
          calcom_webhook_secret?: string | null;
          call_schedule?: Json;
          created_at?: string;
          default_event_type_id?: number | null;
          ghl_api_key?: string | null;
          ghl_location_id?: string | null;
          hubspot_api_key?: string | null;
          last_synced_at?: string | null;
          min_notice_hours?: number;
          notification_email?: string | null;
          openai_realtime_inbound_url?: string | null;
          retell_default_agent_id?: string | null;
          retell_workspace_id?: string | null;
          timezone?: string;
          twilio_account_sid?: string | null;
          twilio_auth_token?: string | null;
          updated_at?: string;
          whatsapp_phone_id?: string | null;
          whatsapp_provider?: string | null;
          working_hours?: Json;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner_id: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner_id: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_id?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string };
        Returns: boolean;
      };
      enqueue_email: {
        Args: { payload: Json; queue_name: string };
        Returns: number;
      };
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean };
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string };
        Returns: boolean;
      };
      move_to_dlq: {
        Args: {
          dlq_name: string;
          message_id: number;
          payload: Json;
          source_queue: string;
        };
        Returns: number;
      };
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number };
        Returns: {
          message: Json;
          msg_id: number;
          read_ct: number;
        }[];
      };
      workspace_role_of: {
        Args: { _user_id: string; _workspace_id: string };
        Returns: Database["public"]["Enums"]["workspace_role"];
      };
    };
    Enums: {
      agent_flow_type: "lead_gen" | "receptionist";
      app_role: "admin" | "user";
      booking_status:
        | "pending"
        | "accepted"
        | "completed"
        | "cancelled"
        | "rescheduled"
        | "no_show";
      call_status:
        | "initiated"
        | "ringing"
        | "in_progress"
        | "completed"
        | "no_answer"
        | "busy"
        | "failed"
        | "voicemail";
      call_type: "inbound" | "outbound";
      data_record_call_status:
        | "needs_to_call"
        | "queued"
        | "calling"
        | "completed"
        | "failed"
        | "do_not_call";
      lead_source: "website" | "inbound" | "outbound" | "referral" | "import";
      lead_status:
        | "need_to_call"
        | "calling"
        | "completed"
        | "interested"
        | "not_interested"
        | "not_connected"
        | "do_not_call"
        | "qualified";
      message_direction: "inbound" | "outbound";
      message_status: "queued" | "sent" | "delivered" | "read" | "failed";
      sentiment_kind: "positive" | "neutral" | "negative";
      user_type: "admin" | "user";
      workspace_role: "owner" | "admin" | "member";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      agent_flow_type: ["lead_gen", "receptionist"],
      app_role: ["admin", "user"],
      booking_status: ["pending", "accepted", "completed", "cancelled", "rescheduled", "no_show"],
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
      lead_source: ["website", "inbound", "outbound", "referral", "import"],
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
} as const;
