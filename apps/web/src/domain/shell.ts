export type ViewState = "LOADING" | "READY" | "ERROR" | "OFFLINE" | "RETRYING";

export interface FamilyContext {
  readonly familyId: string;
  readonly displayName: string;
}

export interface Principal {
  readonly userId: string;
  readonly displayName: string;
}

export interface ShellModel {
  readonly principal: Principal | undefined;
  readonly family: FamilyContext | undefined;
  readonly state: ViewState;
  readonly errorMessage: string | undefined;
  readonly navigation: readonly NavigationItem[];
}

export interface NavigationItem {
  readonly href: string;
  readonly label: string;
  readonly current: boolean;
}

const NAVIGATION = [
  { href: "/inventory", label: "Inventory" },
  { href: "/shopping", label: "Shopping list" },
  { href: "/family", label: "Family" },
] as const;

export function createShellModel(input: {
  readonly principal?: Principal;
  readonly family?: FamilyContext;
  readonly state?: ViewState;
  readonly errorMessage?: string;
  readonly currentPath?: string;
}): ShellModel {
  const currentPath = input.currentPath ?? "/";
  return {
    principal: input.principal,
    family: input.family,
    state: input.state ?? "LOADING",
    errorMessage: input.errorMessage,
    navigation: NAVIGATION.map((item) => ({
      ...item,
      current: currentPath === item.href || currentPath.startsWith(`${item.href}/`),
    })),
  };
}

export function resolveSafeRedirect(value: string | undefined, fallback = "/inventory"): string {
  if (value === undefined || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function shellStatusMessage(model: ShellModel): string {
  if (model.state === "LOADING") return "Loading family workspace";
  if (model.state === "OFFLINE") return "You are offline. Changes will retry when connected.";
  if (model.state === "RETRYING") return "Retrying connection";
  if (model.state === "ERROR") return model.errorMessage ?? "Unable to load the family workspace";
  return model.family === undefined
    ? "Select a family to continue"
    : `Working in ${model.family.displayName}`;
}
