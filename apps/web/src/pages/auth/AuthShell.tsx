import React from "react";
import { colors, fonts } from "../../tokens";

interface Props {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export default function AuthShell({ children, title, subtitle }: Props) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12 transition-colors"
      style={{ backgroundColor: colors.cream }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10 select-none">
        <span className="text-5xl" role="img" aria-label="Dispensa Logo">🫙</span>
        <div>
          <p className="text-3xl font-light tracking-tight" style={{ fontFamily: fonts.display, color: colors.ink }}>
            Dispensa
          </p>
          <p className="text-xs tracking-wide" style={{ color: colors.inkMuted }}>la cucina di famiglia</p>
        </div>
      </div>

      {/* Card */}
      <div
        className="w-full max-w-sm rounded-3xl p-8 space-y-6"
        style={{
          backgroundColor: colors.white,
          border: `1px solid ${colors.border}`,
          boxShadow: "0 4px 24px rgba(26,21,16,0.06)",
        }}
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>
            {title}
          </h1>
          {subtitle && <p className="text-sm" style={{ color: colors.inkMuted }}>{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}