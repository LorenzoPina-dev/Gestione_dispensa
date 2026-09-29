import { useState } from "react";
import AuthShell from "./AuthShell";
import type { AuthUser } from "../../store/auth";
import { colors } from "../../tokens";
import { Input } from "../../components/ui/Input";
import { KEYCLOAK_REALM_URL, KEYCLOAK_CLIENT_ID } from "../../api/config";
import { useAuthStore } from "../../store/auth";
import { getCurrentUser, listFamilies } from "../../api/endpoints";

type LoginState = "IDLE" | "SUBMITTING" | "ERROR";

function mapRealmRole(roles: string[] | undefined): AuthUser["role"] {
  const allowed: AuthUser["role"][] = ["OWNER", "MANAGER", "MEMBER", "VIEWER"];
  const match = roles?.find((role): role is AuthUser["role"] =>
    allowed.includes(role as AuthUser["role"]),
  );
  return match ?? "MEMBER";
}

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

  const setTokens = useAuthStore((s) => s.setTokens);
  // Impostato dal listener SESSION_EXPIRED_EVENT in store/auth.ts quando una richiesta
  // qualsiasi risponde 401 e il refresh token non è più valido — così l'utente vede perché è
  // tornato al login invece di una pagina bianca o di richieste che falliscono in silenzio.
  const sessionExpiredMessage = useAuthStore((s) => s.error);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setState("SUBMITTING");
    setErrorMessage(null);
    useAuthStore.setState({ error: null });

    const cleanEmail = email.trim().toLowerCase();

    if (!KEYCLOAK_REALM_URL || !KEYCLOAK_CLIENT_ID) {
      setState("ERROR");
      setErrorMessage("Configurazione OIDC non disponibile. Contatta l'amministratore.");
      return;
    }

    try {
      const res = await fetch(`${KEYCLOAK_REALM_URL}/protocol/openid-connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: KEYCLOAK_CLIENT_ID,
          username: cleanEmail,
          password,
          // offline_access è indispensabile: senza, Keycloak emette un refresh token che
          // muore insieme alla SSO session (default 30 minuti). Con offline_access, il
          // refresh vive per Offline Session Idle (default 30 giorni), che è quello che
          // serve per "restare loggati".
          scope: "openid profile email offline_access",
        }).toString(),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error_description || "Credenziali non valide.");
      }
      if (!data.access_token) {
        throw new Error("Token di accesso non restituito da Keycloak.");
      }
      if (!data.refresh_token) {
        // Sintomo sicuro che il client Keycloak non ha lo scope `offline_access` abilitato.
        // Senza refresh token la sessione muore alla prima scadenza dell'access token,
        // mandando fuori l'utente senza che sia colpa sua.
        throw new Error(
          "Il server non ha emesso un refresh token. Verifica che il client Keycloak abbia lo scope `offline_access` abilitato.",
        );
      }

      setTokens({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: typeof data.expires_in === "number" ? data.expires_in : 300,
      });

      // /me è il punto di sincronizzazione obbligatorio fra Keycloak e il dominio applicativo.
      // Non entriamo nell'app con un utente sintetico se l'API non riesce a verificare il JWT.
      const apiUser = await getCurrentUser();
      if (!apiUser?.id) {
        throw new Error("L'API non ha restituito un profilo utente valido.");
      }

      const familyId = apiUser.activeFamilyId ?? null;
      let role: AuthUser["role"] = mapRealmRole(apiUser.roles);
      if (familyId) {
        const families = await listFamilies();
        const found = families.families.find((f) => f.familyId === familyId);
        if (found) role = found.role as AuthUser["role"];
      }

      const userProfileName = apiUser.name || apiUser.preferredUsername || cleanEmail.split("@")[0];
      const user: AuthUser = {
        id: apiUser.id,
        name: userProfileName,
        email: apiUser.email || cleanEmail,
        avatar: userProfileName.slice(0, 2).toUpperCase(),
        role,
        hasFamilyId: familyId,
      };

      setState("IDLE");
      onLogin(user);
    } catch (err: unknown) {
      setState("ERROR");
      setErrorMessage(err instanceof Error ? err.message : "Errore durante l'accesso.");
    }
  }

  return (
    <AuthShell title="Bentornato" subtitle="Accedi al tuo account per continuare">
      <form onSubmit={handleLogin} className="space-y-4">
        {state === "ERROR" && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: colors.terracottaLight, color: colors.terracotta }}>
            {errorMessage || "Email o password non corretti. Riprova."}
          </div>
        )}
        {state !== "ERROR" && sessionExpiredMessage && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: colors.amberLight, color: colors.amberDark }}>
            {sessionExpiredMessage}
          </div>
        )}

        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: colors.inkMuted }}>Email</label>
          <Input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setState("IDLE"); }}
            placeholder="nome@esempio.it"
            autoComplete="email"
            required
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-medium" style={{ color: colors.inkMuted }}>Password</label>
            <button type="button" onClick={onForgot} className="text-xs transition-opacity hover:opacity-70" style={{ color: colors.terracotta }}>
              Password dimenticata?
            </button>
          </div>
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setState("IDLE"); }}
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
        <span className="text-xs" style={{ color: colors.inkMuted }}>Non hai un account? </span>
        <button type="button" onClick={onRegister} className="text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: colors.terracotta }}>
          Registrati
        </button>
      </div>
    </AuthShell>
  );
}