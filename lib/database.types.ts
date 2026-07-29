/**
 * Hand-written to match supabase/migrations/0001_roles_consent_warnings.sql.
 * Only the columns the app actually touches are described.
 *
 * These are `type` aliases, not interfaces, on purpose: postgrest-js constrains
 * every Row to `Record<string, unknown>`, and an interface has no implicit index
 * signature, which silently degrades the whole schema to `never`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Role = 'owner' | 'customer';
export type WarnResult = 'pending' | 'located' | 'denied' | 'unavailable' | 'no_device';

export type ProfileRow = {
  id: string;
  role: Role;
  full_name: string;
  phone: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ConsentRow = {
  user_id: string;
  location_granted: boolean;
  notifications_granted: boolean;
  terms_accepted: boolean;
  decided_at: string | null;
  revoked_at: string | null;
  consent_version: number;
  updated_at: string;
};

export type CustomerLocationRow = {
  user_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  updated_at: string;
};

export type WarningRow = {
  id: string;
  customer_id: string;
  owner_id: string;
  result: WarnResult;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  located_at: string | null;
  created_at: string;
};

export type UserSettingsRow = {
  user_id: string;
  language: string;
  accent: string;
  text_scale: number;
  fun_mode: boolean;
  updated_at: string;
};

export type PushTokenRow = {
  user_id: string;
  token: string;
  platform: string;
  updated_at: string;
};

export type ClientRow = {
  id: string;
  owner_id: string;
  name: string;
  phone: string | null;
  invite_code: string;
  telegram_chat_id: number | null;
  telegram_linked_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The three pre-existing document tables. Their shape lives in `payload`. */
export type DocRow = {
  id: string;
  updated_at: string;
  deleted_at: string | null;
  payload: Json;
};

type DocTable = {
  Row: DocRow;
  Insert: { id: string; payload: Json; updated_at?: string; deleted_at?: string | null };
  Update: Partial<DocRow>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & { id: string };
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      consents: {
        Row: ConsentRow;
        Insert: Partial<ConsentRow> & { user_id: string };
        Update: Partial<ConsentRow>;
        Relationships: [];
      };
      warnings: {
        Row: WarningRow;
        Insert: Partial<WarningRow> & { customer_id: string; owner_id: string };
        Update: Partial<WarningRow>;
        Relationships: [];
      };
      user_settings: {
        Row: UserSettingsRow;
        Insert: Partial<UserSettingsRow> & { user_id: string };
        Update: Partial<UserSettingsRow>;
        Relationships: [];
      };
      push_tokens: {
        Row: PushTokenRow;
        Insert: Partial<PushTokenRow> & { user_id: string; token: string };
        Update: Partial<PushTokenRow>;
        Relationships: [];
      };
      owners: {
        Row: { user_id: string; name: string; created_at: string };
        Insert: { user_id: string; name: string };
        Update: { user_id?: string; name?: string };
        Relationships: [];
      };
      clients: {
        Row: ClientRow;
        Insert: Partial<ClientRow> & { owner_id: string };
        Update: Partial<ClientRow>;
        Relationships: [];
      };
      customer_locations: {
        Row: CustomerLocationRow;
        Insert: Partial<CustomerLocationRow> & { user_id: string; lat: number; lng: number };
        Update: Partial<CustomerLocationRow>;
        Relationships: [];
      };
      trucks: DocTable;
      sales: DocTable;
      payments: DocTable;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
