import { colors } from "../../tokens";

interface Props {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  variant?: "neutral" | "success" | "warning";
}

const variantStyle = {
  neutral: { bg: colors.creamDark, titleColor: colors.inkMuted, descColor: colors.inkMuted, btnBg: colors.terracotta },
  success: { bg: colors.sageLight, titleColor: colors.sageDark, descColor: colors.sage, btnBg: colors.sage },
  warning: { bg: colors.amberLight, titleColor: colors.amberDark, descColor: colors.inkMuted, btnBg: colors.terracotta },
};

export default function EmptyState({ icon, title, description, action, variant = "neutral" }: Props) {
  const s = variantStyle[variant];
  return (
    <div className="rounded-2xl p-8 text-center space-y-2" style={{ backgroundColor: s.bg }}>
      {icon && <p className="text-3xl">{icon}</p>}
      <p className="font-semibold text-sm" style={{ color: s.titleColor }}>{title}</p>
      {description && <p className="text-xs leading-relaxed" style={{ color: s.descColor }}>{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-3 px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
          style={{ backgroundColor: s.btnBg, color: colors.white }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
