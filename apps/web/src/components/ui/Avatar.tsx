import { colors } from "../../tokens";

interface Props {
  initials: string;
  size?: number; // px
  role?: string;
}

const roleAccents: Record<string, { bg: string; color: string }> = {
  OWNER: { bg: colors.terracottaLight, color: colors.terracotta },
  MANAGER: { bg: colors.amberLight, color: colors.amberDark },
  MEMBER: { bg: colors.sageLight, color: colors.sageDark },
  VIEWER: { bg: colors.creamDark, color: colors.inkMuted },
};

export default function Avatar({ initials, size = 36, role }: Props) {
  const accent = role ? (roleAccents[role] ?? roleAccents.VIEWER) : { bg: colors.terracottaLight, color: colors.terracotta };
  const fontSize = size < 32 ? "0.6rem" : size < 40 ? "0.7rem" : "0.8rem";
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold shrink-0 select-none"
      style={{ width: size, height: size, backgroundColor: accent.bg, color: accent.color, fontSize }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
