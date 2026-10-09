import { colors } from "../../tokens";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: React.ReactNode;
}

const variantStyle: Record<Variant, { bg: string; color: string; hoverBg: string }> = {
  primary: { bg: colors.terracotta, color: colors.white, hoverBg: "#a84f2e" },
  secondary: { bg: colors.creamDark, color: colors.inkMuted, hoverBg: "#d8cfc0" },
  danger: { bg: colors.terracottaLight, color: colors.terracotta, hoverBg: "#e8cec4" },
  ghost: { bg: "transparent", color: colors.inkMuted, hoverBg: colors.creamDark },
};

const sizeStyle: Record<Size, { padding: string; fontSize: string; borderRadius: string }> = {
  sm: { padding: "6px 12px", fontSize: "0.7rem", borderRadius: "10px" },
  md: { padding: "10px 16px", fontSize: "0.875rem", borderRadius: "12px" },
};

export default function Button({ variant = "primary", size = "md", loading = false, children, disabled, style, ...rest }: Props) {
  const v = variantStyle[variant];
  const s = sizeStyle[size];
  const isDisabled = disabled || loading;
  return (
    <button
      disabled={isDisabled}
      style={{
        backgroundColor: isDisabled ? colors.disabled : v.bg,
        color: isDisabled ? colors.white : v.color,
        padding: s.padding,
        fontSize: s.fontSize,
        borderRadius: s.borderRadius,
        fontWeight: 600,
        transition: "opacity 0.15s, background-color 0.15s",
        border: "none",
        cursor: isDisabled ? "not-allowed" : "pointer",
        ...style,
      }}
      onMouseEnter={(e) => { if (!isDisabled) e.currentTarget.style.opacity = "0.85"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
      {...rest}
    >
      {loading ? "Attendere…" : children}
    </button>
  );
}
