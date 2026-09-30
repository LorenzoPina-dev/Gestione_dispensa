import { colors } from "../../tokens";

interface RowListProps {
  children: React.ReactNode;
  className?: string;
}

/** Wrapper for a list of rows with shared border and alternating background. */
export function RowList({ children, className = "" }: RowListProps) {
  return (
    <div
      className={`rounded-2xl overflow-hidden ${className}`}
      style={{ border: `1px solid ${colors.border}` }}
    >
      {children}
    </div>
  );
}

interface RowProps {
  index: number;
  last?: boolean;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

/** A single row inside a RowList. Handles alternating bg + bottom border automatically. */
export function Row({ index, last = false, onClick, className = "", children, style }: RowProps) {
  const bg = index % 2 === 0 ? colors.white : colors.creamMid;
  const border = last ? "none" : `1px solid ${colors.borderLight}`;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${onClick ? "hover:opacity-80" : ""} ${className}`}
      style={{ backgroundColor: bg, borderBottom: border, ...style }}
    >
      {children}
    </Tag>
  );
}
