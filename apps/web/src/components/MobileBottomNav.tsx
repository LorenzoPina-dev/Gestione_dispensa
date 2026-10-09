interface NavItem {
  key: string;
  label: string;
  icon: string;
}

interface Props {
  items: readonly NavItem[];
  currentTab: string;
  onSelect: (tab: NavItem["key"]) => void;
  getBadge: (key: NavItem["key"]) => number;
}

export default function MobileBottomNav({ items, currentTab, onSelect, getBadge }: Props) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-[var(--color-cream)]/95 shadow-[0_-4px_18px_rgba(26,21,16,0.08)] backdrop-blur-md sm:hidden"
      aria-label="Navigazione principale"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex min-w-max items-stretch gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const active = item.key === currentTab;
          const badge = getBadge(item.key);

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              aria-current={active ? "page" : undefined}
              className={[
                "relative flex min-w-[68px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-center transition-colors active:scale-[0.98]",
                active ? "bg-[var(--color-cream-dark)]" : "bg-transparent",
              ].join(" ")}
              style={{ color: active ? "var(--color-ink)" : "var(--color-ink-muted)" }}
            >
              <span className="text-[19px] leading-5" aria-hidden="true">
                {item.icon}
              </span>
              <span className="max-w-[72px] truncate text-[10px] font-semibold leading-4">
                {item.label}
              </span>
              {badge > 0 && (
                <span
                  className="absolute right-1/2 top-0 min-w-[17px] -translate-y-1/3 translate-x-[18px] rounded-full px-1 py-0.5 text-[9px] font-bold leading-3"
                  style={{
                    backgroundColor: "var(--color-terracotta)",
                    color: "var(--color-white)",
                  }}
                  aria-label={String(badge) + " elementi"}
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
