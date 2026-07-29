import type { DocRow, Json } from './database.types';

/**
 * Documents stored in the `payload` jsonb of the pre-existing tables.
 *
 * Deliberately absent versus the old app: customFields, totalWeight,
 * weightUnit, region, series, status, syncState, currency/USD mirroring and
 * the payment array embedded inside a sale. Old rows carrying those keys still
 * parse — the readers below simply ignore them.
 */

export interface TruckDoc {
  id: string;
  truckNumber: string;
  fruit: string;
  boxes: number;
  boxesSold: number;
  pricePerBox: number;
  arrivalDate: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleDoc {
  id: string;
  customerId: string | null;
  customerName: string;
  truckId: string | null;
  fruit: string;
  boxes: number;
  pricePerBox: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDoc {
  id: string;
  saleId: string;
  amount: number;
  createdAt: string;
}

const isRecord = (v: Json): v is { [k: string]: Json } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: Json | undefined, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: Json | undefined): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function parseTruck(row: DocRow): TruckDoc | null {
  const p = row.payload;
  if (!isRecord(p)) return null;
  return {
    id: row.id,
    // Old rows kept the plate split across region/series; fall back to joining them.
    truckNumber: str(p.truckNumber) || `${str(p.region)} ${str(p.series)}`.trim(),
    fruit: str(p.fruit),
    boxes: num(p.boxes),
    boxesSold: num(p.boxesSold),
    pricePerBox: num(p.pricePerBox),
    arrivalDate: str(p.arrivalDate, row.updated_at.slice(0, 10)),
    createdBy: str(p.createdBy),
    createdByName: str(p.createdByName),
    createdAt: str(p.createdAt, row.updated_at),
    updatedAt: row.updated_at,
  };
}

export function parseSale(row: DocRow): SaleDoc | null {
  const p = row.payload;
  if (!isRecord(p)) return null;
  return {
    id: row.id,
    customerId: typeof p.customerId === 'string' ? p.customerId : null,
    customerName: str(p.customerName),
    truckId: typeof p.truckId === 'string' ? p.truckId : null,
    fruit: str(p.fruit),
    boxes: num(p.boxesBought) || num(p.boxes),
    pricePerBox: num(p.pricePerBox),
    createdBy: str(p.createdBy),
    createdByName: str(p.createdByName),
    createdAt: str(p.createdAt, row.updated_at),
    updatedAt: row.updated_at,
  };
}

export function parsePayment(row: DocRow): PaymentDoc | null {
  const p = row.payload;
  if (!isRecord(p)) return null;
  const saleId = str(p.saleId);
  if (!saleId) return null;
  return {
    id: row.id,
    saleId,
    amount: num(p.amount),
    createdAt: str(p.createdAt, row.updated_at),
  };
}

export function saleTotal(sale: SaleDoc): number {
  return sale.boxes * sale.pricePerBox;
}

export function truckValue(truck: TruckDoc): number {
  return truck.boxes * truck.pricePerBox;
}

export function truckRemaining(truck: TruckDoc): number {
  return Math.max(0, truck.boxes - truck.boxesSold);
}

/** Stable, sortable, collision-free enough for a two-till business. */
export function docId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
