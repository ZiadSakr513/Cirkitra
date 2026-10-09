export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export function serializeJson(value: unknown): Json {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Database values must be JSON-serializable.");
  return JSON.parse(serialized) as Json;
}

export type Database = {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          project: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          project: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          project?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      account_settings: {
        Row: {
          user_id: string;
          legacy_project_migrated_at: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          legacy_project_migrated_at?: string | null;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          legacy_project_migrated_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      ai_generation_requests: {
        Row: {
          request_id: string;
          user_id: string;
          status: "reserved" | "succeeded" | "failed" | "expired";
          model: string;
          input_tokens: number;
          output_tokens: number;
          created_at: string;
          finalized_at: string | null;
        };
        Insert: {
          request_id?: string;
          user_id: string;
          status?: "reserved" | "succeeded" | "failed" | "expired";
          model: string;
          input_tokens?: number;
          output_tokens?: number;
          created_at?: string;
          finalized_at?: string | null;
        };
        Update: {
          request_id?: string;
          user_id?: string;
          status?: "reserved" | "succeeded" | "failed" | "expired";
          model?: string;
          input_tokens?: number;
          output_tokens?: number;
          created_at?: string;
          finalized_at?: string | null;
        };
        Relationships: [];
      };
      admin_ai_usage_resets: {
        Row: {
          id: string;
          user_id: string;
          reset_by: string;
          reset_at: string;
          idempotency_key: string;
          internal_note: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          reset_by: string;
          reset_at: string;
          idempotency_key: string;
          internal_note?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          reset_by?: string;
          reset_at?: string;
          idempotency_key?: string;
          internal_note?: string | null;
        };
        Relationships: [];
      };
      ai_chat_request_windows: {
        Row: {
          user_id: string;
          minute_bucket: string;
          request_count: number;
        };
        Insert: {
          user_id: string;
          minute_bucket: string;
          request_count?: number;
        };
        Update: {
          user_id?: string;
          minute_bucket?: string;
          request_count?: number;
        };
        Relationships: [];
      };
      ai_generation_request_windows: {
        Row: {
          user_id: string;
          minute_bucket: string;
          request_count: number;
        };
        Insert: {
          user_id: string;
          minute_bucket: string;
          request_count?: number;
        };
        Update: {
          user_id?: string;
          minute_bucket?: string;
          request_count?: number;
        };
        Relationships: [];
      };
      paypal_checkout_intents: {
        Row: {
          id: string;
          user_id: string;
          plan_id: "maker" | "pro";
          environment: "sandbox" | "live";
          created_at: string;
          expires_at: string;
          consumed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan_id?: "maker" | "pro";
          environment?: "sandbox" | "live";
          created_at?: string;
          expires_at: string;
          consumed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          plan_id?: "maker" | "pro";
          environment?: "sandbox" | "live";
          created_at?: string;
          expires_at?: string;
          consumed_at?: string | null;
        };
        Relationships: [];
      };
      paypal_subscriptions: {
        Row: {
          paypal_subscription_id: string;
          environment: "sandbox" | "live";
          checkout_intent_id: string;
          user_id: string;
          plan_id: "maker" | "pro";
          status: "APPROVAL_PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";
          successful_payment_at: string | null;
          paid_through: string | null;
          cancellation_requested_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          paypal_subscription_id: string;
          environment?: "sandbox" | "live";
          checkout_intent_id: string;
          user_id: string;
          plan_id?: "maker" | "pro";
          status: "APPROVAL_PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";
          successful_payment_at?: string | null;
          paid_through?: string | null;
          cancellation_requested_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          paypal_subscription_id?: string;
          environment?: "sandbox" | "live";
          checkout_intent_id?: string;
          user_id?: string;
          plan_id?: "maker" | "pro";
          status?: "APPROVAL_PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";
          successful_payment_at?: string | null;
          paid_through?: string | null;
          cancellation_requested_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      paypal_webhook_events: {
        Row: {
          environment: "sandbox" | "live";
          event_id: string;
          event_type: string;
          paypal_subscription_id: string;
          processed_at: string;
        };
        Insert: {
          environment?: "sandbox" | "live";
          event_id: string;
          event_type: string;
          paypal_subscription_id: string;
          processed_at?: string;
        };
        Update: {
          environment?: "sandbox" | "live";
          event_id?: string;
          event_type?: string;
          paypal_subscription_id?: string;
          processed_at?: string;
        };
        Relationships: [];
      };
      admin_plan_grants: {
        Row: {
          id: string;
          user_id: string;
          plan_id: "maker" | "pro";
          granted_by: string;
          granted_at: string;
          starts_at: string;
          expires_at: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          internal_note: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan_id: "maker" | "pro";
          granted_by: string;
          granted_at?: string;
          starts_at?: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          internal_note?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          plan_id?: "maker" | "pro";
          granted_by?: string;
          granted_at?: string;
          starts_at?: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          internal_note?: string | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      reserve_ai_generation_request: {
        Args: { p_user_id: string; p_monthly_limit: number; p_model: string };
        Returns: { reservation_id: string | null; allowed: boolean; used_count: number; monthly_limit: number; resets_at: string | null }[];
      };
      finalize_ai_generation_request: {
        Args: { p_request_id: string; p_user_id: string; p_succeeded: boolean; p_input_tokens: number; p_output_tokens: number; p_model: string };
        Returns: boolean;
      };
      get_ai_generation_usage: {
        Args: { p_user_id: string; p_monthly_limit: number };
        Returns: { used_count: number; monthly_limit: number; resets_at: string | null }[];
      };
      reset_ai_generation_usage: {
        Args: { p_user_id: string; p_reset_by: string; p_idempotency_key: string; p_internal_note?: string | null };
        Returns: Database["public"]["Tables"]["admin_ai_usage_resets"]["Row"][];
      };
      reserve_ai_chat_request: {
        Args: { p_user_id: string };
        Returns: { allowed: boolean; remaining: number; resets_at: string }[];
      };
      reserve_ai_generation_rate_limit: {
        Args: { p_user_id: string };
        Returns: { allowed: boolean; remaining: number; resets_at: string }[];
      };
      create_paypal_checkout_intent: {
        Args: { p_user_id: string; p_plan_id: "maker" | "pro"; p_environment: "sandbox" | "live" };
        Returns: string;
      };
      apply_paypal_webhook_event: {
        Args: {
          p_event_id: string;
          p_event_type: string;
          p_paypal_subscription_id: string;
          p_checkout_intent_id: string;
          p_subscription_status: string | null;
          p_paid_through: string | null;
          p_environment: "sandbox" | "live";
          p_payment_succeeded?: boolean;
          p_revoke_entitlement?: boolean;
        };
        Returns: boolean;
      };
      get_paypal_maker_entitlement: {
        Args: { p_user_id: string; p_environment: "sandbox" | "live" };
        Returns: { has_maker: boolean; paypal_subscription_id: string | null; subscription_status: string | null; paid_through: string | null }[];
      };
      get_paypal_plan_entitlement: {
        Args: { p_user_id: string; p_environment: "sandbox" | "live" };
        Returns: { plan_id: "free" | "maker" | "pro"; paypal_subscription_id: string | null; subscription_status: string | null; paid_through: string | null }[];
      };
      get_active_plan_entitlements: {
        Args: { p_user_id: string; p_environment: "sandbox" | "live" };
        Returns: {
          paypal_plan_id: "free" | "maker" | "pro";
          paypal_subscription_id: string | null;
          subscription_status: string | null;
          paid_through: string | null;
          cancellation_requested_at: string | null;
          admin_grant_id: string | null;
          admin_grant_plan_id: "maker" | "pro" | null;
          admin_grant_expires_at: string | null;
        }[];
      };
      create_admin_plan_grant: {
        Args: { p_user_id: string; p_plan_id: "maker" | "pro"; p_granted_by: string; p_expires_at: string | null; p_internal_note?: string | null };
        Returns: Database["public"]["Tables"]["admin_plan_grants"]["Row"][];
      };
      revoke_admin_plan_grant: {
        Args: { p_grant_id: string; p_revoked_by: string };
        Returns: boolean;
      };
      get_active_admin_plan_grant: {
        Args: { p_user_id: string };
        Returns: { id: string; plan_id: "maker" | "pro"; expires_at: string | null }[];
      };
      link_legacy_supabase_account: {
        Args: { p_firebase_uid: string; p_email: string };
        Returns: boolean;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
