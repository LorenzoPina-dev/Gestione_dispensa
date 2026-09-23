import { useState } from "react";
import AuthShell from "./AuthShell";
import type { AuthUser } from "../../store/auth";
import { colors } from "../../tokens";
import { Input } from "../../components/ui/Input";
import { KEYCLOAK_REALM_URL, KEYCLOAK_CLIENT_ID } from "../../api/config";
import { useAuthStore } from "../../store/auth";
import { registerUser, getCurrentUser, listFamilies } from "../../api/endpoints";

type Step = "form" | "submitting" | "done";

interface Props {
  onRegistered: (user: AuthUser) => void;
  onLogin: () => void;
}

export default function Register({ onRegistered, onLogin }: Props) {
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  const setToken = useAuthStore((s) => s.setToken);

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Il nome è obbligatorio";
    if (!email.includes("@")) e.email = "Inserisci un'email valida";
    if (password.length < 8) e.password = "La password deve avere almeno 8 caratteri";
    if (password !== confirm) e.confirm = "Le password non corrispondono";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setErrors({});
    setStep("submitting");

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    try {
      // 1. Registra l'utente su Keycloak (via backend Admin API)
      await registerUser({
        name: cleanName,
        email: cleanEmail,
        password: password,
      });

      // 2. Configurazione OIDC obbligatoria — scambio credenziali per ottenere il token
      if (!KEYCLOAK_REALM_URL || !KEYCLOAK_CLIENT_ID) {
        throw new Error("Configurazione OIDC non disponibile. Contatta l'amministratore.");
      }

      const bodyParams = new URLSearchParams({
        grant_type: "password",
        client_id: KEYCLOAK_CLIENT_ID,
        username: cleanEmail,
        password: password,
        scope: "openid profile email",
      });

      const tokenRes = await fetch(`${KEYCLOAK_REALM_URL}/protocol/openid-connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: bodyParams.toString(),
      });

      const tokenData = await tokenRes.json().catch(() => ({}));

      if (!tokenRes.ok || !tokenData.access_token) {
        throw new Error(
          tokenData.error_description || "Impossibile completare l'accesso dopo la registrazione.",
        );
      }

      setToken(tokenData.access_token);

      // 3. Risolvi il profilo utente e l'eventuale famiglia attiva. Un utente appena
      // registrato normalmente non ne ha ancora una: in quel caso hasFamilyId resta null e
      // App.tsx instrada correttamente verso l'onboarding (vedi handleRegistered in App.tsx).
      let familyId: string | null = null;
      let userId = cleanEmail;
      let userProfileName = cleanName || cleanEmail.split("@")[0];

      try {
        const apiUser = await getCurrentUser();
        if (apiUser) {
          userId = apiUser.id;
          userProfileName = apiUser.name || userProfileName;
          if (apiUser.activeFamilyId) familyId = apiUser.activeFamilyId;
        }
      } catch {
        // /auth/me non ancora disponibile subito dopo la registrazione: proseguiamo con i
        // dati del form, come fa Login.tsx nello stesso caso.
      }

      let role: AuthUser["role"] = "OWNER";
      if (familyId) {
        try {
          const families = await listFamilies();
          const found = families.families.find((f) => f.familyId === familyId);
          if (found) role = found.role as AuthUser["role"];
        } catch {
          /* mantieni il default */
        }
      }

      const user: AuthUser = {
        id: userId,
        name: userProfileName,
        email: cleanEmail,
        avatar: userProfileName.slice(0, 2).toUpperCase(),
        role,
        hasFamilyId: familyId,
      };

      setStep("done");
      setTimeout(() => onRegistered(user), 900);
    } catch (err: unknown) {
      setStep("form");
      setApiError(err instanceof Error ? err.message : "Errore durante la registrazione. Riprova.");
    }
  }

  return (
    <AuthShell title="Crea account" subtitle="Inizia a gestire la dispensa di famiglia">
      {step === "done" ? (
        <div className="text-center space-y-4 py-4">
          <div className="text-5xl">✓</div>
          <p className="font-medium" style={{ color: colors.sageDark }}>Account creato!</p>
          <p className="text-sm" style={{ color: colors.inkMuted }}>Configurazione della tua famiglia…</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {apiError && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: colors.terracottaLight, color: colors.terracotta }}>
              {apiError}
            </div>
          )}

          {[
            { label: "Nome completo", key: "name", val: name, set: setName, type: "text", placeholder: "Es. Giulia Ferretti", autocomplete: "name" },
            { label: "Email", key: "email", val: email, set: setEmail, type: "email", placeholder: "nome@esempio.it", autocomplete: "email" },
          ].map((f) => (
            <Input
              key={f.key}
              label={f.label}
              type={f.type}
              value={f.val}
              onChange={(e) => {
                f.set(e.target.value);
                setErrors((err) => { const n = { ...err }; delete n[f.key]; return n; });
                setApiError(null);
              }}
              placeholder={f.placeholder}
              autoComplete={f.autocomplete}
              required
              error={errors[f.key]}
            />
          ))}

          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: colors.inkMuted }}>Password</label>
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors((err) => { const n = { ...err }; delete n.password; return n; });
                  setApiError(null);
                }}
                placeholder="Almeno 8 caratteri"
                autoComplete="new-password"
                className="pr-24"
                error={errors.password}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-[10px] text-xs px-2 py-1 rounded-lg"
                style={{ color: colors.inkMuted }}
              >
                {showPw ? "Nascondi" : "Mostra"}
              </button>
            </div>
          </div>

          <Input
            label="Conferma password"
            type={showPw ? "text" : "password"}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setErrors((err) => { const n = { ...err }; delete n.confirm; return n; });
              setApiError(null);
            }}
            placeholder="Ripeti la password"
            autoComplete="new-password"
            error={errors.confirm}
          />

          <p className="text-[10px] leading-relaxed" style={{ color: colors.inkMuted }}>
            Continuando accetti i Termini di servizio e la Privacy Policy.
          </p>

          <button
            type="submit"
            disabled={step === "submitting"}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
            style={{ backgroundColor: step === "submitting" ? colors.border : colors.terracotta, color: colors.white }}
          >
            {step === "submitting" ? "Creazione account…" : "Crea account"}
          </button>
        </form>
      )}

      {step === "form" && (
        <div className="text-center mt-4">
          <span className="text-xs" style={{ color: colors.inkMuted }}>Hai già un account? </span>
          <button type="button" onClick={onLogin} className="text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: colors.terracotta }}>
            Accedi
          </button>
        </div>
      )}
    </AuthShell>
  );
}