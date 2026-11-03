import { afterEach, describe, expect, it, vi } from "vitest";
import { sign, signDetached, verify, verifyDetached } from "@/lib/signing";
import { issuePreviewToken, issueScanTicket, readPreviewToken, readScanTicket } from "@/lib/tokens";

afterEach(() => vi.useRealTimers());

describe("signed tokens", () => {
  it("round-trips a payload", () => {
    expect(verify<{ a: number }>(sign({ a: 1 }, 60))).toMatchObject({ a: 1 });
  });

  it("rejects tampered payloads", () => {
    const [body, mac] = sign({ uen: "A" }, 60).split(".");
    const forged = Buffer.from(JSON.stringify({ uen: "B", exp: 9e9 })).toString("base64url");
    expect(verify(`${forged}.${mac}`)).toBeNull();
    expect(verify(`${body}.x${mac}`)).toBeNull();
    expect(verify("garbage")).toBeNull();
  });

  it("rejects tokens signed with another secret", () => {
    expect(verify(sign({ a: 1 }, 60, "another-secret-another-secret-123"))).toBeNull();
  });

  it("expires", () => {
    vi.useFakeTimers();
    const t = sign({ a: 1 }, 60);
    vi.advanceTimersByTime(61_000);
    expect(verify(t)).toBeNull();
  });

  it("does not accept a scan ticket as a preview token", () => {
    const ticket = issueScanTicket({ name: "Acme", uen: "201912345K" });
    expect(readScanTicket(ticket)).toMatchObject({ name: "Acme" });
    expect(readPreviewToken(ticket)).toBeNull();
    expect(readPreviewToken(issuePreviewToken({ name: "Acme", uen: null, website: null }))).toMatchObject({ uen: null });
  });

  it("binds a report to its checkout session", () => {
    const mac = signDetached('cs_test_1\n{"a":1}');
    expect(verifyDetached('cs_test_1\n{"a":1}', mac)).toBe(true);
    expect(verifyDetached('cs_test_2\n{"a":1}', mac)).toBe(false);
    expect(verifyDetached('cs_test_1\n{"a":2}', mac)).toBe(false);
  });
});
