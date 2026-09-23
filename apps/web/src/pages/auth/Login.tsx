import { useState } from "react";
import AuthShell from "./AuthShell";
import type { AuthUser } from "../../store/auth";
import { colors } from "../../tokens";
import { Input } from "../../components/ui/Input";
import { KEYCLOAK_REALM_URL, KEYCLOAK_CLIENT_ID } from "../../api/config";
import { useAuthStore } from "../../store/auth";
import { getCurrentUser, getFamily } from "../../api/endpoints";

export const DEMO_ACCOUNTS: Record<string, AuthUser & { password: string }> = {
  "giulia@example.com": { id: "u1", name: "Giulia Ferretti", email: "giulia@example.com", avatar: "GF", role: "OWNER", hasFamilyId: "fam1", password: "password123" },
  "marco@example.com": { id: "u2", name: "Marco Ferretti", email: "marco@example.com", avatar: "MF", role: "MANAGER", hasFamilyId: "fam1", password: "password123" },
  "sofia@example.com": { id: "u3", name: "Sofia Ferretti", email: "sofia@example.com", avatar: "SF", role: "MEMBER", hasFamilyId: "fam1", password: "password123" },
  "carlo@example.com": { id: "u4", name: "Carlo Ferretti", email: "carlo@example.com", avatar: "NC", role: "VIEWER", hasFamilyId: "fam1", password: "password123" },
  "nuovo@example.com": { id: "u5", name: "Utente Nuovo", email: "nuovo@example.com", avatar: "UN", role: "MEMBER", hasFamilyId: null, password: "password123" },
};

type LoginState = "IDLE" | "SUBMITTING" | "ERROR";

interface Props {
  onLogin: (user: AuthUser) => void;
  onRegister: () => void;
  onForgot: () => void;
}

export default function Login({ onLogin, onRegister, onForgot }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<LoginState>("IDLE");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  const setToken = useAuthStore((s) => s.setToken);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setState("SUBMITTING");
    setErrorMessage(null);

    const cleanEmail = email.trim().toLowerCase();

    // 1. Flusso di autenticazione OIDC tramite Keycloak
    if (KEYCLOAK_REALM_URL && KEYCLOAK_CLIENT_ID) {
      try {
        const bodyParams = new URLSearchParams({
          grant_type: "password",
          client_id: KEYCLOAK_CLIENT_ID,
          username: cleanEmail,
          password: password,
          scope: "openid profile email",
        });

        const res = await fetch(`${KEYCLOAK_REALM_URL}/protocol/openid-connect/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: bodyParams.toString(),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error_description || "Credenziali non valide.");
        }

        if (!data.access_token) {
          throw new Error("Token di accesso non restituito da Keycloak.");
        }

        // Salviamo il token per le successive chiamate API
        setToken(data.access_token);

        let familyId: string | null = null;
        let userProfileName = cleanEmail.split("@")[0];

        try {
          const apiUser = await getCurrentUser();
          if (apiUser) {
            userProfileName = apiUser.name || userProfileName;
            if (apiUser.activeFamilyId) {
              familyId = apiUser.activeFamilyId;
            }
          }
        } catch {
          // Fallback se /auth/me non restituisce la famiglia attiva
        }

        // Se familyId non è definito nel profilo utente, recuperiamo la famiglia associata
        if (!familyId) {
          try {
            const familyData = await getFamily();
            if (familyData && familyData.id) {
              familyId = familyData.id;
            }
          } catch {
            familyId = null;
          }
        }

        const user: AuthUser = {
          id: "u_" + Date.now(),
          name: userProfileName,
          email: cleanEmail,
          avatar: userProfileName.slice(0, 2).toUpperCase(),
          role: "OWNER",
          hasFamilyId: familyId,
        };

        setState("IDLE");
        onLogin(user);
        return;
      } catch (err: unknown) {
        setState("ERROR");
        setErrorMessage(err instanceof Error ? err.message : "Errore durante l'accesso.");
        return;
      }
    }

    // 2. Fallback per account demo / locale
    setTimeout(() => {
      const account = DEMO_ACCOUNTS[cleanEmail];
      if (account && account.password === password) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password: _pw, ...user } = account;
        setState("IDLE");
        onLogin(user);
      } else {
        setState("ERROR");
        setErrorMessage("Email o password non corretti.");
      }
    }, 500);
  }

  return (
    <AuthShell title="Bentornato" subtitle="Accedi al tuo account per continuare">
      <form onSubmit={handleLogin} className="space-y-4">
        {state === "ERROR" && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: colors.terracottaLight, color: colors.terracotta }}>
            {errorMessage || "Email o password non corretti. Riprova."}
          </div>
        )}

        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: colors.inkMuted }}>
            Email
          </label>
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setState("IDLE");
            }}
            placeholder="nome@esempio.it"
            autoComplete="email"
            required
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-medium" style={{ color: colors.inkMuted }}>
              Password
            </label>
            <button
              type="button"
              onClick={onForgot}
              className="text-xs transition-opacity hover:opacity-70"
              style={{ color: colors.terracotta }}
            >
              Password dimenticata?
            </button>
          </div>
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setState("IDLE");
              }}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              style={{ paddingRight: "3.5rem" }}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded-lg"
              style={{ color: colors.inkMuted }}
              aria-label={showPw ? "Nascondi password" : "Mostra password"}
            >
              {showPw ? "Nascondi" : "Mostra"}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={state === "SUBMITTING"}
          className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
          style={{
            backgroundColor: state === "SUBMITTING" ? colors.disabled : colors.terracotta,
            color: colors.white,
          }}
        >
          {state === "SUBMITTING" ? "Accesso in corso…" : "Accedi"}
        </button>
      </form>

      <div className="pt-2 text-center">
        <span className="text-xs" style={{ color: colors.inkMuted }}>
          Non hai un account?{" "}
        </span>
        <button
          type="button"
          onClick={onRegister}
          className="text-xs font-semibold transition-opacity hover:opacity-70"
          style={{ color: colors.terracotta }}
        >
          Registrati
        </button>
      </div>

      {/* Account Demo */}
      <div className="rounded-xl p-3 space-y-1.5" style={{ backgroundColor: colors.cream, border: `1px solid ${colors.border}` }}>
        <p className="text-[10px] font-semibold" style={{ color: colors.inkMuted }}>
          Account demo (password: password123)
        </p>
        <div className="space-y-0.5">
          {Object.values(DEMO_ACCOUNTS).map((a) => (
            <button
              key={a.email}
              type="button"
              onClick={() => {
                setEmail(a.email);
                setPassword("password123");
                setState("IDLE");
              }}
              className="w-full text-left text-[10px] px-2 py-1 rounded-lg transition-colors hover:opacity-70"
              style={{ color: colors.inkMuted }}
            >
              <span className="font-medium" style={{ color: colors.ink }}>
                {a.email}
              </span>{" "}
              · {a.role}
              {a.hasFamilyId ? "" : " · nessuna famiglia"}
            </button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}