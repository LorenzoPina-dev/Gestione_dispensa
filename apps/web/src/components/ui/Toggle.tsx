import { colors } from "../../tokens";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id?: string;
}

/** Accessible toggle switch. */
export default function Toggle({ checked, onChange, label, id }: Props) {
  const toggleId = id ?? `toggle-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <label htmlFor={toggleId} className="flex items-center gap-2.5 cursor-pointer select-none" style={{ color: colors.inkMuted }}>
      <button
        id={toggleId}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="w-10 h-6 rounded-full relative transition-colors focus-visible:outline-2"
        style={{
          backgroundColor: checked ? colors.terracotta : colors.border,
          outlineColor: colors.terracotta,
        }}
      >
        <span
          className="absolute top-1 w-4 h-4 rounded-full transition-all"
          style={{
            left: checked ? "calc(100% - 20px)" : "4px",
            backgroundColor: colors.white,
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
      </button>
      <span className="text-sm">{label}</span>
    </label>
  );
}
