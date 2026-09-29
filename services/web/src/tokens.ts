// Design tokens — single source of truth for all colors and semantic values.
// Use these everywhere instead of raw hex strings.

export const colors = {
  // Ground
  cream: "#f5f0e8",
  creamDark: "#ede6d6",
  creamMid: "#faf7f2",

  // Text
  ink: "#1a1510",
  inkMuted: "#6b5e4e",

  // Brand
  terracotta: "#c4623a",
  terracottaLight: "#f0ddd5",
  terracottaMid: "#e8cec4",

  // Semantic — freshness / status
  expired: "#c4623a",
  expiredBg: "#f0ddd5",
  expiring: "#d4943a",
  expiringBg: "#faecd4",
  fresh: "#5a7a5e",
  freshBg: "#dceadd",

  // Accent greens
  sage: "#5a7a5e",
  sageDark: "#3d6641",
  sageLight: "#dceadd",

  // Accent amber
  amber: "#d4943a",
  amberDark: "#92400e",
  amberLight: "#faecd4",

  // Borders & structure
  border: "#d8cfc0",
  borderLight: "#f0ebe0",
  white: "#ffffff",

  // Utility
  disabled: "#d8cfc0",
} as const;

// Semantic role colors
export const roleColors = {
  OWNER: { bg: colors.terracottaLight, color: colors.terracotta },
  MANAGER: { bg: colors.amberLight, color: colors.amberDark },
  MEMBER: { bg: colors.sageLight, color: colors.sageDark },
  VIEWER: { bg: colors.creamDark, color: colors.inkMuted },
} as const;

// Freshness border colors (for the shelf left-tab)
export const freshnessColor = {
  EXPIRED: colors.expired,
  EXPIRING: colors.expiring,
  FRESH: colors.fresh,
  UNKNOWN: colors.border,
} as const;

// Provenance / confidence badge colors
export const provenanceColor = {
  VERIFIED: { label: "verificato", color: colors.sageDark, bg: colors.sageLight },
  IMPORTED: { label: "importato", color: colors.amberDark, bg: colors.amberLight },
  ESTIMATED: { label: "stimato", color: colors.inkMuted, bg: colors.creamDark },
  UNKNOWN: { label: "fonte ignota", color: colors.inkMuted, bg: colors.creamDark },
} as const;

export const confidenceColor = {
  CONFIRMED: { label: "confermato", color: colors.sageDark, bg: colors.sageLight },
  ESTIMATED: { label: "stimato", color: colors.amberDark, bg: colors.amberLight },
  UNKNOWN: { label: "non disponibile", color: colors.inkMuted, bg: colors.creamDark },
} as const;

// Typography
export const fonts = {
  display: "var(--font-display)",
  sans: "var(--font-sans)",
} as const;

// Common reusable style objects (immutable, defined outside render)
export const inputStyle = {
  backgroundColor: colors.creamDark,
  border: `1px solid ${colors.border}`,
  color: colors.ink,
  fontFamily: fonts.sans,
} as const;

export const cardStyle = {
  backgroundColor: colors.white,
  border: `1px solid ${colors.border}`,
} as const;

export const panelStyle = {
  backgroundColor: colors.cream,
} as const;
