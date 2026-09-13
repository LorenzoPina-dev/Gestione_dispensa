import { forwardRef } from "react";
import { colors, fonts } from "../../tokens";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = "", style, ...rest }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="text-xs font-medium block" style={{ color: colors.inkMuted }}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full px-4 py-3 rounded-xl text-sm outline-none transition-all ${className}`}
          style={{
            backgroundColor: colors.creamDark,
            border: `1px solid ${error ? colors.terracotta : colors.border}`,
            color: colors.ink,
            fontFamily: fonts.sans,
            ...style,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = colors.terracotta;
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = error ? colors.terracotta : colors.border;
            rest.onBlur?.(e);
          }}
          {...rest}
        />
        {error && <p className="text-xs" style={{ color: colors.terracotta }}>{error}</p>}
        {hint && !error && <p className="text-xs" style={{ color: colors.inkMuted }}>{hint}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, style, ...rest }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="text-xs font-medium block" style={{ color: colors.inkMuted }}>
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all resize-none"
          style={{
            backgroundColor: colors.creamDark,
            border: `1px solid ${error ? colors.terracotta : colors.border}`,
            color: colors.ink,
            fontFamily: fonts.sans,
            ...style,
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = colors.terracotta; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = error ? colors.terracotta : colors.border; }}
          {...rest}
        />
        {error && <p className="text-xs" style={{ color: colors.terracotta }}>{error}</p>}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  children: React.ReactNode;
}

export function Select({ label, children, style, ...rest }: SelectProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="text-xs font-medium block" style={{ color: colors.inkMuted }}>
          {label}
        </label>
      )}
      <select
        className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
        style={{
          backgroundColor: colors.creamDark,
          border: `1px solid ${colors.border}`,
          color: colors.ink,
          fontFamily: fonts.sans,
          ...style,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = colors.terracotta; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
        {...rest}
      >
        {children}
      </select>
    </div>
  );
}
