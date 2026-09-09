import { createShellModel, resolveSafeRedirect, type ShellModel } from "./shell.js";

export interface OidcCallbackInput {
  readonly code?: string;
  readonly state?: string;
  readonly expectedState: string;
  readonly redirectTo?: string;
}

export interface BrowserRuntime {
  readonly shell: ShellModel;
  readonly redirectTo: string;
  readonly oidcCode?: string;
}

export function createBrowserRuntime(input: {
  readonly path?: string;
  readonly principal?: { readonly userId: string; readonly displayName: string };
  readonly family?: { readonly familyId: string; readonly displayName: string };
  readonly online?: boolean;
  readonly errorMessage?: string;
}): BrowserRuntime {
  const state = input.errorMessage
    ? "ERROR"
    : input.online === false
      ? "OFFLINE"
      : input.principal === undefined
        ? "LOADING"
        : "READY";
  return {
    shell: createShellModel({
      ...(input.principal === undefined ? {} : { principal: input.principal }),
      ...(input.family === undefined ? {} : { family: input.family }),
      state,
      ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
      ...(input.path === undefined ? {} : { currentPath: input.path }),
    }),
    redirectTo: resolveSafeRedirect(input.path),
  };
}

export function consumeOidcCallback(input: OidcCallbackInput): BrowserRuntime {
  if (input.code === undefined || input.state !== input.expectedState) {
    return {
      shell: createShellModel({
        state: "ERROR",
        errorMessage: "The sign-in callback could not be verified.",
      }),
      redirectTo: "/",
    };
  }
  return {
    shell: createShellModel({ state: "READY" }),
    redirectTo: resolveSafeRedirect(input.redirectTo),
    oidcCode: input.code,
  };
}

export function renderPwaDocument(model: ShellModel): string {
  const status = model.state === "READY" ? "Family workspace" : "Loading family workspace";
  const links = model.navigation
    .map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#ffffff"><title>${escapeHtml(status)}</title></head><body><main><h1>${escapeHtml(status)}</h1><nav aria-label="Family navigation">${links}</nav></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
