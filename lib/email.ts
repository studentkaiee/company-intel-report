import { Resend } from "resend";
import { env } from "./env";
import { DISCLAIMER } from "./legal";

export type ReportEmail = { to: string; companyName: string; pdf: Buffer; filename: string; reportUrl: string };

/** Minimal interface so tests can pass a fake. */
export type EmailSender = Pick<Resend["emails"], "send">;

function defaultSender(): EmailSender | null {
  const key = env().RESEND_API_KEY;
  return key ? new Resend(key).emails : null;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function buildReportEmail(e: Omit<ReportEmail, "pdf" | "filename" | "to">): { subject: string; html: string; text: string } {
  const name = escapeHtml(e.companyName);
  const url = escapeHtml(e.reportUrl);
  return {
    subject: `Your company report: ${e.companyName}`.slice(0, 200),
    html: `<p>Hello,</p>
<p>Your company intelligence report on <strong>${name}</strong> is attached as a PDF.</p>
<p>You can also view it online: <a href="${url}">${url}</a></p>
<p style="color:#666;font-size:12px">${escapeHtml(DISCLAIMER)}</p>`,
    text: `Your company intelligence report on ${e.companyName} is attached as a PDF.\n\nView it online: ${e.reportUrl}\n\n${DISCLAIMER}`,
  };
}

/**
 * Emails the finished PDF. Never throws: a failed email must not fail a paid report.
 * Returns true if Resend accepted the message.
 */
export async function sendReportEmail(
  e: ReportEmail,
  idempotencyKey: string,
  sender: EmailSender | null = defaultSender(),
  from: string | undefined = env().RESEND_FROM_EMAIL,
): Promise<boolean> {
  if (!sender || !from) return false;
  const { subject, html, text } = buildReportEmail(e);
  try {
    const res = await sender.send(
      { from, to: e.to, subject, html, text, attachments: [{ filename: e.filename, content: e.pdf }] },
      { idempotencyKey },
    );
    if (res.error) {
      console.error("report email rejected:", res.error.name);
      return false;
    }
    return true;
  } catch (err) {
    console.error("report email failed:", err instanceof Error ? err.constructor.name : typeof err);
    return false;
  }
}

/** "jane.doe@example.com" -> "j***@example.com", for showing on screen. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "your email";
  return `${user[0]}***@${domain}`;
}
