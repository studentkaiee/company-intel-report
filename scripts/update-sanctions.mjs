// Downloads the official UN Security Council Consolidated List and the OFAC SDN list, keeps individuals only
// (names, aliases, dates of birth, nationalities), and writes them to data/sanctions/*.json.
// This is static data shipped with the app, not a database: re-run it and redeploy to refresh the lists.
//
//   node scripts/update-sanctions.mjs
//
// data/sanctions/tsofa.json (Terrorism (Suppression of Financing) Act, First Schedule) is maintained by hand
// and is not touched by this script.

import { mkdir, writeFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

const UN_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";
const OFAC_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
const OUT = new URL("../data/sanctions/", import.meta.url);

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const arr = (v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
const uniq = (xs) => [...new Set(xs.filter(Boolean))];

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

/** Years and exact dates from free-form date strings such as "10 Dec 1948", "circa 1955", "1960 to 1962". */
function parseDates(values) {
  const years = [];
  const dates = [];
  for (const v of values) {
    const s = text(v);
    const range = s.match(/\b(19\d{2}|20\d{2})\s*(?:to|-)\s*(19\d{2}|20\d{2})\b/i);
    if (range) {
      for (let y = Number(range[1]); y <= Number(range[2]) && y - Number(range[1]) < 15; y++) years.push(y);
      continue;
    }
    for (const m of s.matchAll(/\b(19\d{2}|20\d{2})\b/g)) years.push(Number(m[1]));
    const exact = s.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\b/);
    if (exact && MONTHS[exact[2].toLowerCase()]) {
      dates.push(`${exact[3]}-${String(MONTHS[exact[2].toLowerCase()]).padStart(2, "0")}-${exact[1].padStart(2, "0")}`);
    }
    const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) dates.push(iso[0]);
  }
  return { birthYears: uniq(years).sort(), birthDates: uniq(dates).sort() };
}

function parseUn(xml) {
  const doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml);
  const root = doc.CONSOLIDATED_LIST;
  const asOf = text(root["@_dateGenerated"]).slice(0, 10);
  const entries = arr(root.INDIVIDUALS?.INDIVIDUAL).map((p) => {
    const full = [p.FIRST_NAME, p.SECOND_NAME, p.THIRD_NAME, p.FOURTH_NAME].map(text).filter(Boolean).join(" ");
    const aliases = arr(p.INDIVIDUAL_ALIAS).map((a) => text(a.ALIAS_NAME));
    const dobValues = arr(p.INDIVIDUAL_DATE_OF_BIRTH).flatMap((d) => [d.DATE, d.YEAR, d.FROM_YEAR && d.TO_YEAR ? `${d.FROM_YEAR} to ${d.TO_YEAR}` : ""]);
    return {
      id: `UN-${text(p.REFERENCE_NUMBER) || text(p.DATAID)}`,
      names: uniq([full, text(p.NAME_ORIGINAL_SCRIPT), ...aliases]),
      ...parseDates(dobValues),
      nationalities: uniq(arr(p.NATIONALITY?.VALUE).map(text)),
      program: text(p.UN_LIST_TYPE),
    };
  });
  return { asOf, entries };
}

function parseOfac(xml) {
  const doc = new XMLParser({ ignoreAttributes: true, parseTagValue: false }).parse(xml);
  const root = doc.sdnList;
  const [mm, dd, yyyy] = text(root.publshInformation?.Publish_Date).split("/");
  const asOf = yyyy ? `${yyyy}-${mm}-${dd}` : "";
  const entries = arr(root.sdnEntry)
    .filter((e) => text(e.sdnType) === "Individual")
    .map((e) => {
      const name = (n) => [text(n.firstName), text(n.lastName)].filter(Boolean).join(" ");
      return {
        id: `OFAC-${text(e.uid)}`,
        names: uniq([name(e), ...arr(e.akaList?.aka).map(name)]),
        ...parseDates(arr(e.dateOfBirthList?.dateOfBirthItem).map((d) => d.dateOfBirth)),
        nationalities: uniq([
          ...arr(e.nationalityList?.nationality).map((n) => text(n.country)),
          ...arr(e.citizenshipList?.citizenship).map((n) => text(n.country)),
        ]),
        program: arr(e.programList?.program).map(text).join(", "),
      };
    });
  return { asOf, entries };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const [un, ofac] = await Promise.all([download(UN_URL).then(parseUn), download(OFAC_URL).then(parseOfac)]);
  const files = [
    ["un.json", { list: "UN", name: "UN Security Council Consolidated List", source: UN_URL, ...un }],
    ["ofac.json", { list: "OFAC", name: "US OFAC Specially Designated Nationals (SDN) List", source: OFAC_URL, ...ofac }],
  ];
  for (const [file, data] of files) {
    if (data.entries.length < 100) throw new Error(`${file}: only ${data.entries.length} individuals parsed; refusing to overwrite`);
    await writeFile(new URL(file, OUT), JSON.stringify(data));
    console.log(`${file}: ${data.entries.length} individuals, as of ${data.asOf}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
