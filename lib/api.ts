import type {
  ClientKind,
  ClientRow,
  ConsentRow,
  CustomerLocationRow,
  ProfileRow,
  WarnResult,
  WarningRow,
} from './database.types';
import type { ReportLang } from './reportLang';
import { supabase } from './supabase';
import {
  docId,
  isWalkIn,
  parseCustomer,
  parsePayment,
  parseSale,
  parseTruck,
  type CustomerDoc,
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

// --- edge functions ----------------------------------------------------------

/**
 * Why an edge function call failed, in terms a screen can act on.
 *
 * `code` is what the function itself reported; `unreachable` is ours, for the
 * cases where the request never got an answer at all — the function is not
 * deployed, the browser blocked it on CORS, or the phone is offline. Those look
 * identical to `supabase-js`, which reports every one of them as the same
 * opaque "Failed to send a request to the Edge Function".
 */
export type EdgeErrorCode =
  | 'unreachable'
  | 'unauthorized'
  | 'not_configured'
  | 'bad_request'
  | 'not_found'
  | 'not_linked'
  | 'nothing_owed'
  | 'blocked'
  | 'telegram_failed'
  | 'forbidden'
  | 'server_error';

export class EdgeFunctionError extends Error {
  readonly code: EdgeErrorCode;
  readonly status: number | null;
  /** The server's own words, kept for logs — never shown raw to an owner. */
  readonly detail: string;

  constructor(code: EdgeErrorCode, status: number | null, detail: string) {
    super(`${code}${status ? ` (${status})` : ''}${detail ? `: ${detail}` : ''}`);
    this.name = 'EdgeFunctionError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function codeForStatus(status: number): EdgeErrorCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'not_linked';
    case 502:
      return 'telegram_failed';
    default:
      return 'server_error';
  }
}

/**
 * Calls an edge function and turns any failure into an `EdgeFunctionError`.
 *
 * `functions.invoke` hands back a `FunctionsHttpError` whose message says only
 * that the function returned non-2xx — the body, which is where the actual
 * reason lives, is left on `error.context` for the caller to read. Nothing was
 * reading it, so a client who had never opened the bot link and a bot token
 * that was never configured produced exactly the same silence on screen.
 */
async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (!error) return data ?? null;

  const context: unknown = (error as { context?: unknown }).context;
  const response = context instanceof Response ? context : null;

  if (!response) {
    // No HTTP answer at all: not deployed, CORS-blocked, or no network.
    throw new EdgeFunctionError('unreachable', null, error.message);
  }

  const text = await response.text().catch(() => '');
  let code: EdgeErrorCode | null = null;
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    if (typeof parsed.error === 'string') code = parsed.error as EdgeErrorCode;
    if (typeof parsed.message === 'string') detail = parsed.message;
  } catch {
    // Older deploys answer in plain text; the status still classifies it.
  }

  throw new EdgeFunctionError(code ?? codeForStatus(response.status), response.status, detail);
}

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

  void announceToChannel('truck', id).catch((err) => {
    console.warn('Telegram announce failed for truck', id, err);
  });
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
): Promise<string> {
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

  void announceToChannel('sale', id).catch((err) => {
    console.warn('Telegram announce failed for sale', id, err);
  });

  if (input.truckId) await bumpTruckSold(input.truckId, input.boxes);
  // Returned so a sale that is settled in the same breath — a cash sale to a
  // walk-up buyer — can record its payment without a second lookup.
  return id;
}

/**
 * The one row every anonymous sale attaches to.
 *
 * A fixed id rather than a minted one, so the second random sale finds the
 * bucket the first one made. It keeps the `cust_` prefix because everything
 * that reasons about ids reads that prefix to tell a walk-in from a real
 * account — see `isWalkIn`.
 */
export const RANDOM_CUSTOMER_ID = 'cust_random';

/** Creates the bucket on first use, and revives it if someone deleted it. */
async function ensureRandomCustomer(name: string, author: Author): Promise<void> {
  const { data } = await supabase
    .from('customers')
    .select('id, deleted_at')
    .eq('id', RANDOM_CUSTOMER_ID)
    .maybeSingle();

  const now = new Date().toISOString();

  if (!data) {
    const doc: CustomerDoc = {
      id: RANDOM_CUSTOMER_ID,
      name,
      phone: '',
      createdBy: author.id,
      createdByName: author.name,
      createdAt: now,
      updatedAt: now,
    };
    // Ignores a duplicate rather than throwing: two tills can ring up their
    // first random sale at the same moment, and only one of them can win.
    await supabase
      .from('customers')
      .upsert({ id: RANDOM_CUSTOMER_ID, payload: { ...doc }, updated_at: now }, {
        onConflict: 'id',
        ignoreDuplicates: true,
      });
    return;
  }

  if (data.deleted_at) {
    await supabase
      .from('customers')
      .update({ deleted_at: null, updated_at: now })
      .eq('id', RANDOM_CUSTOMER_ID);
  }
}

/**
 * A sale to a buyer nobody took the name of, settled on the spot.
 *
 * The payment is written with the sale rather than left for later, and that is
 * the whole point: an anonymous buyer cannot be phoned, cannot be sent a
 * Telegram reminder and cannot be warned, so a debt recorded against one could
 * never be collected — it would only inflate the astatka total that the owners
 * actually steer by. Cash in hand, books flat.
 */
