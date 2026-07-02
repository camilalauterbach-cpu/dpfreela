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
          end_date: string | null
          fixed_salary: number | null
          has_meal_allowance: boolean
          has_transport_allowance: boolean
          hire_date: string | null
          hourly_rate: number | null
          id: string
          job_function: string | null
          job_role: string | null
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
          end_date?: string | null
          fixed_salary?: number | null
          has_meal_allowance?: boolean
          has_transport_allowance?: boolean
          hire_date?: string | null
          hourly_rate?: number | null
          id?: string
          job_function?: string | null
          job_role?: string | null
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
          end_date?: string | null
          fixed_salary?: number | null
          has_meal_allowance?: boolean
          has_transport_allowance?: boolean
          hire_date?: string | null
          hourly_rate?: number | null
          id?: string
          job_function?: string | null
          job_role?: string | null
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
            foreignKeyName: "worker_documents_worker_id_fkey"
            columns: ["worker_id"]
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
          marital_status: string | null
          medical_conditions: string | null
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
          marital_status?: string | null
          medical_conditions?: string | null
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
          marital_status?: string | null
          medical_conditions?: string | null
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
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ensure_current_user_access: {
        Args: never
        Returns: {
          roles: Database["public"]["Enums"]["app_role"][]
        }[]
      }
      get_audit_user_emails: {
        Args: { _user_ids: string[] }
        Returns: {
          email: string
          user_id: string
        }[]
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
    }
    Enums: {
      app_role: "admin" | "manager" | "operator" | "viewer"
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
    },
  },
} as const
