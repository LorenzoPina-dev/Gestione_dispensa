import { useState, useMemo } from "react";
import type { StockItem, StorageLocation, ExpiryStatus } from "../types";
import AddProductModal from "../components/AddProductModal";
import { Modal } from "../components/ui/Modal";
import { colors, fonts, freshnessColor, provenanceColor } from "../tokens";
import { Input } from "../components/ui/Input";

const LOCATIONS: { key: StorageLocation; label: string; icon: string }[] = [
  { key: "frigo", label: "Frigo", icon: "❄️" },
  { key: "freezer", label: "Freezer", icon: "🧊" },
  { key: "dispensa", label: "Dispensa", icon: "🏺" },
  { key: "altro", label: "Altro", icon: "📦" },
];

function getExpiryStatus(batches: StockItem["batches"]): ExpiryStatus {
  const dates = batches.map((b) => b.expiryDate).filter(Boolean) as string[];
  if (!dates.length) return "UNKNOWN";
  const minDays = Math.min(...dates.map((d) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)));
  if (minDays <= 0) return "EXPIRED";
  if (minDays <= 5) return "EXPIRING";
  return "FRESH";
}

function expiryDays(batches: StockItem["batches"]): number | null {
  const dates = batches.map((b) => b.expiryDate).filter(Boolean) as string[];
  if (!dates.length) return null;
  return Math.ceil((Math.min(...dates.map((d) => new Date(d).getTime())) - Date.now()) / 86400000);
}

function totalQuantity(item: StockItem): number {
  return item.batches.reduce((sum, b) => sum + b.quantity, 0);
}

type DisplayBatch = StockItem["batches"][number] & {
  sourceId: string;
  sourceVersion: number;
};

interface GroupedStockItem extends Omit<StockItem, "batches"> {
  aggregateKey: string;
  sources: StockItem[];
  batches: DisplayBatch[];
}

function normalizeGroupPart(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stockGroupingKey(item: StockItem): string {
  const product = item.productId
    ? `product:${item.productId}`
    : `name:${normalizeGroupPart(item.name)}|brand:${normalizeGroupPart(item.brand)}`;
  return `${product}|location:${item.location}|unit:${normalizeGroupPart(item.unit)}`;
}

function groupStockItems(items: StockItem[]): GroupedStockItem[] {
  const groups = new Map<string, GroupedStockItem>();

  for (const item of items) {
    if (totalQuantity(item) <= 0) continue;

    const aggregateKey = stockGroupingKey(item);
    const existing = groups.get(aggregateKey);

    if (!existing) {
      groups.set(aggregateKey, {
        ...item,
        aggregateKey,
        sources: [item],
        batches: item.batches.map((batch) => ({
          ...batch,
          sourceId: item.id,
          sourceVersion: item.version,
        })),
      });
      continue;
    }

    existing.sources.push(item);
    existing.batches.push(
      ...item.batches.map((batch) => ({
        ...batch,
        sourceId: item.id,
        sourceVersion: item.version,
      })),
    );
  }

  return [...groups.values()].map((group) => ({
    ...group,
    batches: [...group.batches].sort((a, b) => {
      const da = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.POSITIVE_INFINITY;
      const db = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.POSITIVE_INFINITY;
      return da - db;
    }),
  }));
}

interface Props {
  stock: StockItem[];
  setStock: React.Dispatch<React.SetStateAction<StockItem[]>>;
  readOnly?: boolean;
}

export default function Dispensa({ stock, setStock, readOnly = false }: Props) {
  const [locFilter, setLocFilter] = useState<StorageLocation | "tutti">("tutti");
  const [statusFilter, setStatusFilter] = useState<ExpiryStatus | "tutti">("tutti");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<GroupedStockItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Consume modal state
  const [consumeTarget, setConsumeTarget] = useState<GroupedStockItem | null>(null);
  const [consumeQty, setConsumeQty] = useState("1");
  const [consumeError, setConsumeError] = useState<string | null>(null);