export async function createRandomSale(
  input: {
    /** Shown on the bucket row, in the owner's language. */
    bucketName: string;
    truckId: string | null;
    fruit: string;
    boxes: number;
    pricePerBox: number;
  },
  author: Author
): Promise<void> {
  await ensureRandomCustomer(input.bucketName, author);

  const saleId = await createSale(
    {
      customerId: RANDOM_CUSTOMER_ID,
      customerName: input.bucketName,
      truckId: input.truckId,
      fruit: input.fruit,
      boxes: input.boxes,
      pricePerBox: input.pricePerBox,
    },
    author
  );

  await createPayment(saleId, input.boxes * input.pricePerBox);
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

/** Posts a notification to the Telegram channel via the edge function. */
export async function announceToChannel(kind: 'truck' | 'sale', docId: string): Promise<void> {
  await invokeFunction('announce-telegram', { kind, id: docId });
}

// --- walk-in customers -------------------------------------------------------

/**
 * Buyers with no account. Kept separate from `profiles` because those are
 * keyed to `auth.users` and cannot be created from this app — see migration
 * 0006. Screens that show "customers" merge both sources.
 */
export async function listCustomers(): Promise<CustomerDoc[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  // 42P01 = undefined_table. The customers screen loads this alongside the
  // profiles it has always shown, so a build deployed before 0006 has been run
  // would otherwise take the whole screen down rather than just lack walk-ins.
  // Every other error still throws.
  if (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
  return (data ?? []).map(parseCustomer).filter(nonNull);
}

export async function createCustomer(
  input: { name: string; phone: string },
  author: Author
): Promise<CustomerDoc> {
  const now = new Date().toISOString();
  const id = docId('cust');
  const doc: CustomerDoc = {
    id,
    name: input.name,
    phone: input.phone,
    createdBy: author.id,
    createdByName: author.name,
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase
    .from('customers')
    .insert({ id, payload: { ...doc }, updated_at: now });
  if (error) throw error;
  // Returned so the caller can go straight to recording a sale against them.
  return doc;
}

export async function getCustomer(id: string): Promise<CustomerDoc | null> {
  const { data } = await supabase.from('customers').select('*').eq('id', id).maybeSingle();
  return data ? parseCustomer(data) : null;
}

export async function updateCustomer(
  id: string,
  patch: { name: string; phone: string }
): Promise<void> {
  const current = await getCustomer(id);
  if (!current) throw new Error('customer not found');
  const now = new Date().toISOString();
  const next: CustomerDoc = { ...current, ...patch, updatedAt: now };
  const { error } = await supabase
    .from('customers')
    .update({ payload: { ...next }, updated_at: now })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Display name for either kind of customer. Screens that hold only an id — the
 * sale form, the detail page — should not have to know which table it came
 * from, so the branch lives here once instead of at each call site.
 */
export async function customerName(customerId: string): Promise<string> {
  if (!customerId) return '';
  if (isWalkIn(customerId)) return (await getCustomer(customerId))?.name ?? '';
  const profiles = await listProfiles();
  return profiles.find((p) => p.id === customerId)?.full_name ?? '';
}

/** Soft delete, matching trucks — their past sales must stay readable. */
export async function deleteCustomer(id: string): Promise<void> {
  const { error } = await supabase
    .from('customers')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
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
  input: { name: string; phone: string; kind: ClientKind; customerId: string | null }
): Promise<ClientRow> {
  const { data, error } = await supabase
    .from('clients')
    .insert({
      owner_id: ownerId,
      name: input.name,
      phone: input.phone || null,
      kind: input.kind,
      // Only a private chat chases a debt, so only a chat carries the link.
      customer_id: input.kind === 'chat' ? input.customerId : null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Both kinds of customer as one pickable list — the same merge the customers
 * screen does, for the contact form's "which customer is this?" picker.
 */
export async function listAllCustomers(): Promise<{ id: string; name: string }[]> {
  const [profiles, walkIns] = await Promise.all([listProfiles(), listCustomers()]);
  return [
    ...profiles.filter((p) => p.role === 'customer').map((p) => ({ id: p.id, name: p.full_name })),
    ...walkIns.map((c) => ({ id: c.id, name: c.name })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Chases one customer for payment over Telegram.
 *
 * The wording is built server-side from the customer's own unpaid sales, so an
 * owner cannot accidentally send a figure that does not match the books, and
 * the scheduled sweep and this button produce the same message.
 */
export async function remindCustomer(
  customerId: string,
  coords?: { lat: number; lng: number }
): Promise<void> {
  await invokeFunction('remind-telegram', { customerId, coords: coords ?? null });
}

/** What the Growth button did, so the screen can say it rather than just flash. */
export interface GrowthResult {
  /** Groups the report reached. */
  delivered: number;
  /** Of those, how many it managed to pin — needs the bot to be an admin. */
  pinned: number;
}

/**
 * Posts the day's figures to every connected group and pins the result.
 *
 * The language is the only thing sent from here: the whole report is built
 * server-side from the books, so the group cannot be shown a number that no
 * screen could reproduce.
 */
export async function postGrowthReport(lang: ReportLang): Promise<GrowthResult> {
  const result = await invokeFunction<GrowthResult>('growth-telegram', { lang });
  return { delivered: result?.delivered ?? 0, pinned: result?.pinned ?? 0 };
}
