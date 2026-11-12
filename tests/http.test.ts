import { describe, expect, it } from "vitest";
import { publicOrigin } from "@/lib/http";

const req = (headers: Record<string, string>) => new Request("https://localhost:3000/api/checkout", { headers });

describe("publicOrigin", () => {
  it("uses the server's own origin by default", () => {
    expect(publicOrigin(req({}))).toBe("https://localhost:3000");
  });

  it("uses a Cloudflare quick tunnel host from the forwarded headers", () => {
    expect(publicOrigin(req({ "x-forwarded-host": "run-chan-dinner-teenage.trycloudflare.com" }))).toBe(
      "https://run-chan-dinner-teenage.trycloudflare.com",
    );
    expect(publicOrigin(req({ host: "abc-def.trycloudflare.com" }))).toBe("https://abc-def.trycloudflare.com");
  });

  it("ignores any other forwarded host, so a client can't redirect payers elsewhere", () => {
    expect(publicOrigin(req({ "x-forwarded-host": "evil.example.com" }))).toBe("https://localhost:3000");
    expect(publicOrigin(req({ "x-forwarded-host": "trycloudflare.com.evil.example" }))).toBe("https://localhost:3000");
    expect(publicOrigin(req({ "x-forwarded-host": "a.b.trycloudflare.com" }))).toBe("https://localhost:3000");
  });
});
