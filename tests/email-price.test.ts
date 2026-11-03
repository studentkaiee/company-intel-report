import { describe, expect, it, vi } from "vitest";
import { buildReportEmail, escapeHtml, maskEmail, sendReportEmail, type EmailSender } from "@/lib/email";
import { formatSgd } from "@/lib/price";

const email = {
  to: "buyer@example.com",
  companyName: "ACME <script> PTE. LTD.",
  pdf: Buffer.from("%PDF-1.4"),
  filename: "ACME-report.pdf",
  reportUrl: "https://app.test/report?session_id=cs_test_1",
};

describe("report email", () => {
  it("escapes the company name in HTML", () => {
    const { html, subject } = buildReportEmail(email);
    expect(html).toContain("ACME &lt;script&gt; PTE. LTD.");
    expect(html).not.toContain("<script>");
    expect(subject).toBe("Your company report: ACME <script> PTE. LTD.");
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });

  it("attaches the PDF and uses an idempotency key", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "e1" }, error: null });
    const ok = await sendReportEmail(email, "key-1", { send } as unknown as EmailSender, "Reports <r@x.sg>");
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Reports <r@x.sg>",
        to: "buyer@example.com",
        attachments: [{ filename: "ACME-report.pdf", content: email.pdf }],
      }),
      { idempotencyKey: "key-1" },
    );
  });

  it("never throws, and reports failure", async () => {
    const rejected = vi.fn().mockResolvedValue({ data: null, error: { name: "validation_error", message: "bad" } });
    const thrown = vi.fn().mockRejectedValue(new Error("network"));
    expect(await sendReportEmail(email, "k", { send: rejected } as unknown as EmailSender, "a@b.sg")).toBe(false);
    expect(await sendReportEmail(email, "k", { send: thrown } as unknown as EmailSender, "a@b.sg")).toBe(false);
  });

  it("is skipped when Resend is not configured", async () => {
    const send = vi.fn();
    expect(await sendReportEmail(email, "k", null, "a@b.sg")).toBe(false);
    expect(await sendReportEmail(email, "k", { send } as unknown as EmailSender, undefined)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("masks addresses for display", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j***@example.com");
    expect(maskEmail("nonsense")).toBe("your email");
  });
});

describe("formatSgd", () => {
  it("formats whole and fractional dollars", () => {
    expect(formatSgd(4900)).toBe("S$49");
    expect(formatSgd(4950)).toBe("S$49.50");
    expect(formatSgd(129900)).toBe("S$1,299");
  });
});
