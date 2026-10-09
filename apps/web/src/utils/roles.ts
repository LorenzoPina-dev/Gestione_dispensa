import type { Role } from "../types";

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Proprietario",
  MANAGER: "Gestore",
  MEMBER: "Membro",
  VIEWER: "Visualizzatore",
};

export const ROLE_DESC: Record<Role, string> = {
  OWNER: "Accesso completo, export e cancellazione dati",
  MANAGER: "Gestisce inviti, dispensa e spesa",
  MEMBER: "Modifica dispensa e spesa",
  VIEWER: "Solo lettura",
};

export const STORAGE_LOCATIONS = [
  { key: "frigo" as const, label: "Frigo", icon: "❄️" },
  { key: "freezer" as const, label: "Freezer", icon: "🧊" },
  { key: "dispensa" as const, label: "Dispensa", icon: "🏺" },
  { key: "altro" as const, label: "Altro", icon: "📦" },
];
