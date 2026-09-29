import { useEffect } from "react";
import { colors, fonts } from "../../tokens";

interface ModalProps {
  onClose?: () => void;
  children: React.ReactNode;
  /** "sheet" slides up from bottom on mobile, centered on desktop. "dialog" is always centered. */
  variant?: "sheet" | "dialog";
  maxWidth?: string;
}

export function Modal({ onClose, children, variant = "sheet", maxWidth = "max-w-md" }: ModalProps) {
  // Trap scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const isSheet = variant === "sheet";

  return (
    <div
      className={`fixed inset-0 z-50 flex ${isSheet ? "items-end sm:items-center" : "items-center"} justify-center`}
      style={{ backgroundColor: "rgba(26,21,16,0.48)" }}
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${maxWidth} ${isSheet ? "rounded-t-3xl sm:rounded-3xl" : "rounded-3xl"} overflow-hidden`}
        style={{ backgroundColor: colors.cream, maxHeight: "92vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  loading?: boolean;
}

export function ConfirmModal({
  title, message, confirmLabel = "Conferma", cancelLabel = "Annulla",
  onConfirm, onCancel, destructive = false, loading = false,
}: ConfirmModalProps) {
  return (
    <Modal onClose={onCancel} variant="dialog" maxWidth="max-w-xs">
      <div className="p-6 space-y-4">
        <h3
          className="text-lg font-light"
          style={{ fontFamily: fonts.display, color: destructive ? colors.terracotta : colors.ink }}
        >
          {title}
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: colors.ink }}>{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium"
            style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{
              backgroundColor: loading ? colors.disabled : destructive ? colors.terracotta : colors.ink,
              color: colors.white,
            }}
          >
            {loading ? "Attendere…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
