export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      chat_group_members: {
        Row: {
          group_id: string;
          joined_at: string;
          role: string;
          user_id: string;
        };
        Insert: {
          group_id: string;
          joined_at?: string;
          role?: string;
          user_id: string;
        };
        Update: {
          group_id?: string;
          joined_at?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_group_members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "chat_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_groups: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      coach_quests: {
        Row: {
          cadence: string;
          category: string;
          completed_at: string | null;
          created_at: string;
          description: string;
          ends_at: string;
          id: string;
          progress: number;
          starts_at: string;
          status: string;
          target_value: number;
          title: string;
          user_id: string;
        };
        Insert: {
          cadence: string;
          category: string;
          completed_at?: string | null;
          created_at?: string;
          description: string;
          ends_at: string;
          id?: string;
          progress?: number;
          starts_at: string;
          status?: string;
          target_value?: number;
          title: string;
          user_id: string;
        };
        Update: {
          cadence?: string;
          category?: string;
          completed_at?: string | null;
          created_at?: string;
          description?: string;
          ends_at?: string;
          id?: string;
          progress?: number;
          starts_at?: string;
          status?: string;
          target_value?: number;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      direct_messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          read_at: string | null;
          recipient_id: string;
          sender_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          recipient_id: string;
          sender_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          recipient_id?: string;
          sender_id?: string;
        };
        Relationships: [];
      };
      friendships: {
        Row: {
          addressee_id: string;
          created_at: string;
          id: string;
          requester_id: string;
          status: Database["public"]["Enums"]["friendship_status"];
          updated_at: string;
        };
        Insert: {
          addressee_id: string;
          created_at?: string;
          id?: string;
          requester_id: string;
          status?: Database["public"]["Enums"]["friendship_status"];
          updated_at?: string;
        };
        Update: {
          addressee_id?: string;
          created_at?: string;
          id?: string;
          requester_id?: string;
          status?: Database["public"]["Enums"]["friendship_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      group_messages: {
        Row: {
          body: string;
          created_at: string;
          group_id: string;
          id: string;
          sender_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          group_id: string;
          id?: string;
          sender_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          group_id?: string;
          id?: string;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_messages_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "chat_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      match_invites: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          match_id: string;
          recipient_id: string | null;
          sender_id: string;
          status: string;
          team_side: string;
          token_hash: string | null;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          match_id: string;
          recipient_id?: string | null;
          sender_id: string;
          status?: string;
          team_side: string;
          token_hash?: string | null;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          match_id?: string;
          recipient_id?: string | null;
          sender_id?: string;
          status?: string;
          team_side?: string;
          token_hash?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "match_invites_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
        ];
      };
      match_reflections: {
        Row: {
          confidence_after: number | null;
          confidence_before: number | null;
          created_at: string;
          difficult: string;
          id: string;
          match_id: string;
          next_focus: string;
          updated_at: string;
          user_id: string;
          went_well: string;
        };
        Insert: {
          confidence_after?: number | null;
          confidence_before?: number | null;
          created_at?: string;
          difficult?: string;
          id?: string;
          match_id: string;
          next_focus?: string;
          updated_at?: string;
          user_id: string;
          went_well?: string;
        };
        Update: {
          confidence_after?: number | null;
          confidence_before?: number | null;
          created_at?: string;
          difficult?: string;
          id?: string;
          match_id?: string;
          next_focus?: string;
          updated_at?: string;
          user_id?: string;
          went_well?: string;
        };
        Relationships: [
          {
            foreignKeyName: "match_reflections_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
        ];
      };
      matches: {
        Row: {
          best_of: number;
          category: string | null;
          court_name: string | null;
          created_at: string;
          creator_id: string;
          duration_seconds: number;
          finished_at: string | null;
          format: string;
          games: Json;
          games_won_a: number;
          games_won_b: number;
          id: string;
          longest_rally_seconds: number;
          mode: string;
          notes: string | null;
          opponent_nicknames: Json;
          points_to_win: number;
          started_at: string;
          status: string;
          tags: string[];
          team_a_names: string[];
          team_a_user_ids: string[];
          team_b_names: string[];
          team_b_user_ids: string[];
          title: string | null;
          total_rallies: number;
          updated_at: string;
          winner: string | null;
        };
        Insert: {
          best_of?: number;
          category?: string | null;
          court_name?: string | null;
          created_at?: string;
          creator_id: string;
          duration_seconds?: number;
          finished_at?: string | null;
          format: string;
          games?: Json;
          games_won_a?: number;
          games_won_b?: number;
          id?: string;
          longest_rally_seconds?: number;
          mode: string;
          notes?: string | null;
          opponent_nicknames?: Json;
          points_to_win: number;
          started_at?: string;
          status?: string;
          tags?: string[];
          team_a_names: string[];
          team_a_user_ids?: string[];
          team_b_names: string[];
          team_b_user_ids?: string[];
          title?: string | null;
          total_rallies?: number;
          updated_at?: string;
          winner?: string | null;
        };
        Update: {
          best_of?: number;
          category?: string | null;
          court_name?: string | null;
          created_at?: string;
          creator_id?: string;
          duration_seconds?: number;
          finished_at?: string | null;
          format?: string;
          games?: Json;
          games_won_a?: number;
          games_won_b?: number;
          id?: string;
          longest_rally_seconds?: number;
          mode?: string;
          notes?: string | null;
          opponent_nicknames?: Json;
          points_to_win?: number;
          started_at?: string;
          status?: string;
          tags?: string[];
          team_a_names?: string[];
          team_a_user_ids?: string[];
          team_b_names?: string[];
          team_b_user_ids?: string[];
          title?: string | null;
          total_rallies?: number;
          updated_at?: string;
          winner?: string | null;
        };
        Relationships: [];
      };
      notification_events: {
        Row: {
          attempt_count: number;
          available_at: string;
          body: string;
          created_at: string;
          delivered_subscription_ids: string[];
          event_key: string;
          id: string;
          last_error: string | null;
          lease_token: string | null;
          leased_until: string | null;
          notification_type: string;
          payload: Json;
          sent_at: string | null;
          status: string;
          title: string;
          user_id: string;
        };
        Insert: {
          attempt_count?: number;
          available_at?: string;
          body: string;
          created_at?: string;
          delivered_subscription_ids?: string[];
          event_key: string;
          id?: string;
          last_error?: string | null;
          lease_token?: string | null;
          leased_until?: string | null;
          notification_type: string;
          payload?: Json;
          sent_at?: string | null;
          status?: string;
          title: string;
          user_id: string;
        };
        Update: {
          attempt_count?: number;
          available_at?: string;
          body?: string;
          created_at?: string;
          delivered_subscription_ids?: string[];
          event_key?: string;
          id?: string;
          last_error?: string | null;
          lease_token?: string | null;
          leased_until?: string | null;
          notification_type?: string;
          payload?: Json;
          sent_at?: string | null;
          status?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notification_log: {
        Row: {
          bucket: string;
          id: string;
          kind: string;
          sent_at: string;
          user_id: string;
        };
        Insert: {
          bucket: string;
          id?: string;
          kind: string;
          sent_at?: string;
          user_id: string;
        };
        Update: {
          bucket?: string;
          id?: string;
          kind?: string;
          sent_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      opponent_memories: {
        Row: {
          difficult: string;
          id: string;
          last_played_at: string | null;
          losses: number;
          match_count: number;
          next_plan: string;
          opponent_id: string | null;
          opponent_key: string;
          opponent_name: string;
          tendencies: string;
          updated_at: string;
          user_id: string;
          wins: number;
          worked: string;
        };
        Insert: {
          difficult?: string;
          id?: string;
          last_played_at?: string | null;
          losses?: number;
          match_count?: number;
          next_plan?: string;
          opponent_id?: string | null;
          opponent_key: string;
          opponent_name: string;
          tendencies?: string;
          updated_at?: string;
          user_id: string;
          wins?: number;
          worked?: string;
        };
        Update: {
          difficult?: string;
          id?: string;
          last_played_at?: string | null;
          losses?: number;
          match_count?: number;
          next_plan?: string;
          opponent_id?: string | null;
          opponent_key?: string;
          opponent_name?: string;
          tendencies?: string;
          updated_at?: string;
          user_id?: string;
          wins?: number;
          worked?: string;
        };
        Relationships: [];
      };
      personal_bests: {
        Row: {
          achieved_at: string;
          id: string;
          metric_key: string;
          source_match_id: string | null;
          unit: string;
          user_id: string;
          value: number;
        };
        Insert: {
          achieved_at?: string;
          id?: string;
          metric_key: string;
          source_match_id?: string | null;
          unit: string;
          user_id: string;
          value: number;
        };
        Update: {
          achieved_at?: string;
          id?: string;
          metric_key?: string;
          source_match_id?: string | null;
          unit?: string;
          user_id?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "personal_bests_source_match_id_fkey";
            columns: ["source_match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
        ];
      };
      player_achievements: {
        Row: {
          achievement_key: string;
          award_key: string;
          earned_at: string;
          user_id: string;
        };
        Insert: {
          achievement_key: string;
          award_key: string;
          earned_at?: string;
          user_id: string;
        };
        Update: {
          achievement_key?: string;
          award_key?: string;
          earned_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      player_insights: {
        Row: {
          focus_areas: string[];
          generated_at: string;
          insights: Json;
          source_match_count: number;
          stats: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          focus_areas?: string[];
          generated_at?: string;
          insights?: Json;
          source_match_count?: number;
          stats?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          focus_areas?: string[];
          generated_at?: string;
          insights?: Json;
          source_match_count?: number;
          stats?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      player_progress: {
        Row: {
          celebration_enabled: boolean;
          current_level: number;
          quest_cadence: string;
          streaks_enabled: boolean;
          total_xp: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          celebration_enabled?: boolean;
          current_level?: number;
          quest_cadence?: string;
          streaks_enabled?: boolean;
          total_xp?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          celebration_enabled?: boolean;
          current_level?: number;
          quest_cadence?: string;
          streaks_enabled?: boolean;
          total_xp?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profile_privacy: {
        Row: {
          created_at: string;
          hide_personal_bests: boolean;
          share_achievements: boolean;
          share_streaks: boolean;
          updated_at: string;
          user_id: string;
          visibility: string;
        };
        Insert: {
          created_at?: string;
          hide_personal_bests?: boolean;
          share_achievements?: boolean;
          share_streaks?: boolean;
          updated_at?: string;
          user_id: string;
          visibility?: string;
        };
        Update: {
          created_at?: string;
          hide_personal_bests?: boolean;
          share_achievements?: boolean;
          share_streaks?: boolean;
          updated_at?: string;
          user_id?: string;
          visibility?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          bio: string | null;
          birthday: string | null;
          created_at: string;
          display_name: string;
          favorite_racket: string | null;
          gender: string | null;
          handle: string;
          home_court: string | null;
          id: string;
          location: string | null;
          playing_hand: string | null;
          referral_code: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string | null;
          birthday?: string | null;
          created_at?: string;
          display_name: string;
          favorite_racket?: string | null;
          gender?: string | null;
          handle: string;
          home_court?: string | null;
          id: string;
          location?: string | null;
          playing_hand?: string | null;
          referral_code?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string | null;
          birthday?: string | null;
          created_at?: string;
          display_name?: string;
          favorite_racket?: string | null;
          gender?: string | null;
          handle?: string;
          home_court?: string | null;
          id?: string;
          location?: string | null;
          playing_hand?: string | null;
          referral_code?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          disabled: boolean;
          endpoint: string;
          id: string;
          last_error: string | null;
          last_success_at: string | null;
          p256dh: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          disabled?: boolean;
          endpoint: string;
          id?: string;
          last_error?: string | null;
          last_success_at?: string | null;
          p256dh: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          disabled?: boolean;
          endpoint?: string;
          id?: string;
          last_error?: string | null;
          last_success_at?: string | null;
          p256dh?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      referrals: {
        Row: {
          completed_at: string | null;
          created_at: string;
          id: string;
          referral_code: string;
          referred_id: string | null;
          referrer_id: string;
          status: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          referral_code: string;
          referred_id?: string | null;
          referrer_id: string;
          status?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          referral_code?: string;
          referred_id?: string | null;
          referrer_id?: string;
          status?: string;
        };
        Relationships: [];
      };
      reward_events: {
        Row: {
          created_at: string;
          event_key: string;
          id: string;
          kind: string;
          user_id: string;
          xp: number;
        };
        Insert: {
          created_at?: string;
          event_key: string;
          id?: string;
          kind: string;
          user_id: string;
          xp?: number;
        };
        Update: {
          created_at?: string;
          event_key?: string;
          id?: string;
          kind?: string;
          user_id?: string;
          xp?: number;
        };
        Relationships: [];
      };
      user_preferences: {
        Row: {
          accessibility: Json;
          created_at: string;
          dashboard: Json;
          id: string;
          match_defaults: Json;
          notifications: Json;
          onboarded_at: string | null;
          public_profile_enabled: boolean;
          updated_at: string;
        };
        Insert: {
          accessibility?: Json;
          created_at?: string;
          dashboard?: Json;
          id: string;
          match_defaults?: Json;
          notifications?: Json;
          onboarded_at?: string | null;
          public_profile_enabled?: boolean;
          updated_at?: string;
        };
        Update: {
          accessibility?: Json;
          created_at?: string;
          dashboard?: Json;
          id?: string;
          match_defaults?: Json;
          notifications?: Json;
          onboarded_at?: string | null;
          public_profile_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      award_player_rewards: {
        Args: { p_events: Json; p_user_id: string };
        Returns: Json;
      };
      claim_notification_events: {
        Args: { p_limit?: number };
        Returns: {
          attempt_count: number;
          available_at: string;
          body: string;
          created_at: string;
          delivered_subscription_ids: string[];
          event_key: string;
          id: string;
          last_error: string | null;
          lease_token: string | null;
          leased_until: string | null;
          notification_type: string;
          payload: Json;
          sent_at: string | null;
          status: string;
          title: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "notification_events";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      get_notification_config: { Args: never; Returns: Json };
      head_to_head: {
        Args: { user_a: string; user_b: string };
        Returns: {
          matches_played: number;
          wins_a: number;
          wins_b: number;
        }[];
      };
      improve_personal_best: {
        Args: {
          p_metric_key: string;
          p_source_match_id: string;
          p_unit: string;
          p_user_id: string;
          p_value: number;
        };
        Returns: boolean;
      };
      initialize_notification_config: {
        Args: {
          p_project_url: string;
          p_vapid_private_key: string;
          p_vapid_public_key: string;
          p_vapid_subject: string;
          p_worker_token: string;
        };
        Returns: undefined;
      };
      store_player_insights: {
        Args: {
          p_count: number;
          p_generated_at: string;
          p_insights: Json;
          p_stats: Json;
          p_user_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      friendship_status: "pending" | "accepted" | "blocked";
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      friendship_status: ["pending", "accepted", "blocked"],
    },
  },
} as const;
