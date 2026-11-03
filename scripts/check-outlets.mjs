// Checks that Claude's web tools can still reach the Singapore court and regulator sites the person screen
// searches. The API rejects allowed_domains entries whose sites block Anthropic's crawler and names them in the
// error, so one small request tells us the answer. If any site below shows as blocked, remove it from
// SG_OFFICIAL_SOURCES in lib/person/outlets.ts, or every Individual Legal Screen will fail.
//
//   node --env-file=.env.local scripts/check-outlets.mjs

import Anthropic from "@anthropic-ai/sdk";

// Keep in sync with SG_OFFICIAL_SOURCES.
const DOMAINS = [
  "judiciary.gov.sg",
  "elitigation.sg",
  "mas.gov.sg",
  "sgx.com",
  "acra.gov.sg",
  "cccs.gov.sg",
  "pdpc.gov.sg",
  "mom.gov.sg",
  "police.gov.sg",
  "agc.gov.sg",
  "lawsociety.org.sg",
  "singaporelawwatch.sg",
];

const client = new Anthropic({ maxRetries: 0 });
try {
  await client.beta.messages.create({
    model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
    max_tokens: 50,
    output_config: { effort: "low" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1, allowed_domains: DOMAINS }],
    messages: [{ role: "user", content: "Reply ok. Do not search." }],
  });
  console.log("All reachable:", DOMAINS.join(", "));
} catch (e) {
  const listed = String(e?.message ?? "").match(/\[(.*?)\]/)?.[1];
  if (!listed) {
    console.error("Unexpected error:", e?.status, e?.constructor?.name);
    process.exit(1);
  }
  const blocked = listed.replace(/'/g, "").split(", ");
  console.log("Blocked:  ", blocked.join(", "));
  console.log("Reachable:", DOMAINS.filter((d) => !blocked.includes(d)).join(", "));
  process.exit(1);
}
