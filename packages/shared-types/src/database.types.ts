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
      events: {
        Row: {
          artist: string | null
          created_at: string
          curation_reasoning: string | null
          curation_status: string
          description: string | null
          freeform_location: string | null
          id: string
          image_storage_path: string | null
          medium_type: string | null
          opening_date_confidence: string
          opening_datetime: string
          public_explanation: string | null
          sensitivity_tags: string[]
          source: string
          source_url: string | null
          title: string
          venue_id: string | null
        }
        Insert: {
          artist?: string | null
          created_at?: string
          curation_reasoning?: string | null
          curation_status?: string
          description?: string | null
          freeform_location?: string | null
          id?: string
          image_storage_path?: string | null
          medium_type?: string | null
          opening_date_confidence?: string
          opening_datetime: string
          public_explanation?: string | null
          sensitivity_tags?: string[]
          source: string
          source_url?: string | null
          title: string
          venue_id?: string | null
        }
        Update: {
          artist?: string | null
          created_at?: string
          curation_reasoning?: string | null
          curation_status?: string
          description?: string | null
          freeform_location?: string | null
          id?: string
          image_storage_path?: string | null
          medium_type?: string | null
          opening_date_confidence?: string
          opening_datetime?: string
          public_explanation?: string | null
          sensitivity_tags?: string[]
          source?: string
          source_url?: string | null
          title?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
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
      venues: {
        Row: {
          address: string | null
          category: string
          contact_email: string | null
          created_at: string
          geocoded_at: string | null
          id: string
          lat: number | null
          lng: number | null
          name: string
          region_id: string
          source_domain: string | null
        }
        Insert: {
          address?: string | null
          category?: string
          contact_email?: string | null
          created_at?: string
          geocoded_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
          region_id: string
          source_domain?: string | null
        }
        Update: {
          address?: string | null
          category?: string
          contact_email?: string | null
          created_at?: string
          geocoded_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          region_id?: string
          source_domain?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
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
  public: {
    Enums: {},
  },
} as const
