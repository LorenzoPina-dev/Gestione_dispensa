import { useState } from "react";
import AuthShell from "./AuthShell";
import { colors } from "../../tokens";
import { Input } from "../../components/ui/Input";
import { KEYCLOAK_REALM_URL, KEYCLOAK_CLIENT_ID } from "../../api/config";

type Step = "email" | "submitting" | "sent";

interface Props {
  onBack: () => void;
}

export default function ForgotPassword({ onBack }: Props) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>("email");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) return;
    setStep("submitting");

    const cleanEmail = email.trim().toLowerCase();

    if (KEYCLOAK_REALM_URL && KEYCLOAK_CLIENT_ID) {
      try {
        const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
        await fetch(`${apiBaseUrl}/v1/auth/reset-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: cleanEmail }),
        }).catch(() => null);
      } catch {
        // Gestione silenziosa
      }
    }

    setTimeout(() => setStep("sent"), 800);
  }

  return (
    <AuthShell title="Recupera password" subtitle="Ti invieremo un link per reimpostarla">
      {step === "sent" ? (
        <div className="space-y-5">
          <div className="rounded-2xl p-5 text-center space-y-2" style={{ backgroundColor: colors.sageLight }}>
            <p className="text-3xl">✉️</p>
            <p className="font-medium text-sm" style={{ color: colors.sageDark }}>Link inviato</p>
            <p className="text-xs" style={{ color: colors.sage }}>
              Abbiamo inviato un link di recupero a <strong>{email}</strong>. Controlla anche la cartella spam.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}
          >
            Torna al login
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email del tuo account"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@esempio.it"
            autoComplete="email"
            required
          />
          <button
            type="submit"
            disabled={step === "submitting"}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
            style={{ backgroundColor: step === "submitting" ? colors.border : colors.terracotta, color: colors.white }}
          >
            {step === "submitting" ? "Invio in corso…" : "Invia link di recupero"}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="w-full py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
            style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}
          >
            ← Torna al login
          </button>
        </form>
      )}
    </AuthShell>
  );
}