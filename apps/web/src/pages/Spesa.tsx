import { useState, useMemo } from "react";
import type { ShoppingList, ShoppingItem, ShoppingItemState, ActionState } from "../types";

const SOURCE_META: Record<string, { label: string; color: string; bg: string }> = {
  MANUAL: { label: "aggiunto a mano", color: "#1a1510", bg: "#ede6d6" },
  REORDER: { label: "scorta bassa", color: "#92400e", bg: "#faecd4" },
  OFFER: { label: "offerta", color: "#3d6641", bg: "#dceadd" },
  RECIPE: { label: "da ricetta", color: "#6b5e4e", bg: "#ede6d6" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min fa`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h fa`;
  return `${Math.floor(hrs / 24)}g fa`;
}

interface Props {
  list: ShoppingList;
  setList: React.Dispatch<React.SetStateAction<ShoppingList>>;
}

export default function Spesa({ list, setList }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchState, setBatchState] = useState<ActionState>("IDLE");
  const [batchResult, setBatchResult] = useState<{ ok: string[]; fail: string[] } | null>(null);
  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("");
  const [addState, setAddState] = useState<ActionState>("IDLE");

  const grouped = useMemo(() => {
    const groups: Record<string, ShoppingItem[]> = { REORDER: [], RECIPE: [], OFFER: [], MANUAL: [] };
    list.items.forEach((i) => {
      if (i.state !== "IGNORED" && i.state !== "COMPLETED") {
        groups[i.sourceType]?.push(i);
      }
    });
    return groups;
  }, [list]);

  const activeCount = list.items.filter((i) => i.state === "ACCEPTED").length;
  const suggestionCount = list.items.filter((i) => i.state === "SUGGESTED").length;

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function handleBatchAccept() {
    if (selected.size === 0) return;
    setBatchState("SUBMITTING");
    setTimeout(() => {
      const ids = Array.from(selected);
      const failIdx = new Set<string>();
      const ok = ids.filter((_, i) => !failIdx.has(ids[i]));
      const fail: string[] = [];
      setBatchResult({ ok, fail });
      setList((l) => ({
        ...l,
        version: l.version + 1,
        lastEditedBy: "Giulia Ferretti",
        lastEditedAt: new Date().toISOString(),
        items: l.items.map((i) => selected.has(i.id) ? { ...i, state: "ACCEPTED" as ShoppingItemState, version: i.version + 1 } : i),
      }));
      setBatchState("SUCCESS");
      setSelected(new Set());
      setTimeout(() => { setBatchState("IDLE"); setBatchResult(null); }, 2500);
    }, 900);
  }

  function handleItemToggle(id: string, current: ShoppingItemState) {
    const next: ShoppingItemState = current === "COMPLETED" ? "ACCEPTED" : "COMPLETED";
    setList((l) => ({
      ...l,
      version: l.version + 1,
      lastEditedBy: "Giulia Ferretti",
      lastEditedAt: new Date().toISOString(),
      items: l.items.map((i) => i.id === id ? { ...i, state: next, version: i.version + 1 } : i),
    }));
  }

  function handleAddItem() {
    if (!newName) return;
    setAddState("SUBMITTING");
    setTimeout(() => {
      const item: ShoppingItem = {
        id: "sli_" + Date.now(),
        displayName: newName,
        quantity: Number(newQty) || 1,
        unit: "pz",
        state: "ACCEPTED",
        sourceType: "MANUAL",
        version: 1,
        addedBy: "Giulia Ferretti",
        addedAt: new Date().toISOString(),
      };
      setList((l) => ({ ...l, items: [...l.items, item], version: l.version + 1, lastEditedBy: "Giulia Ferretti", lastEditedAt: new Date().toISOString() }));
      setAddState("SUCCESS");
      setNewName("");
      setNewQty("");
      setTimeout(() => setAddState("IDLE"), 1500);
    }, 600);
  }

  const sourceOrder = ["REORDER", "RECIPE", "OFFER", "MANUAL"] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-light" style={{ fontFamily: "var(--font-display)", color: "#1a1510" }}>{list.name}</h2>
        <p className="text-xs mt-0.5" style={{ color: "#6b5e4e" }}>
          {activeCount} articoli confermati
          {suggestionCount > 0 && ` · ${suggestionCount} suggeriti`}
          {list.lastEditedBy && ` · modificata da ${list.lastEditedBy.split(" ")[0]} ${timeAgo(list.lastEditedAt!)}`}
        </p>
      </div>

      {/* Batch feedback */}
      {batchState === "SUCCESS" && batchResult && (
        <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: "#dceadd", color: "#3d6641" }}>
          {batchResult.ok.length} articoli accettati. {batchResult.fail.length > 0 && `${batchResult.fail.length} non aggiornati — riprova.`}
        </div>
      )}

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ backgroundColor: "#f0ddd5" }}>
          <span className="text-sm font-medium" style={{ color: "#c4623a" }}>{selected.size} selezionati</span>
          <button
            onClick={handleBatchAccept}
            disabled={batchState === "SUBMITTING"}
            className="ml-auto px-3 py-1.5 rounded-xl text-xs font-semibold"
            style={{ backgroundColor: "#c4623a", color: "#fff" }}
          >
            {batchState === "SUBMITTING" ? "Attendere…" : "Accetta selezionati"}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs" style={{ color: "#6b5e4e" }}>Annulla</button>
        </div>
      )}

      {/* Quick add */}
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
          placeholder="Aggiungi articolo…"
          className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
          style={{ backgroundColor: "#ede6d6", border: "1px solid #d8cfc0", color: "#1a1510", fontFamily: "var(--font-sans)" }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#c4623a")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#d8cfc0")}
        />
        <button
          onClick={handleAddItem}
          disabled={addState === "SUBMITTING"}
          className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{ backgroundColor: addState === "SUBMITTING" ? "#d8cfc0" : "#c4623a", color: "#fff" }}
        >
          {addState === "SUCCESS" ? "✓" : "+"}
        </button>
      </div>

      {/* Grouped items */}
      {sourceOrder.map((src) => {
        const items = grouped[src];
        if (!items || items.length === 0) return null;
        const meta = SOURCE_META[src];
        return (
          <div key={src} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: meta.bg, color: meta.color }}>{meta.label}</span>
            </div>
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #d8cfc0" }}>
              {items.map((item, idx) => {
                const isCompleted = item.state === "COMPLETED";
                const isSuggested = item.state === "SUGGESTED";
                const isSelectable = isSuggested;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-3 transition-colors"
                    style={{
                      backgroundColor: idx % 2 === 0 ? "#fff" : "#faf7f2",
                      borderBottom: idx < items.length - 1 ? "1px solid #f0ebe0" : "none",
                      opacity: isCompleted ? 0.5 : 1,
                    }}
                  >
                    {isSelectable ? (
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        className="w-4 h-4 rounded accent-[#c4623a]"
                        aria-label={`Seleziona ${item.displayName}`}
                      />
                    ) : (
                      <button
                        onClick={() => handleItemToggle(item.id, item.state)}
                        className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
                        style={{
                          borderColor: isCompleted ? "#5a7a5e" : "#d8cfc0",
                          backgroundColor: isCompleted ? "#5a7a5e" : "transparent",
                        }}
                        aria-label={isCompleted ? "Segna come non preso" : "Segna come preso"}
                      >
                        {isCompleted && <span className="text-white text-[10px]">✓</span>}
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "#1a1510", textDecoration: isCompleted ? "line-through" : "none" }}>
                        {item.displayName}
                      </p>
                      <p className="text-xs" style={{ color: "#6b5e4e" }}>
                        {item.quantity} {item.unit}
                        {item.addedBy && ` · ${item.addedBy.split(" ")[0]}`}
                        {item.addedAt && ` ${timeAgo(item.addedAt)}`}
                      </p>
                    </div>
                    {isSuggested && (
                      <button
                        onClick={() => setList((l) => ({ ...l, items: l.items.map((i) => i.id === item.id ? { ...i, state: "ACCEPTED" as ShoppingItemState } : i) }))}
                        className="text-xs px-2 py-1 rounded-lg transition-all"
                        style={{ backgroundColor: "#dceadd", color: "#3d6641" }}
                      >
                        Accetta
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Empty state */}
      {list.items.filter((i) => i.state !== "COMPLETED" && i.state !== "IGNORED").length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: "#dceadd" }}>
          <p className="font-medium text-sm" style={{ color: "#3d6641" }}>La lista è vuota</p>
          <p className="text-xs mt-1" style={{ color: "#5a7a5e" }}>Aggiungi un articolo qui sopra o controlla le scorte basse in dispensa.</p>
        </div>
      )}
    </div>
  );
}
