import { useState, useMemo } from "react";
import type { ShoppingList, ShoppingItem, ShoppingItemState } from "../types";
import { colors, fonts } from "../tokens";
import { timeAgo } from "../utils/time";
import { Input } from "../components/ui/Input";
import EmptyState from "../components/ui/EmptyState";
import { SourceBadge } from "../components/ui/Badge";
import { RowList, Row } from "../components/ui/ListRow";
import SectionHeading from "../components/ui/SectionHeading";

const SOURCE_ORDER = ["REORDER", "RECIPE", "OFFER", "MANUAL"] as const;

interface Props {
  list: ShoppingList;
  setList: React.Dispatch<React.SetStateAction<ShoppingList>>;
  currentUserName: string;
}

export default function Spesa({ list, setList, currentUserName }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchFeedback, setBatchFeedback] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addSuccess, setAddSuccess] = useState(false);

  function updateList(updater: (items: ShoppingItem[]) => ShoppingItem[]) {
    setList((l) => ({
      ...l,
      version: l.version + 1,
      lastEditedBy: currentUserName,
      lastEditedAt: new Date().toISOString(),
      items: updater(l.items),
    }));
  }

  const grouped = useMemo(() => {
    const groups: Record<string, ShoppingItem[]> = { REORDER: [], RECIPE: [], OFFER: [], MANUAL: [] };
    list.items.forEach((i) => {
      if (i.state !== "IGNORED" && i.state !== "COMPLETED") groups[i.sourceType]?.push(i);
    });
    return groups;
  }, [list]);

  const completedItems = useMemo(() => list.items.filter((i) => i.state === "COMPLETED"), [list]);
  const activeCount = list.items.filter((i) => i.state === "ACCEPTED").length;
  const suggestedCount = list.items.filter((i) => i.state === "SUGGESTED").length;
  const selectedSuggested = list.items.filter((i) => selected.has(i.id) && i.state === "SUGGESTED");

  function toggleSelect(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function handleBatchAccept() {
    if (selectedSuggested.length === 0) return;
    setBatchLoading(true);
    setTimeout(() => {
      updateList((items) =>
        items.map((i) => selected.has(i.id) ? { ...i, state: "ACCEPTED" as ShoppingItemState, version: i.version + 1 } : i)
      );
      setBatchFeedback(`${selectedSuggested.length} articoli accettati.`);
      setSelected(new Set());
      setBatchLoading(false);
      setTimeout(() => setBatchFeedback(null), 2500);
    }, 700);
  }

  function handleItemToggle(id: string, current: ShoppingItemState) {
    const next: ShoppingItemState = current === "COMPLETED" ? "ACCEPTED" : "COMPLETED";
    updateList((items) => items.map((i) => i.id === id ? { ...i, state: next, version: i.version + 1 } : i));
  }

  function handleAcceptSingle(id: string) {
    updateList((items) => items.map((i) => i.id === id ? { ...i, state: "ACCEPTED" as ShoppingItemState, version: i.version + 1 } : i));
  }

  function handleAddItem() {
    if (!newName.trim()) return;
    setAddLoading(true);
    setTimeout(() => {
      const item: ShoppingItem = {
        id: "sli_" + Date.now(),
        displayName: newName.trim(),
        quantity: 1,
        unit: "pz",
        state: "ACCEPTED",
        sourceType: "MANUAL",
        version: 1,
        addedBy: currentUserName,
        addedAt: new Date().toISOString(),
      };
      updateList((items) => [...items, item]);
      setNewName("");
      setAddLoading(false);
      setAddSuccess(true);
      setTimeout(() => setAddSuccess(false), 1500);
    }, 500);
  }

  const hasActiveItems = SOURCE_ORDER.some((src) => grouped[src]?.length > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>
          {list.name}
        </h2>
        <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
          {activeCount} confermati
          {suggestedCount > 0 && ` · ${suggestedCount} da approvare`}
          {list.lastEditedBy && (
            <> · modificata da <strong>{list.lastEditedBy.split(" ")[0]}</strong> {timeAgo(list.lastEditedAt!)}</>
          )}
        </p>
      </div>

      {/* Batch feedback */}
      {batchFeedback && (
        <div className="rounded-xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: colors.sageLight, color: colors.sageDark }}>
          {batchFeedback}
        </div>
      )}

      {/* Batch action bar */}
      {selected.size > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-2xl"
          style={{ backgroundColor: colors.terracottaLight }}
        >
          <span className="text-sm font-semibold" style={{ color: colors.terracotta }}>
            {selected.size} selezionati
          </span>
          <button
            onClick={handleBatchAccept}
            disabled={batchLoading}
            className="ml-auto px-3 py-1.5 rounded-xl text-xs font-semibold"
            style={{ backgroundColor: batchLoading ? colors.disabled : colors.terracotta, color: colors.white }}
          >
            {batchLoading ? "Attendere…" : "Accetta selezionati"}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs"
            style={{ color: colors.inkMuted }}
            aria-label="Annulla selezione"
          >
            ✕
          </button>
        </div>
      )}

      {/* Quick add */}
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
          placeholder="Aggiungi articolo…"
          aria-label="Nome articolo da aggiungere"
          className="flex-1"
          style={{ padding: "10px 16px" }}
        />
        <button
          onClick={handleAddItem}
          disabled={addLoading || !newName.trim()}
          aria-label="Aggiungi alla lista"
          className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{
            backgroundColor: addSuccess ? colors.sage : (!newName.trim() || addLoading) ? colors.disabled : colors.terracotta,
            color: colors.white,
            minWidth: "44px",
          }}
        >
          {addSuccess ? "✓" : "+"}
        </button>
      </div>

      {/* Suggested items notice */}
      {suggestedCount > 0 && selected.size === 0 && (
        <div className="rounded-xl px-4 py-3 text-xs" style={{ backgroundColor: colors.amberLight, color: colors.amberDark }}>
          <strong>{suggestedCount} articoli</strong> suggeriti da sistema — usa i checkbox per accettarli o accettali uno alla volta.
        </div>
      )}

      {/* Grouped items */}
      {!hasActiveItems ? (
        <EmptyState
          icon="🛒"
          title="La lista è vuota"
          description="Aggiungi un articolo qui sopra o controlla le scorte basse in dispensa."
        />
      ) : (
        SOURCE_ORDER.map((src) => {
          const items = grouped[src];
          if (!items || items.length === 0) return null;
          return (
            <div key={src} className="space-y-2">
              <SectionHeading>
                <SourceBadge sourceType={src} />
              </SectionHeading>
              <RowList>
                {items.map((item, idx) => {
                  const isCompleted = item.state === "COMPLETED";
                  const isSuggested = item.state === "SUGGESTED";
                  return (
                    <Row key={item.id} index={idx} last={idx === items.length - 1}>
                      {/* Checkbox (suggested) or done-ring (accepted) */}
                      {isSuggested ? (
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="w-4 h-4 rounded shrink-0"
                          style={{ accentColor: colors.terracotta }}
                          aria-label={`Seleziona ${item.displayName}`}
                        />
                      ) : (
                        <button
                          onClick={() => handleItemToggle(item.id, item.state)}
                          className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
                          style={{
                            borderColor: isCompleted ? colors.sage : colors.border,
                            backgroundColor: isCompleted ? colors.sage : "transparent",
                          }}
                          aria-label={isCompleted ? "Segna come non preso" : "Segna come preso"}
                          aria-pressed={isCompleted}
                        >
                          {isCompleted && <span style={{ color: colors.white, fontSize: "0.55rem" }}>✓</span>}
                        </button>
                      )}

                      {/* Name + meta */}
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-medium"
                          style={{
                            color: colors.ink,
                            textDecoration: isCompleted ? "line-through" : "none",
                            opacity: isCompleted ? 0.5 : 1,
                          }}
                        >
                          {item.displayName}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                          {item.quantity} {item.unit}
                          {item.addedBy && ` · ${item.addedBy.split(" ")[0]}`}
                          {item.addedAt && ` ${timeAgo(item.addedAt)}`}
                        </p>
                      </div>

                      {/* Suggested → accept button */}
                      {isSuggested && (
                        <button
                          onClick={() => handleAcceptSingle(item.id)}
                          className="text-xs px-2.5 py-1.5 rounded-lg transition-all"
                          style={{ backgroundColor: colors.sageLight, color: colors.sageDark }}
                          aria-label={`Accetta ${item.displayName}`}
                        >
                          Accetta
                        </button>
                      )}
                    </Row>
                  );
                })}
              </RowList>
            </div>
          );
        })
      )}

      {/* Completed section */}
      {completedItems.length > 0 && (
        <div className="space-y-2">
          <SectionHeading>Già nel carrello ({completedItems.length})</SectionHeading>
          <RowList>
            {completedItems.map((item, idx) => (
              <Row key={item.id} index={idx} last={idx === completedItems.length - 1}>
                <button
                  onClick={() => handleItemToggle(item.id, item.state)}
                  className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                  style={{ borderColor: colors.sage, backgroundColor: colors.sage }}
                  aria-label={`Rimuovi dal carrello: ${item.displayName}`}
                  aria-pressed={true}
                >
                  <span style={{ color: colors.white, fontSize: "0.55rem" }}>✓</span>
                </button>
                <span className="text-sm flex-1" style={{ color: colors.inkMuted, textDecoration: "line-through" }}>
                  {item.displayName}
                </span>
                <span className="text-xs" style={{ color: colors.inkMuted }}>{item.quantity} {item.unit}</span>
              </Row>
            ))}
          </RowList>
        </div>
      )}
    </div>
  );
}
