/**
 * Which sites the person screen searches. Checked 2026-11-03 with `node --env-file=.env.local scripts/check-outlets.mjs`.
 * Re-run it periodically: if a site in SG_OFFICIAL_SOURCES starts blocking Anthropic's crawler, the API rejects
 * the official-sources call with a 400 and every screen fails until the site is removed here.
 */

/** Singapore courts and regulators, searched first with `allowed_domains` (the search provider ignores `site:`). */
export const SG_OFFICIAL_SOURCES = [
  "judiciary.gov.sg",
  // eLitigation is the Singapore Judiciary's official site for published judgments.
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

/** Official Singapore court record sites: a finding sourced here is treated as a strong match. */
export const SG_COURT_RECORD_SOURCES = ["judiciary.gov.sg", "elitigation.sg"];

/** Singapore news media: never searched (blocked on the open-web call). */
export const SG_MEDIA_DOMAINS = [
  "straitstimes.com",
  "channelnewsasia.com",
  "todayonline.com",
  "businesstimes.com.sg",
  "tnp.sg",
  "zaobao.com.sg",
  "beritaharian.sg",
  "tamilmurasu.com.sg",
  "mothership.sg",
  "asiaone.com",
  "sg.news.yahoo.com",
  "8world.com",
  "theindependent.sg",
  "mustsharenews.com",
  "stomp.straitstimes.com",
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** True when `url` is on `domain` or one of its subdomains. */
export const onDomain = (url: string, domains: string[]) => {
  const host = hostOf(url);
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
};
