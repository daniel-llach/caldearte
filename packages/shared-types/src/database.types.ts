export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      api_usage_log: {
        Row: {
          cache_creation_input_tokens: number
          cache_read_input_tokens: number
          created_at: string
          estimated_cost_usd: number
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          purpose: string
          region_id: string | null
          web_search_requests: number
        }
        Insert: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          created_at?: string
          estimated_cost_usd: number
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          purpose: string
          region_id?: string | null
          web_search_requests?: number
        }
        Update: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          created_at?: string
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          purpose?: string
          region_id?: string | null
          web_search_requests?: number
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_log_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      bright_source_fetch_state: {
        Row: {
          last_fetched_at: string
          url: string
        }
        Insert: {
          last_fetched_at: string
          url: string
        }
        Update: {
          last_fetched_at?: string
          url?: string
        }
        Relationships: []
      }
      detected_sources: {
        Row: {
          created_at: string
          id: string
          last_reviewed_at: string | null
          note: string
          source_type: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_reviewed_at?: string | null
          note: string
          source_type?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          last_reviewed_at?: string | null
          note?: string
          source_type?: string
          url?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          artist: string | null
          created_at: string
          curation_reasoning: string | null
          curation_status: string
          description: string | null
          freeform_location: string
          id: string
          image_storage_path: string | null
          image_url: string | null
          medium_type: string | null
          opening_date_confidence: string
          opening_datetime: string | null
          place_name: string | null
          public_explanation: string | null
          region_id: string | null
          run_end_date: string | null
          run_start_date: string | null
          sensitivity_tags: string[]
          source: string
          source_url: string | null
          title: string
        }
        Insert: {
          artist?: string | null
          created_at?: string
          curation_reasoning?: string | null
          curation_status?: string
          description?: string | null
          freeform_location: string
          id?: string
          image_storage_path?: string | null
          image_url?: string | null
          medium_type?: string | null
          opening_date_confidence?: string
          opening_datetime?: string | null
          place_name?: string | null
          public_explanation?: string | null
          region_id?: string | null
          run_end_date?: string | null
          run_start_date?: string | null
          sensitivity_tags?: string[]
          source: string
          source_url?: string | null
          title: string
        }
        Update: {
          artist?: string | null
          created_at?: string
          curation_reasoning?: string | null
          curation_status?: string
          description?: string | null
          freeform_location?: string
          id?: string
          image_storage_path?: string | null
          image_url?: string | null
          medium_type?: string | null
          opening_date_confidence?: string
          opening_datetime?: string | null
          place_name?: string | null
          public_explanation?: string | null
          region_id?: string | null
          run_end_date?: string | null
          run_start_date?: string | null
          sensitivity_tags?: string[]
          source?: string
          source_url?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_search_results: {
        Row: {
          created_at: string
          domain: string
          id: string
          score: number
          title: string
          unit_name: string
          url: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          score: number
          title: string
          unit_name: string
          url: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          score?: number
          title?: string
          unit_name?: string
          url?: string
        }
        Relationships: []
      }
      regions: {
        Row: {
          admin_region_name: string | null
          admin_region_order: number | null
          consecutive_zero_yield_runs: number
          country: string
          created_at: string
          exclusion_reason: string | null
          expansion_rank: number | null
          id: string
          language: string
          last_run_at: string | null
          lat: number | null
          lng: number | null
          name: string
          population: number | null
          search_frequency: string | null
          status: string
        }
        Insert: {
          admin_region_name?: string | null
          admin_region_order?: number | null
          consecutive_zero_yield_runs?: number
          country: string
          created_at?: string
          exclusion_reason?: string | null
          expansion_rank?: number | null
          id?: string
          language: string
          last_run_at?: string | null
          lat?: number | null
          lng?: number | null
          name: string
          population?: number | null
          search_frequency?: string | null
          status?: string
        }
        Update: {
          admin_region_name?: string | null
          admin_region_order?: number | null
          consecutive_zero_yield_runs?: number
          country?: string
          created_at?: string
          exclusion_reason?: string | null
          expansion_rank?: number | null
          id?: string
          language?: string
          last_run_at?: string | null
          lat?: number | null
          lng?: number | null
          name?: string
          population?: number | null
          search_frequency?: string | null
          status?: string
        }
        Relationships: []
      }
      system_config: {
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

