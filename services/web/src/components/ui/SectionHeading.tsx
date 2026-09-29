import { colors } from "../../tokens";

interface Props {
  children: React.ReactNode;
  action?: React.ReactNode;
}

export default function SectionHeading({ children, action }: Props) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: colors.inkMuted }}
      >
        {children}
      </p>
      {action}
    </div>
  );
}
