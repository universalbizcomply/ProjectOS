// ProjectOS Watchdog Core — email transport (Resend-compatible HTTP API).
//
// Ported from the JD reference (monitoring-email.ts). "accepted" means the
// provider accepted the request (HTTP 2xx); final inbox delivery cannot be
// known synchronously and is not part of the contract. The generic incident
// logic does not depend on this module: it is one NotificationTransport.
//
// Alert content is deliberately bounded: product, environment, check, scope,
// severity, kind and age. Check metadata is never rendered into email.

import type { DeliveryResult, NotificationBatch, NotificationTransport, PlannedNotification } from "./notifications.ts";

export const EMAIL_TIMEOUT_MS = 10_000;

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function parseRecipients(value: unknown): string[] {
  return Array.isArray(value)
    ? (value as unknown[]).filter((x): x is string => typeof x === "string" && /^[^\s@]+@[^\s@]+$/.test(x))
    : [];
}

export type EmailBrand = { productName: string; dashboardUrl: string | null; test: boolean };

function headline(n: readonly PlannedNotification[]): string {
  if (n.every((x) => x.kind === "RECOVERY")) return "RECOVERED";
  if (n.some((x) => x.kind !== "RECOVERY" && x.severity === "CRITICAL")) return "CRITICAL";
  if (n.some((x) => x.kind !== "RECOVERY" && x.severity === "ERROR")) return "ERROR";
  return "WARNING";
}

export function renderEmail(batch: NotificationBatch, brand: EmailBrand): { subject: string; html: string } {
  const worst = headline(batch.notifications);
  const prefix = brand.test ? "[TEST — ignore] " : "";
  const subject = prefix + brand.productName + " (" + batch.environment + ") monitoring: " + worst +
    " — " + batch.notifications.length + " item" + (batch.notifications.length === 1 ? "" : "s");
  const now = Date.parse(batch.generated_at);
  const rows = batch.notifications.map((n) => {
    const ageMin = Number.isFinite(now) ? Math.max(0, Math.floor((now - Date.parse(n.opened_at)) / 60000)) : 0;
    const label = n.kind === "RECOVERY" ? "RECOVERED" : n.severity;
    return "<tr><td style=\"padding:6px 12px 6px 0;font-weight:600;\">" + escapeHtml(label) + "</td>" +
      "<td style=\"padding:6px 12px 6px 0;\">" + escapeHtml(n.identity.check_id) + "</td>" +
      "<td style=\"padding:6px 12px 6px 0;font-family:ui-monospace,monospace;\">" + escapeHtml(n.identity.scope_type + ":" + n.identity.scope_id) + "</td>" +
      "<td style=\"padding:6px 12px 6px 0;\">" + escapeHtml(n.kind) + "</td>" +
      "<td style=\"padding:6px 0;\">" + ageMin + " min</td></tr>";
  }).join("");
  const link = brand.dashboardUrl
    ? "<p style=\"margin:16px 0 0 0;font-size:13px;\">Details: " + escapeHtml(brand.dashboardUrl) + "</p>"
    : "";
  const html = "<!DOCTYPE html><html><body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;\">" +
    "<h1 style=\"font-size:18px;\">" + escapeHtml(brand.productName + " monitoring — " + worst) + "</h1>" +
    "<table style=\"border-collapse:collapse;font-size:13px;\">" + rows + "</table>" + link +
    "<p style=\"margin:18px 0 0 0;font-size:12px;color:#71717a;\">Automated internal monitoring (ProjectOS Watchdog). " +
    "Internal notification — do not forward to customers.</p></body></html>";
  return { subject, html };
}

export function createEmailTransport(opts: {
  apiKey: string | undefined;
  from: string;
  recipients: string[];
  brand: EmailBrand;
  fetchImpl: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
}): NotificationTransport {
  return {
    async send(batch: NotificationBatch): Promise<DeliveryResult> {
      if (opts.recipients.length === 0) return { accepted: false, code: "no_recipients" };
      if (!opts.apiKey) return { accepted: false, code: "no_api_key" };
      const { subject, html } = renderEmail(batch, opts.brand);
      let resp: Response;
      try {
        resp = await opts.fetchImpl(opts.endpoint ?? "https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + opts.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ from: opts.from, to: opts.recipients, subject, html }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? EMAIL_TIMEOUT_MS),
        });
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        return { accepted: false, code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
      }
      if (resp.ok) return { accepted: true, code: "accepted" };
      return { accepted: false, code: "http_" + resp.status };
    },
  };
}
