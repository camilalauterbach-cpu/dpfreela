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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      access_repair_logs: {
        Row: {
          created_at: string
          email: string | null
          id: string
          profile_created: boolean
          reason: string
          role_assigned: boolean
          roles_after: Database["public"]["Enums"]["app_role"][]
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          profile_created?: boolean
          reason: string
          role_assigned?: boolean
          roles_after?: Database["public"]["Enums"]["app_role"][]
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          profile_created?: boolean
          reason?: string
          role_assigned?: boolean
          roles_after?: Database["public"]["Enums"]["app_role"][]
          user_id?: string
        }
        Relationships: []
      }
      change_logs: {
        Row: {
          action: string
          changed_by: string | null
          created_at: string
          id: string
          ip_address: unknown
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          changed_by?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          address: string | null
          city: string | null
          cnpj: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          legal_name: string
          notes: string | null
          phone: string | null
          state: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          cnpj?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          legal_name: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          cnpj?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          legal_name?: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      document_compliance_history: {
        Row: {
          changed_by: string | null
          created_at: string
          current_status: string
          document_type_id: string | null
          employment_link_id: string
          entity_type: string
          event_source: string
          id: string
          override_action: string | null
          previous_status: string | null
          reason: string | null
          state_hash: string | null
          worker_document_id: string | null
          worker_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          current_status: string
          document_type_id?: string | null
          employment_link_id: string
          entity_type: string
          event_source: string
          id?: string
          override_action?: string | null
          previous_status?: string | null
          reason?: string | null
          state_hash?: string | null
          worker_document_id?: string | null
          worker_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          current_status?: string
          document_type_id?: string | null
          employment_link_id?: string
          entity_type?: string
          event_source?: string
          id?: string
          override_action?: string | null
          previous_status?: string | null
          reason?: string | null
          state_hash?: string | null
          worker_document_id?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_compliance_history_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_compliance_history_employment_link_id_fkey"
            columns: ["employment_link_id"]
            isOneToOne: false
            referencedRelation: "employment_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_compliance_history_worker_document_id_fkey"
            columns: ["worker_document_id"]
            isOneToOne: false
            referencedRelation: "worker_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_compliance_history_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      document_type_scope_backfill_unmatched: {
        Row: {
          category: string
          code: string
          created_at: string
          document_type_id: string
          id: string
          name: string
          notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_scope:
            | Database["public"]["Enums"]["document_storage_scope"]
            | null
          suggested_scope: Database["public"]["Enums"]["document_storage_scope"]
          suggestion_reason: string
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          document_type_id: string
          id?: string
          name: string
          notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_scope?:
            | Database["public"]["Enums"]["document_storage_scope"]
            | null
          suggested_scope: Database["public"]["Enums"]["document_storage_scope"]
          suggestion_reason: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          document_type_id?: string
          id?: string
          name?: string
          notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_scope?:
            | Database["public"]["Enums"]["document_storage_scope"]
            | null
          suggested_scope?: Database["public"]["Enums"]["document_storage_scope"]
          suggestion_reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_type_scope_backfill_unmatched_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: true
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
        ]
      }
      document_types: {
        Row: {
          category: string
          code: string
          created_at: string
          created_by: string | null
          default_validity_days: number | null
          display_order: number
          has_expiration: boolean
          id: string
          is_active: boolean
          name: string
          needs_review: boolean
          notes: string | null
          requires_file: boolean
          storage_scope:
            | Database["public"]["Enums"]["document_storage_scope"]
            | null
          updated_at: string
          validity_mode:
            | Database["public"]["Enums"]["document_validity_mode"]
            | null
          validity_unit:
            | Database["public"]["Enums"]["document_validity_unit"]
            | null
          validity_value: number | null
        }
        Insert: {
          category?: string
          code: string
          created_at?: string
          created_by?: string | null
          default_validity_days?: number | null
          display_order?: number
          has_expiration?: boolean
          id?: string
          is_active?: boolean
          name: string
          needs_review?: boolean
          notes?: string | null
          requires_file?: boolean
          storage_scope?:
            | Database["public"]["Enums"]["document_storage_scope"]
            | null
          updated_at?: string
          validity_mode?:
            | Database["public"]["Enums"]["document_validity_mode"]
            | null
          validity_unit?:
            | Database["public"]["Enums"]["document_validity_unit"]
            | null
          validity_value?: number | null
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          created_by?: string | null
          default_validity_days?: number | null
          display_order?: number
          has_expiration?: boolean
          id?: string
          is_active?: boolean
          name?: string
          needs_review?: boolean
          notes?: string | null
          requires_file?: boolean
          storage_scope?:
            | Database["public"]["Enums"]["document_storage_scope"]
            | null
          updated_at?: string
          validity_mode?:
            | Database["public"]["Enums"]["document_validity_mode"]
            | null
          validity_unit?:
            | Database["public"]["Enums"]["document_validity_unit"]
            | null
          validity_value?: number | null
        }
        Relationships: []
      }
      employment_link_document_overrides: {
        Row: {
          action: Database["public"]["Enums"]["link_document_override_action"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          document_type_id: string
          employment_link_id: string
          id: string
          reason: string | null
          required_until: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["link_document_override_action"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_type_id: string
          employment_link_id: string
          id?: string
          reason?: string | null
          required_until?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["link_document_override_action"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_type_id?: string
          employment_link_id?: string
          id?: string
          reason?: string | null
          required_until?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employment_link_document_overrides_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_link_document_overrides_employment_link_id_fkey"
            columns: ["employment_link_id"]
            isOneToOne: false
            referencedRelation: "employment_links"
            referencedColumns: ["id"]
          },
        ]
      }
      employment_link_documents: {
        Row: {
          category: string | null
          created_at: string
          deleted_at: string | null
          document_number: string | null
          document_type: string
          employment_link_id: string | null
          event_id: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          id: string
          link_group_worker_id: string | null
          mime_type: string | null
          notes: string | null
          status: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          document_number?: string | null
          document_type: string
          employment_link_id?: string | null
          event_id?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          link_group_worker_id?: string | null
          mime_type?: string | null
          notes?: string | null
          status?: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          document_number?: string | null
          document_type?: string
          employment_link_id?: string | null
          event_id?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          link_group_worker_id?: string | null
          mime_type?: string | null
          notes?: string | null
          status?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employment_link_documents_employment_link_id_fkey"
            columns: ["employment_link_id"]
            isOneToOne: false
            referencedRelation: "employment_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_link_documents_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      employment_links: {
        Row: {
          assembly_point: string | null
          badge_number: string | null
          call_time: string | null
          company_id: string | null
          contract_type: string | null
          created_at: string
          daily_hours: number | null
          daily_rate: number | null
          deleted_at: string | null
          department: string | null
          end_date: string | null
          event_id: string | null
          fixed_salary: number | null
          has_meal_allowance: boolean
          has_transport_allowance: boolean
          hazard_pay: number | null
          hire_date: string | null
          hourly_rate: number | null
          id: string
          job_function: string | null
          job_role: string | null
          job_role_id: string | null
          last_compliance_check_at: string | null
          link_name: string | null
          locker_number: string | null
          meal_allowance: number | null
          meal_entitlement: string | null
          night_shift_rate: number | null
          notes: string | null
          other_allowances: number | null
          overtime_rate: number | null
          parking_spot: string | null
          payment_frequency: string | null
          remuneration_type: string | null
          required_documents: Json
          rest_days_pattern: string | null
          shift_type: string | null
          specific_work_dates: string[]
          status: string
          supervisor_contact: string | null
          supervisor_name: string | null
          transport_allowance: number | null
          transport_notes: string | null
          uniform_notes: string | null
          updated_at: string
          weekly_hours: number | null
          work_days_mode: string
          work_days_notes: string | null
          work_days_pattern: string | null
          work_schedule: string | null
          work_shift: string | null
          worker_id: string
        }
        Insert: {
          assembly_point?: string | null
          badge_number?: string | null
          call_time?: string | null
          company_id?: string | null
          contract_type?: string | null
          created_at?: string
          daily_hours?: number | null
          daily_rate?: number | null
          deleted_at?: string | null
          department?: string | null
          end_date?: string | null
          event_id?: string | null
          fixed_salary?: number | null
          has_meal_allowance?: boolean
          has_transport_allowance?: boolean
          hazard_pay?: number | null
          hire_date?: string | null
          hourly_rate?: number | null
          id?: string
          job_function?: string | null
          job_role?: string | null
          job_role_id?: string | null
          last_compliance_check_at?: string | null
          link_name?: string | null
          locker_number?: string | null
          meal_allowance?: number | null
          meal_entitlement?: string | null
          night_shift_rate?: number | null
          notes?: string | null
          other_allowances?: number | null
          overtime_rate?: number | null
          parking_spot?: string | null
          payment_frequency?: string | null
          remuneration_type?: string | null
          required_documents?: Json
          rest_days_pattern?: string | null
          shift_type?: string | null
          specific_work_dates?: string[]
          status?: string
          supervisor_contact?: string | null
          supervisor_name?: string | null
          transport_allowance?: number | null
          transport_notes?: string | null
          uniform_notes?: string | null
          updated_at?: string
          weekly_hours?: number | null
          work_days_mode?: string
          work_days_notes?: string | null
          work_days_pattern?: string | null
          work_schedule?: string | null
          work_shift?: string | null
          worker_id: string
        }
        Update: {
          assembly_point?: string | null
          badge_number?: string | null
          call_time?: string | null
          company_id?: string | null
          contract_type?: string | null
          created_at?: string
          daily_hours?: number | null
          daily_rate?: number | null
          deleted_at?: string | null
          department?: string | null
          end_date?: string | null
          event_id?: string | null
          fixed_salary?: number | null
          has_meal_allowance?: boolean
          has_transport_allowance?: boolean
          hazard_pay?: number | null
          hire_date?: string | null
          hourly_rate?: number | null
          id?: string
          job_function?: string | null
          job_role?: string | null
          job_role_id?: string | null
          last_compliance_check_at?: string | null
          link_name?: string | null
          locker_number?: string | null
          meal_allowance?: number | null
          meal_entitlement?: string | null
          night_shift_rate?: number | null
          notes?: string | null
          other_allowances?: number | null
          overtime_rate?: number | null
          parking_spot?: string | null
          payment_frequency?: string | null
          remuneration_type?: string | null
          required_documents?: Json
          rest_days_pattern?: string | null
          shift_type?: string | null
          specific_work_dates?: string[]
          status?: string
          supervisor_contact?: string | null
          supervisor_name?: string | null
          transport_allowance?: number | null
          transport_notes?: string | null
          uniform_notes?: string | null
          updated_at?: string
          weekly_hours?: number | null
          work_days_mode?: string
          work_days_notes?: string | null
          work_days_pattern?: string | null
          work_schedule?: string | null
          work_shift?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employment_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_links_job_role_id_fkey"
            columns: ["job_role_id"]
            isOneToOne: false
            referencedRelation: "job_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_links_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          city: string | null
          company_id: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          end_date: string | null
          id: string
          location: string | null
          name: string
          notes: string | null
          required_nrs: string[]
          required_nrs_other: string | null
          requires_epi_form: boolean
          requires_service_order: boolean
          start_date: string | null
          state: string | null
          status: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          required_nrs?: string[]
          required_nrs_other?: string | null
          requires_epi_form?: boolean
          requires_service_order?: boolean
          start_date?: string | null
          state?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          required_nrs?: string[]
          required_nrs_other?: string | null
          requires_epi_form?: boolean
          requires_service_order?: boolean
          start_date?: string | null
          state?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_attempts: {
        Row: {
          attempted_at: string
          id: number
          ip_hash: string
          success: boolean
          token_hash_prefix: string | null
        }
        Insert: {
          attempted_at?: string
          id?: never
          ip_hash: string
          success?: boolean
          token_hash_prefix?: string | null
        }
        Update: {
          attempted_at?: string
          id?: never
          ip_hash?: string
          success?: boolean
          token_hash_prefix?: string | null
        }
        Relationships: []
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_auth_user_id: string | null
          accepted_profile_id: string | null
          attempt_count: number
          created_at: string
          created_by: string
          email_normalized: string
          expires_at: string
          id: string
          last_error_code: string | null
          linked_worker_id: string | null
          processing_nonce: string | null
          processing_started_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_auth_user_id?: string | null
          accepted_profile_id?: string | null
          attempt_count?: number
          created_at?: string
          created_by: string
          email_normalized: string
          expires_at: string
          id?: string
          last_error_code?: string | null
          linked_worker_id?: string | null
          processing_nonce?: string | null
          processing_started_at?: string | null
          role: Database["public"]["Enums"]["app_role"]
          status?: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_auth_user_id?: string | null
          accepted_profile_id?: string | null
          attempt_count?: number
          created_at?: string
          created_by?: string
          email_normalized?: string
          expires_at?: string
          id?: string
          last_error_code?: string | null
          linked_worker_id?: string | null
          processing_nonce?: string | null
          processing_started_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_linked_worker_id_fkey"
            columns: ["linked_worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      job_role_backfill_unmatched: {
        Row: {
          created_at: string
          id: string
          normalized_text: string
          occurrences: number
          original_text: string
          source_row_id: string
          source_table: string
          suggested_name: string
          suggested_slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          normalized_text: string
          occurrences?: number
          original_text: string
          source_row_id: string
          source_table: string
          suggested_name: string
          suggested_slug: string
        }
        Update: {
          created_at?: string
          id?: string
          normalized_text?: string
          occurrences?: number
          original_text?: string
          source_row_id?: string
          source_table?: string
          suggested_name?: string
          suggested_slug?: string
        }
        Relationships: []
      }
      job_role_document_requirements: {
        Row: {
          created_at: string
          created_by: string | null
          display_order: number
          document_type_id: string
          id: string
          is_mandatory: boolean
          job_role_id: string
          notes: string | null
          required_by: string
          updated_at: string
          validity_days_override: number | null
          validity_override_unit:
            | Database["public"]["Enums"]["document_validity_unit"]
            | null
          validity_override_value: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          document_type_id: string
          id?: string
          is_mandatory?: boolean
          job_role_id: string
          notes?: string | null
          required_by?: string
          updated_at?: string
          validity_days_override?: number | null
          validity_override_unit?:
            | Database["public"]["Enums"]["document_validity_unit"]
            | null
          validity_override_value?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_order?: number
          document_type_id?: string
          id?: string
          is_mandatory?: boolean
          job_role_id?: string
          notes?: string | null
          required_by?: string
          updated_at?: string
          validity_days_override?: number | null
          validity_override_unit?:
            | Database["public"]["Enums"]["document_validity_unit"]
            | null
          validity_override_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_role_document_requirements_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_role_document_requirements_job_role_id_fkey"
            columns: ["job_role_id"]
            isOneToOne: false
            referencedRelation: "job_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_roles: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      job_roles_hygiene_snapshots: {
        Row: {
          baseline: Json
          criterion: string
          data_fingerprint: string
          generated_at: string
          generated_by: string
          id: string
          report: Json
          report_hash: string
          report_schema_version: number
          saved_at: string
          summary: Json
        }
        Insert: {
          baseline: Json
          criterion: string
          data_fingerprint: string
          generated_at: string
          generated_by: string
          id?: string
          report: Json
          report_hash: string
          report_schema_version?: number
          saved_at?: string
          summary: Json
        }
        Update: {
          baseline?: Json
          criterion?: string
          data_fingerprint?: string
          generated_at?: string
          generated_by?: string
          id?: string
          report?: Json
          report_hash?: string
          report_schema_version?: number
          saved_at?: string
          summary?: Json
        }
        Relationships: []
      }
      link_group_workers: {
        Row: {
          call_time: string | null
          category_reference_rate: number | null
          contract_type: string | null
          created_at: string
          daily_hours: number | null
          daily_rate: number | null
          deleted_at: string | null
          department: string | null
          employment_link_id: string | null
          end_date: string | null
          fixed_salary: number | null
          has_meal_allowance: boolean
          has_transport_allowance: boolean
          hire_date: string | null
          hourly_rate: number | null
          id: string
          job_function: string | null
          job_role: string | null
          job_role_id: string | null
          link_group_id: string
          meal_allowance: number | null
          notes: string | null
          payment_frequency: string | null
          remuneration_type: string | null
          shift_type: string | null
          status: string
          transport_allowance: number | null
          updated_at: string
          weekly_hours: number | null
          work_schedule: string | null
          work_shift: string | null
          worker_id: string
        }
        Insert: {
          call_time?: string | null
          category_reference_rate?: number | null
          contract_type?: string | null
          created_at?: string
          daily_hours?: number | null
          daily_rate?: number | null
          deleted_at?: string | null
          department?: string | null
          employment_link_id?: string | null
          end_date?: string | null
          fixed_salary?: number | null
          has_meal_allowance?: boolean
          has_transport_allowance?: boolean
          hire_date?: string | null
          hourly_rate?: number | null
          id?: string
          job_function?: string | null
          job_role?: string | null
          job_role_id?: string | null
          link_group_id: string
          meal_allowance?: number | null
          notes?: string | null
          payment_frequency?: string | null
          remuneration_type?: string | null
          shift_type?: string | null
          status?: string
          transport_allowance?: number | null
          updated_at?: string
          weekly_hours?: number | null
          work_schedule?: string | null
          work_shift?: string | null
          worker_id: string
        }
        Update: {
          call_time?: string | null
          category_reference_rate?: number | null
          contract_type?: string | null
          created_at?: string
          daily_hours?: number | null
          daily_rate?: number | null
          deleted_at?: string | null
          department?: string | null
          employment_link_id?: string | null
          end_date?: string | null
          fixed_salary?: number | null
          has_meal_allowance?: boolean
          has_transport_allowance?: boolean
          hire_date?: string | null
          hourly_rate?: number | null
          id?: string
          job_function?: string | null
          job_role?: string | null
          job_role_id?: string | null
          link_group_id?: string
          meal_allowance?: number | null
          notes?: string | null
          payment_frequency?: string | null
          remuneration_type?: string | null
          shift_type?: string | null
          status?: string
          transport_allowance?: number | null
          updated_at?: string
          weekly_hours?: number | null
          work_schedule?: string | null
          work_shift?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_group_workers_employment_link_id_fkey"
            columns: ["employment_link_id"]
            isOneToOne: false
            referencedRelation: "employment_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_group_workers_job_role_id_fkey"
            columns: ["job_role_id"]
            isOneToOne: false
            referencedRelation: "job_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_group_workers_link_group_id_fkey"
            columns: ["link_group_id"]
            isOneToOne: false
            referencedRelation: "link_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_group_workers_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      link_groups: {
        Row: {
          allowed_contract_types: string
          assembly_point: string | null
          call_time: string | null
          company_id: string | null
          created_at: string
          daily_hours: number | null
          deleted_at: string | null
          end_date: string | null
          event_id: string
          group_name: string
          hire_date: string | null
          id: string
          meal_entitlement: string | null
          notes: string | null
          required_documents: Json
          shift_type: string | null
          specific_work_dates: string[]
          status: string
          supervisor_name: string | null
          transport_notes: string | null
          uniform_notes: string | null
          updated_at: string
          weekly_hours: number | null
          work_days_mode: string
          work_days_notes: string | null
          work_schedule: string | null
          work_shift: string | null
        }
        Insert: {
          allowed_contract_types?: string
          assembly_point?: string | null
          call_time?: string | null
          company_id?: string | null
          created_at?: string
          daily_hours?: number | null
          deleted_at?: string | null
          end_date?: string | null
          event_id: string
          group_name: string
          hire_date?: string | null
          id?: string
          meal_entitlement?: string | null
          notes?: string | null
          required_documents?: Json
          shift_type?: string | null
          specific_work_dates?: string[]
          status?: string
          supervisor_name?: string | null
          transport_notes?: string | null
          uniform_notes?: string | null
          updated_at?: string
          weekly_hours?: number | null
          work_days_mode?: string
          work_days_notes?: string | null
          work_schedule?: string | null
          work_shift?: string | null
        }
        Update: {
          allowed_contract_types?: string
          assembly_point?: string | null
          call_time?: string | null
          company_id?: string | null
          created_at?: string
          daily_hours?: number | null
          deleted_at?: string | null
          end_date?: string | null
          event_id?: string
          group_name?: string
          hire_date?: string | null
          id?: string
          meal_entitlement?: string | null
          notes?: string | null
          required_documents?: Json
          shift_type?: string | null
          specific_work_dates?: string[]
          status?: string
          supervisor_name?: string | null
          transport_notes?: string | null
          uniform_notes?: string | null
          updated_at?: string
          weekly_hours?: number | null
          work_days_mode?: string
          work_days_notes?: string | null
          work_schedule?: string | null
          work_shift?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "link_groups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_execution_log: {
        Row: {
          environment: string | null
          executed_at: string
          executed_by: string | null
          git_revision: string | null
          id: string
          migration_name: string
          notes: string | null
          phase: string
          success: boolean
        }
        Insert: {
          environment?: string | null
          executed_at?: string
          executed_by?: string | null
          git_revision?: string | null
          id?: string
          migration_name: string
          notes?: string | null
          phase: string
          success: boolean
        }
        Update: {
          environment?: string | null
          executed_at?: string
          executed_by?: string | null
          git_revision?: string | null
          id?: string
          migration_name?: string
          notes?: string | null
          phase?: string
          success?: boolean
        }
        Relationships: []
      }
      payment_receipts: {
        Row: {
          batch_id: string | null
          created_at: string
          deleted_at: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          id: string
          item_id: string | null
          mime_type: string | null
          notes: string | null
          receipt_number: string | null
          updated_at: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          item_id?: string | null
          mime_type?: string | null
          notes?: string | null
          receipt_number?: string | null
          updated_at?: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          item_id?: string | null
          mime_type?: string | null
          notes?: string | null
          receipt_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipts_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payroll_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "payroll_batch_items"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_batch_items: {
        Row: {
          base_amount: number
          batch_id: string
          bonuses: number | null
          created_at: string
          deductions: number | null
          deleted_at: string | null
          employment_link_id: string | null
          id: string
          net_amount: number
          notes: string | null
          overtime_amount: number | null
          status: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          base_amount?: number
          batch_id: string
          bonuses?: number | null
          created_at?: string
          deductions?: number | null
          deleted_at?: string | null
          employment_link_id?: string | null
          id?: string
          net_amount?: number
          notes?: string | null
          overtime_amount?: number | null
          status?: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          base_amount?: number
          batch_id?: string
          bonuses?: number | null
          created_at?: string
          deductions?: number | null
          deleted_at?: string | null
          employment_link_id?: string | null
          id?: string
          net_amount?: number
          notes?: string | null
          overtime_amount?: number | null
          status?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_batch_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payroll_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_batch_items_employment_link_id_fkey"
            columns: ["employment_link_id"]
            isOneToOne: false
            referencedRelation: "employment_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_batch_items_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_batches: {
        Row: {
          batch_name: string
          created_at: string
          deleted_at: string | null
          event_id: string | null
          id: string
          notes: string | null
          paid_at: string | null
          reference_month: string | null
          status: string
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          batch_name: string
          created_at?: string
          deleted_at?: string | null
          event_id?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          reference_month?: string | null
          status?: string
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          batch_name?: string
          created_at?: string
          deleted_at?: string | null
          event_id?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          reference_month?: string | null
          status?: string
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_batches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          access_disabled_at: string | null
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_disabled_at?: string | null
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_disabled_at?: string | null
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_filters: {
        Row: {
          created_at: string
          filter_config: Json
          filter_name: string
          id: string
          table_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filter_config?: Json
          filter_name: string
          id?: string
          table_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filter_config?: Json
          filter_name?: string
          id?: string
          table_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sst_migration_audit: {
        Row: {
          duration_ms: number | null
          employment_link_documents_migrated: number
          finished_at: string | null
          history_updated: number
          id: string
          migration_name: string
          started_at: string
          success: boolean | null
          unmatched: number
          worker_documents_migrated: number
        }
        Insert: {
          duration_ms?: number | null
          employment_link_documents_migrated?: number
          finished_at?: string | null
          history_updated?: number
          id?: string
          migration_name: string
          started_at: string
          success?: boolean | null
          unmatched?: number
          worker_documents_migrated?: number
        }
        Update: {
          duration_ms?: number | null
          employment_link_documents_migrated?: number
          finished_at?: string | null
          history_updated?: number
          id?: string
          migration_name?: string
          started_at?: string
          success?: boolean | null
          unmatched?: number
          worker_documents_migrated?: number
        }
        Relationships: []
      }
      sst_migration_unmatched: {
        Row: {
          created_at: string
          id: string
          nr_code: string | null
          reason: string
          source_id: string | null
          source_table: string
          worker_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          nr_code?: string | null
          reason: string
          source_id?: string | null
          source_table: string
          worker_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          nr_code?: string | null
          reason?: string
          source_id?: string | null
          source_table?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          created_at: string
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          setting_key: string
          setting_value?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
      worker_dependents: {
        Row: {
          birth_date: string | null
          cpf: string | null
          created_at: string
          deleted_at: string | null
          full_name: string
          id: string
          notes: string | null
          relationship: string | null
          updated_at: string
          worker_id: string
        }
        Insert: {
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name: string
          id?: string
          notes?: string | null
          relationship?: string | null
          updated_at?: string
          worker_id: string
        }
        Update: {
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          relationship?: string | null
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_dependents_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_documents: {
        Row: {
          category: string | null
          created_at: string
          deleted_at: string | null
          document_number: string | null
          document_type: string
          document_type_id: string | null
          expiry_date: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          id: string
          issue_date: string | null
          issuing_authority: string | null
          mime_type: string | null
          notes: string | null
          status: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          document_number?: string | null
          document_type: string
          document_type_id?: string | null
          expiry_date?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          issue_date?: string | null
          issuing_authority?: string | null
          mime_type?: string | null
          notes?: string | null
          status?: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          document_number?: string | null
          document_type?: string
          document_type_id?: string | null
          expiry_date?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          issue_date?: string | null
          issuing_authority?: string | null
          mime_type?: string | null
          notes?: string | null
          status?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_documents_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_documents_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_duplicate_reviews: {
        Row: {
          created_at: string
          criteria: string
          decision: string
          id: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          worker_a_id: string
          worker_b_id: string
        }
        Insert: {
          created_at?: string
          criteria: string
          decision?: string
          id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          worker_a_id: string
          worker_b_id: string
        }
        Update: {
          created_at?: string
          criteria?: string
          decision?: string
          id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          worker_a_id?: string
          worker_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_duplicate_reviews_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_duplicate_reviews_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_payment_methods: {
        Row: {
          account_number: string | null
          account_type: string | null
          agency: string | null
          bank_code: string | null
          bank_name: string | null
          created_at: string
          deleted_at: string | null
          holder_cpf: string | null
          holder_name: string | null
          id: string
          is_preferred: boolean
          method_type: string
          notes: string | null
          pix_key: string | null
          pix_key_type: string | null
          updated_at: string
          worker_id: string
        }
        Insert: {
          account_number?: string | null
          account_type?: string | null
          agency?: string | null
          bank_code?: string | null
          bank_name?: string | null
          created_at?: string
          deleted_at?: string | null
          holder_cpf?: string | null
          holder_name?: string | null
          id?: string
          is_preferred?: boolean
          method_type: string
          notes?: string | null
          pix_key?: string | null
          pix_key_type?: string | null
          updated_at?: string
          worker_id: string
        }
        Update: {
          account_number?: string | null
          account_type?: string | null
          agency?: string | null
          bank_code?: string | null
          bank_name?: string | null
          created_at?: string
          deleted_at?: string | null
          holder_cpf?: string | null
          holder_name?: string | null
          id?: string
          is_preferred?: boolean
          method_type?: string
          notes?: string | null
          pix_key?: string | null
          pix_key_type?: string | null
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_payment_methods_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_sst_qualifications: {
        Row: {
          certificate_file_name: string | null
          certificate_file_path: string | null
          certificate_mime_type: string | null
          certificate_uploaded_at: string | null
          chain_key: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          document_status: string
          document_type_id: string
          document_url: string | null
          employment_link_document_id: string | null
          event_id: string | null
          expires_at: string | null
          id: string
          instructor_name: string | null
          issued_at: string
          legacy_employment_link_document_id: string | null
          legacy_worker_document_id: string | null
          link_group_id: string | null
          link_group_worker_id: string | null
          notes: string | null
          nr_code: string
          provider_document: string | null
          provider_name: string | null
          revision_reason:
            | Database["public"]["Enums"]["sst_revision_reason"]
            | null
          revision_type: string
          source_type: string
          superseded_at: string | null
          supersedes_id: string | null
          training_type: string | null
          updated_at: string
          validity_status: string
          worker_id: string
          workload_hours: number | null
        }
        Insert: {
          certificate_file_name?: string | null
          certificate_file_path?: string | null
          certificate_mime_type?: string | null
          certificate_uploaded_at?: string | null
          chain_key?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_status?: string
          document_type_id: string
          document_url?: string | null
          employment_link_document_id?: string | null
          event_id?: string | null
          expires_at?: string | null
          id?: string
          instructor_name?: string | null
          issued_at: string
          legacy_employment_link_document_id?: string | null
          legacy_worker_document_id?: string | null
          link_group_id?: string | null
          link_group_worker_id?: string | null
          notes?: string | null
          nr_code: string
          provider_document?: string | null
          provider_name?: string | null
          revision_reason?:
            | Database["public"]["Enums"]["sst_revision_reason"]
            | null
          revision_type?: string
          source_type?: string
          superseded_at?: string | null
          supersedes_id?: string | null
          training_type?: string | null
          updated_at?: string
          validity_status?: string
          worker_id: string
          workload_hours?: number | null
        }
        Update: {
          certificate_file_name?: string | null
          certificate_file_path?: string | null
          certificate_mime_type?: string | null
          certificate_uploaded_at?: string | null
          chain_key?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_status?: string
          document_type_id?: string
          document_url?: string | null
          employment_link_document_id?: string | null
          event_id?: string | null
          expires_at?: string | null
          id?: string
          instructor_name?: string | null
          issued_at?: string
          legacy_employment_link_document_id?: string | null
          legacy_worker_document_id?: string | null
          link_group_id?: string | null
          link_group_worker_id?: string | null
          notes?: string | null
          nr_code?: string
          provider_document?: string | null
          provider_name?: string | null
          revision_reason?:
            | Database["public"]["Enums"]["sst_revision_reason"]
            | null
          revision_type?: string
          source_type?: string
          superseded_at?: string | null
          supersedes_id?: string | null
          training_type?: string | null
          updated_at?: string
          validity_status?: string
          worker_id?: string
          workload_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_sst_qualifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_employment_link_document_id_fkey"
            columns: ["employment_link_document_id"]
            isOneToOne: false
            referencedRelation: "employment_link_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_link_group_id_fkey"
            columns: ["link_group_id"]
            isOneToOne: false
            referencedRelation: "link_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_link_group_worker_id_fkey"
            columns: ["link_group_worker_id"]
            isOneToOne: false
            referencedRelation: "link_group_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "worker_sst_qualifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "worker_sst_qualifications_current"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "worker_sst_qualifications_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      workers: {
        Row: {
          address: string | null
          allergies: string | null
          birth_city: string | null
          birth_country: string | null
          birth_date: string | null
          birth_state: string | null
          blood_type: string | null
          city: string | null
          cpf: string
          cpf_normalized: string | null
          created_at: string
          ctps_number: string | null
          ctps_series: string | null
          ctps_state: string | null
          deleted_at: string | null
          education_level: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          father_name: string | null
          full_name: string
          gender: string | null
          id: string
          is_pcd: boolean
          is_rehabilitated: boolean
          linked_profile_id: string | null
          marital_status: string | null
          medical_conditions: string | null
          merged_at: string | null
          merged_by: string | null
          merged_into_worker_id: string | null
          mother_name: string | null
          nationality: string | null
          neighborhood: string | null
          nickname: string | null
          nis_pis: string | null
          notes: string | null
          pcd_notes: string | null
          pcd_type: string | null
          phone_main: string | null
          phone_secondary: string | null
          race_color: string | null
          registration_status: string
          rg: string | null
          rg_issue_date: string | null
          rg_issuer: string | null
          rg_state: string | null
          shirt_size: string | null
          shoe_size: string | null
          social_name: string | null
          state: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          allergies?: string | null
          birth_city?: string | null
          birth_country?: string | null
          birth_date?: string | null
          birth_state?: string | null
          blood_type?: string | null
          city?: string | null
          cpf: string
          cpf_normalized?: string | null
          created_at?: string
          ctps_number?: string | null
          ctps_series?: string | null
          ctps_state?: string | null
          deleted_at?: string | null
          education_level?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          father_name?: string | null
          full_name: string
          gender?: string | null
          id?: string
          is_pcd?: boolean
          is_rehabilitated?: boolean
          linked_profile_id?: string | null
          marital_status?: string | null
          medical_conditions?: string | null
          merged_at?: string | null
          merged_by?: string | null
          merged_into_worker_id?: string | null
          mother_name?: string | null
          nationality?: string | null
          neighborhood?: string | null
          nickname?: string | null
          nis_pis?: string | null
          notes?: string | null
          pcd_notes?: string | null
          pcd_type?: string | null
          phone_main?: string | null
          phone_secondary?: string | null
          race_color?: string | null
          registration_status?: string
          rg?: string | null
          rg_issue_date?: string | null
          rg_issuer?: string | null
          rg_state?: string | null
          shirt_size?: string | null
          shoe_size?: string | null
          social_name?: string | null
          state?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          allergies?: string | null
          birth_city?: string | null
          birth_country?: string | null
          birth_date?: string | null
          birth_state?: string | null
          blood_type?: string | null
          city?: string | null
          cpf?: string
          cpf_normalized?: string | null
          created_at?: string
          ctps_number?: string | null
          ctps_series?: string | null
          ctps_state?: string | null
          deleted_at?: string | null
          education_level?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          father_name?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          is_pcd?: boolean
          is_rehabilitated?: boolean
          linked_profile_id?: string | null
          marital_status?: string | null
          medical_conditions?: string | null
          merged_at?: string | null
          merged_by?: string | null
          merged_into_worker_id?: string | null
          mother_name?: string | null
          nationality?: string | null
          neighborhood?: string | null
          nickname?: string | null
          nis_pis?: string | null
          notes?: string | null
          pcd_notes?: string | null
          pcd_type?: string | null
          phone_main?: string | null
          phone_secondary?: string | null
          race_color?: string | null
          registration_status?: string
          rg?: string | null
          rg_issue_date?: string | null
          rg_issuer?: string | null
          rg_state?: string | null
          shirt_size?: string | null
          shoe_size?: string | null
          social_name?: string | null
          state?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workers_linked_profile_id_fkey"
            columns: ["linked_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workers_merged_into_worker_id_fkey"
            columns: ["merged_into_worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      worker_sst_qualifications_current: {
        Row: {
          chain_key: string | null
          company_id: string | null
          created_at: string | null
          document_status: string | null
          document_type_id: string | null
          document_url: string | null
          employment_link_document_id: string | null
          event_id: string | null
          expiration_status: string | null
          expires_at: string | null
          id: string | null
          instructor_name: string | null
          issued_at: string | null
          link_group_id: string | null
          link_group_worker_id: string | null
          notes: string | null
          nr_code: string | null
          provider_name: string | null
          revision_reason:
            | Database["public"]["Enums"]["sst_revision_reason"]
            | null
          revision_type: string | null
          source_type: string | null
          training_type: string | null
          updated_at: string | null
          validity_status: string | null
          worker_id: string | null
          workload_hours: number | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_sst_qualifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_employment_link_document_id_fkey"
            columns: ["employment_link_document_id"]
            isOneToOne: false
            referencedRelation: "employment_link_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_link_group_id_fkey"
            columns: ["link_group_id"]
            isOneToOne: false
            referencedRelation: "link_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_link_group_worker_id_fkey"
            columns: ["link_group_worker_id"]
            isOneToOne: false
            referencedRelation: "link_group_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_sst_qualifications_history: {
        Row: {
          chain_key: string | null
          company_id: string | null
          created_at: string | null
          deleted_at: string | null
          document_status: string | null
          document_type_id: string | null
          document_url: string | null
          employment_link_document_id: string | null
          event_id: string | null
          expiration_status: string | null
          expires_at: string | null
          id: string | null
          instructor_name: string | null
          issued_at: string | null
          link_group_id: string | null
          link_group_worker_id: string | null
          notes: string | null
          nr_code: string | null
          provider_name: string | null
          revision_reason:
            | Database["public"]["Enums"]["sst_revision_reason"]
            | null
          revision_type: string | null
          source_type: string | null
          superseded_at: string | null
          supersedes_id: string | null
          training_type: string | null
          updated_at: string | null
          validity_status: string | null
          worker_id: string | null
          workload_hours: number | null
        }
        Insert: {
          chain_key?: string | null
          company_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          document_status?: string | null
          document_type_id?: string | null
          document_url?: string | null
          employment_link_document_id?: string | null
          event_id?: string | null
          expiration_status?: never
          expires_at?: string | null
          id?: string | null
          instructor_name?: string | null
          issued_at?: string | null
          link_group_id?: string | null
          link_group_worker_id?: string | null
          notes?: string | null
          nr_code?: string | null
          provider_name?: string | null
          revision_reason?:
            | Database["public"]["Enums"]["sst_revision_reason"]
            | null
          revision_type?: string | null
          source_type?: string | null
          superseded_at?: string | null
          supersedes_id?: string | null
          training_type?: string | null
          updated_at?: string | null
          validity_status?: string | null
          worker_id?: string | null
          workload_hours?: number | null
        }
        Update: {
          chain_key?: string | null
          company_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          document_status?: string | null
          document_type_id?: string | null
          document_url?: string | null
          employment_link_document_id?: string | null
          event_id?: string | null
          expiration_status?: never
          expires_at?: string | null
          id?: string | null
          instructor_name?: string | null
          issued_at?: string | null
          link_group_id?: string | null
          link_group_worker_id?: string | null
          notes?: string | null
          nr_code?: string | null
          provider_name?: string | null
          revision_reason?:
            | Database["public"]["Enums"]["sst_revision_reason"]
            | null
          revision_type?: string | null
          source_type?: string | null
          superseded_at?: string | null
          supersedes_id?: string | null
          training_type?: string | null
          updated_at?: string | null
          validity_status?: string | null
          worker_id?: string | null
          workload_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_sst_qualifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_employment_link_document_id_fkey"
            columns: ["employment_link_document_id"]
            isOneToOne: false
            referencedRelation: "employment_link_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_link_group_id_fkey"
            columns: ["link_group_id"]
            isOneToOne: false
            referencedRelation: "link_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_link_group_worker_id_fkey"
            columns: ["link_group_worker_id"]
            isOneToOne: false
            referencedRelation: "link_group_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "worker_sst_qualifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "worker_sst_qualifications_current"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "worker_sst_qualifications_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sst_qualifications_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _q020_apply_allocation_values: {
        Args: { p_id: string; p_values: Json }
        Returns: undefined
      }
      allocate_worker_to_group: {
        Args: {
          p_job_role_id: string
          p_link_group_id: string
          p_values?: Json
          p_worker_id: string
        }
        Returns: Json
      }
      assert_job_roles_hygiene_snapshot: {
        Args: { p_max_age?: string; p_snapshot_id: string }
        Returns: Json
      }
      calculate_compliance_overall: {
        Args: { p_documents: Json }
        Returns: Json
      }
      calculate_document_expiry: {
        Args: {
          p_explicit_date?: string
          p_issue_date: string
          p_mode: Database["public"]["Enums"]["document_validity_mode"]
          p_unit?: Database["public"]["Enums"]["document_validity_unit"]
          p_value?: number
        }
        Returns: string
      }
      claim_public_invite: {
        Args: { _ip_hash: string; _token_hash: string }
        Returns: Json
      }
      complete_public_invite: {
        Args: {
          _auth_user_id: string
          _invite_id: string
          _nonce: string
          _profile_id: string
        }
        Returns: Json
      }
      compute_compliance_state_hash: { Args: { p_eval: Json }; Returns: string }
      create_invite_record: {
        Args: {
          _acting_user_id: string
          _email: string
          _expires_at: string
          _linked_worker_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _token_hash: string
        }
        Returns: Json
      }
      document_compliance_summary: {
        Args: { p_warning_days?: number }
        Returns: Json
      }
      document_type_scope_gate_status: { Args: never; Returns: Json }
      document_type_usage_counts: {
        Args: never
        Returns: {
          document_type_id: string
          link_count: number
          worker_count: number
        }[]
      }
      dry_run_job_role_backfill: { Args: never; Returns: Json }
      dry_run_job_roles_hygiene: {
        Args: { p_current_link_criterion?: string }
        Returns: Json
      }
      dry_run_sst_link_readiness: { Args: never; Returns: Json }
      ensure_current_user_access: {
        Args: never
        Returns: {
          roles: Database["public"]["Enums"]["app_role"][]
        }[]
      }
      ensure_worker: { Args: { mode?: string; payload: Json }; Returns: Json }
      evaluate_link_compliance: { Args: { p_link_id: string }; Returns: Json }
      f_job_roles_hygiene_baseline: { Args: never; Returns: Json }
      f_job_roles_hygiene_data_fingerprint: { Args: never; Returns: string }
      f_normalize_job_role: { Args: { p_text: string }; Returns: string }
      f_normalize_nr_code: { Args: { _raw: string }; Returns: string }
      f_resolve_or_create_allocation_employment_link: {
        Args: {
          p_company_id: string
          p_end_date: string
          p_event_id: string
          p_hire_date: string
          p_initial_status: string
          p_job_role_id: string
          p_worker_id: string
        }
        Returns: string
      }
      f_slugify_job_role: { Args: { p_text: string }; Returns: string }
      get_audit_user_emails: {
        Args: { _user_ids: string[] }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_link_compliance_timeline: {
        Args: { p_limit?: number; p_link_id: string }
        Returns: Json
      }
      get_user_id_by_email: { Args: { _email: string }; Returns: string }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_valid_cpf: { Args: { _cpf: string }; Returns: boolean }
      list_link_compliance: {
        Args: {
          p_compliance?: string
          p_doc_code?: string
          p_job_role_id?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: Json
      }
      list_worker_duplicate_candidates: { Args: never; Returns: Json }
      list_worker_qualifications: {
        Args: {
          p_document_type_ids?: string[]
          p_limit?: number
          p_offset?: number
          p_only_relevant?: boolean
          p_search?: string
          p_state?: string
        }
        Returns: Json
      }
      log_compliance_evaluation: {
        Args: {
          p_current_overall: string
          p_event_source?: string
          p_link_id: string
          p_previous_overall?: string
        }
        Returns: undefined
      }
      merge_workers: {
        Args: { _confirmation: string; _primary: string; _secondary: string }
        Returns: Json
      }
      merge_workers_preview: {
        Args: { _primary: string; _secondary: string }
        Returns: Json
      }
      record_compliance_transitions: {
        Args: { p_event_source?: string; p_link_id: string }
        Returns: Json
      }
      reevaluate_job_role_links: {
        Args: { p_event_source?: string; p_job_role_id: string }
        Returns: Json
      }
      reevaluate_worker_links: {
        Args: { p_event_source?: string; p_worker_id: string }
        Returns: Json
      }
      register_sst_revision: { Args: { payload: Json }; Returns: Json }
      release_public_invite: {
        Args: { _error_code: string; _invite_id: string; _nonce: string }
        Returns: Json
      }
      repair_worker_group_formal_link: {
        Args: {
          p_canonicalize_existing?: boolean
          p_existing_employment_link_id: string
          p_expected_allocation_id: string
          p_link_group_id: string
          p_reason: string
          p_worker_id: string
        }
        Returns: Json
      }
      resend_invite: {
        Args: {
          _acting_user_id: string
          _expires_at: string
          _invite_id: string
          _new_token_hash: string
        }
        Returns: Json
      }
      resolve_document_type_scope: {
        Args: {
          p_document_type_id: string
          p_force?: boolean
          p_notes?: string
          p_scope: Database["public"]["Enums"]["document_storage_scope"]
        }
        Returns: Json
      }
      resolve_worker_merge_chain: {
        Args: { _worker_id: string }
        Returns: string
      }
      restore_worker: { Args: { _worker_id: string }; Returns: Json }
      restore_worker_preview: { Args: { _worker_id: string }; Returns: Json }
      revoke_invite: {
        Args: { _acting_user_id: string; _invite_id: string }
        Returns: Json
      }
      run_compliance_expiration_job: {
        Args: { p_force?: boolean; p_warning_days?: number }
        Returns: Json
      }
      save_job_role_requirements: {
        Args: { p_job_role_id: string; p_requirements: Json }
        Returns: Json
      }
      save_job_roles_hygiene_snapshot: {
        Args: { p_criterion?: string }
        Returns: Json
      }
      save_link_document_override: {
        Args: {
          p_action: string
          p_document_type_id: string
          p_employment_link_id: string
          p_override_id?: string
          p_reason?: string
          p_required_until?: string
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      simulate_link_compliance: {
        Args: { p_link_id: string; p_overrides?: Json }
        Returns: Json
      }
      unaccent: { Args: { "": string }; Returns: string }
      update_group_worker_allocation: {
        Args: { p_allocation_id: string; p_values?: Json }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "operator" | "viewer"
      document_storage_scope: "worker" | "employment_link"
      document_validity_mode: "fixed_duration" | "explicit_date" | "no_expiry"
      document_validity_unit: "day" | "month" | "year"
      link_document_override_action: "add" | "waive"
      sst_revision_reason:
        | "created"
        | "renewed"
        | "replaced"
        | "revoked"
        | "corrected"
        | "expired"
        | "migrated"
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
      app_role: ["admin", "manager", "operator", "viewer"],
      document_storage_scope: ["worker", "employment_link"],
      document_validity_mode: ["fixed_duration", "explicit_date", "no_expiry"],
      document_validity_unit: ["day", "month", "year"],
      link_document_override_action: ["add", "waive"],
      sst_revision_reason: [
        "created",
        "renewed",
        "replaced",
        "revoked",
        "corrected",
        "expired",
        "migrated",
      ],
    },
  },
} as const
