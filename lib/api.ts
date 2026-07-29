import type {
  ClientRow,
  ConsentRow,
  CustomerLocationRow,
  ProfileRow,
  WarnResult,
  WarningRow,
} from './database.types';
import { supabase } from './supabase';
import {
  docId,
  parsePayment,
  parseSale,
  parseTruck,
  type PaymentDoc,
  type SaleDoc,
  type TruckDoc,
} from './types';
import { todayISODate } from './format';

/** Author stamped onto every document so sales cards can credit an owner. */
export interface Author {
  id: string;
  name: string;
}

const nonNull = <T>(v: T | null): v is T => v !== null;

// --- trucks -----------------------------------------------------------------

export async function listTrucks(): Promise<TruckDoc[]> {
  const { data, error } = await supabase
    .from('trucks')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(parseTruck).filter(nonNull);
}

export async function createTruck(
  input: { truckNumber: string; fruit: string; boxes: number; pricePerBox: number },
  author: Author
): Promise<void> {
  const now = new Date().toISOString();
  const id = docId('truck');
  const doc: TruckDoc = {
    id,
    truckNumber: input.truckNumber,
    fruit: input.fruit,
    boxes: input.boxes,
    boxesSold: 0,
    pricePerBox: input.pricePerBox,
    arrivalDate: todayISODate(),
    createdBy: author.id,
    createdByName: author.name,
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase.from('trucks').insert({ id, payload: { ...doc }, updated_at: now });
  if (error) throw error;
}

export async function getTruck(id: string): Promise<TruckDoc | null> {
  const { data } = await supabase.from('trucks').select('*').eq('id', id).maybeSingle();
  return data ? parseTruck(data) : null;
}

/** Edits the four editable fields, preserving authorship and sold count. */
export async function updateTruck(
  id: string,
  patch: { truckNumber: string; fruit: string; boxes: number; pricePerBox: number }
): Promise<void> {
  const current = await getTruck(id);
  if (!current) throw new Error('truck not found');
  const now = new Date().toISOString();
  const next: TruckDoc = { ...current, ...patch, updatedAt: now };
  const { error } = await supabase
    .from('trucks')
    .update({ payload: { ...next }, updated_at: now })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteTruck(id: string): Promise<void> {
  const { error } = await supabase
    .from('trucks')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// --- sales & payments -------------------------------------------------------

export async function listSales(): Promise<SaleDoc[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(parseSale).filter(nonNull);
}

export async function listPayments(): Promise<PaymentDoc[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(parsePayment).filter(nonNull);
}

export async function createSale(
  input: {
    customerId: string;
    customerName: string;
    truckId: string | null;
    fruit: string;
    boxes: number;
    pricePerBox: number;
  },
  author: Author
): Promise<void> {
  const now = new Date().toISOString();
  const id = docId('sale');
  const doc: SaleDoc = {
    id,
    customerId: input.customerId,
    customerName: input.customerName,
    truckId: input.truckId,
    fruit: input.fruit,
    boxes: input.boxes,
    pricePerBox: input.pricePerBox,
    createdBy: author.id,
    createdByName: author.name,
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase.from('sales').insert({ id, payload: { ...doc }, updated_at: now });
  if (error) throw error;

  if (input.truckId) await bumpTruckSold(input.truckId, input.boxes);
}

/** Keeps the truck's sold counter in step with the sale just written. */
async function bumpTruckSold(truckId: string, boxes: number): Promise<void> {
  const { data } = await supabase.from('trucks').select('*').eq('id', truckId).maybeSingle();
  if (!data) return;
  const truck = parseTruck(data);
  if (!truck) return;
  const now = new Date().toISOString();
  const next: TruckDoc = { ...truck, boxesSold: truck.boxesSold + boxes, updatedAt: now };
  await supabase.from('trucks').update({ payload: { ...next }, updated_at: now }).eq('id', truckId);
}

export async function createPayment(saleId: string, amount: number): Promise<void> {
  const now = new Date().toISOString();
  const id = docId('pay');
  const doc: PaymentDoc = { id, saleId, amount, createdAt: now };
  const { error } = await supabase
    .from('payments')
    .insert({ id, payload: { ...doc }, updated_at: now });
  if (error) throw error;
}

// --- people -----------------------------------------------------------------

export async function listProfiles(): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Owners may correct a customer's name and phone. `role` is deliberately not
 * accepted here — the database trigger would reject it anyway.
 */
export async function updateProfile(
  id: string,
  patch: { full_name: string; phone: string | null }
): Promise<void> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  if (error) throw error;
}

export async function listConsents(): Promise<ConsentRow[]> {
  const { data, error } = await supabase.from('consents').select('*');
  if (error) throw error;
  return data ?? [];
}

export async function listCustomerLocations(): Promise<CustomerLocationRow[]> {
  const { data, error } = await supabase.from('customer_locations').select('*');
  if (error) throw error;
  return data ?? [];
}

// --- warnings ---------------------------------------------------------------

export async function listWarnings(): Promise<WarningRow[]> {
  const { data, error } = await supabase
    .from('warnings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function raiseWarning(customerId: string, ownerId: string): Promise<WarningRow> {
  const { data, error } = await supabase
    .from('warnings')
    .insert({ customer_id: customerId, owner_id: ownerId, result: 'pending' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setWarningResult(
  id: string,
  result: WarnResult,
  coords?: { lat: number; lng: number; accuracy: number | null }
): Promise<void> {
  await supabase
    .from('warnings')
    .update({
      result,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      accuracy: coords?.accuracy ?? null,
      located_at: coords ? new Date().toISOString() : null,
    })
    .eq('id', id);
}

export async function tokensFor(userId: string): Promise<string[]> {
  const { data } = await supabase.from('push_tokens').select('token').eq('user_id', userId);
  return (data ?? []).map((r) => r.token);
}

// --- clients (Telegram-only contacts, no app account) ------------------------

export async function listClients(): Promise<ClientRow[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createClient(
  ownerId: string,
  input: { name: string; phone: string }
): Promise<ClientRow> {
  const { data, error } = await supabase
    .from('clients')
    .insert({ owner_id: ownerId, name: input.name, phone: input.phone || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
}

/** Calls the `send-telegram` edge function, which holds the bot token. */
export async function sendTelegramMessage(clientId: string, message: string): Promise<void> {
  const { error } = await supabase.functions.invoke('send-telegram', {
    body: { clientId, message },
  });
  if (error) throw error;
}
