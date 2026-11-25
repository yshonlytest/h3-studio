export interface DiagnosticResult {
  title: string;
  reason: string;
  action: string;
  plainText: string;
}

export interface DiagnosticsProvider {
  diagnoseNetworkError: (
    err: unknown,
    ctx?: { service?: string }
  ) => { title?: string; reason?: string; action?: string };
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

export function formatDiagnosticError(
  err: unknown,
  service: string,
  diagnostics?: DiagnosticsProvider
): DiagnosticResult {
  const provider =
    diagnostics ??
    (typeof window !== "undefined"
      ? (window as { H3CloudDiagnostics?: DiagnosticsProvider }).H3CloudDiagnostics
      : undefined);

  if (provider && typeof provider.diagnoseNetworkError === "function") {
    const raw = provider.diagnoseNetworkError(err, { service });
    const title = String(raw?.title || "").trim();
    const reason = String(raw?.reason || getErrorMessage(err)).trim();
    const action = String(raw?.action || "").trim();
    const plainText = title
      ? action
        ? `${title}：${reason}（${action}）`
        : `${title}：${reason}`
      : action
        ? `${reason}（${action}）`
        : reason;
    return { title, reason, action, plainText };
  }

  const msg = getErrorMessage(err);
  return {
    title: "",
    reason: msg,
    action: "",
    plainText: msg,
  };
}
