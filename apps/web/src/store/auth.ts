import type { Role } from "../types";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: Role;
  hasFamilyId: string | null;
}

export type AuthScreen = "login" | "register" | "forgot" | "onboarding" | "app";
