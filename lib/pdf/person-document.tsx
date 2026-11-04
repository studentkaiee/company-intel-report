import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { HISTORICAL_NOTE, NOT_A_CRIMINAL_RECORD_CHECK, PERSON_LIMITATIONS, SCOPE_NOTES } from "../person/legal";
import { SG_COURT_RECORD_SOURCES, SG_OFFICIAL_SOURCES, onDomain } from "../person/outlets";
import { CASE_STAGES, CATEGORIES, findingCounts, type Finding, type PersonReport, type SanctionsListResult } from "../person/schema";

/**
 * Layout follows the AML/CFT search report format the business already uses: a blue title band, the subject's
 * name and country, a search line, then a two-column result table, with a grey footer (timestamp and page number) on every page and an
 * explanatory page at the end.
 */

const BLUE = "#006699";
const GREY = "#e6e6e6";

const s = StyleSheet.create({
  // Top padding gives continuation pages a margin; the first page's blue band cancels it with a negative margin.
  page: { paddingTop: 36, paddingBottom: 80, paddingHorizontal: 0, fontSize: 10, fontFamily: "Helvetica", color: "#000", lineHeight: 1.3 },
  band: { backgroundColor: BLUE, height: 92, marginTop: -36, paddingLeft: 20, justifyContent: "center" },
  bandTitle: { color: "#fff", fontSize: 26, fontFamily: "Helvetica-Bold" },
  body: { paddingHorizontal: 29 },
  nameLine: { flexDirection: "row", marginTop: 20, fontSize: 14, fontFamily: "Helvetica-Bold" },
  countryLine: { flexDirection: "row", marginTop: 6, fontSize: 14, fontFamily: "Helvetica-Bold" },
  headLabel: { width: 72 },
  headValue: { flex: 1 },
  searchLine: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, paddingLeft: 3, paddingBottom: 6, borderBottomWidth: 1, borderColor: "#000" },
  searchItem: { marginRight: 18 },
  bold: { fontFamily: "Helvetica-Bold" },
  table: { marginTop: 17, marginRight: 20, borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: "#000" },
  row: { flexDirection: "row", minHeight: 30, borderBottomWidth: 0.5, borderColor: "#000" },
  labelCell: { width: 170, paddingHorizontal: 3, paddingVertical: 8, borderRightWidth: 0.5, borderColor: "#000", fontFamily: "Helvetica-Bold" },
  valueCell: { flex: 1, paddingHorizontal: 6, paddingVertical: 8, borderRightWidth: 0.5, borderColor: "#000" },
  hit: { fontFamily: "Helvetica-Bold", color: "#b91c1c" },
  sectionTitle: { marginTop: 22, marginBottom: 6, paddingBottom: 3, fontSize: 12, fontFamily: "Helvetica-Bold", borderBottomWidth: 1, borderColor: "#000" },
  small: { fontSize: 9, marginBottom: 3 },
  note: { fontSize: 9, color: "#333", marginTop: 6 },
  link: { fontSize: 8, color: BLUE },
  finding: { marginTop: 10, marginRight: 20, borderWidth: 0.5, borderColor: "#000" },
  findingTitle: { backgroundColor: GREY, padding: 5, fontFamily: "Helvetica-Bold", borderBottomWidth: 0.5, borderColor: "#000" },
  findingRow: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#000" },
  findingLabel: { width: 110, padding: 4, fontFamily: "Helvetica-Bold", borderRightWidth: 0.5, borderColor: "#000" },
  findingValue: { flex: 1, padding: 4 },
  aboutIntro: { fontSize: 9, marginTop: 4, marginLeft: 11 },
  aboutHeading: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 14, marginLeft: 11 },
  bulletRow: { flexDirection: "row", marginTop: 3, marginLeft: 51, fontSize: 9 },
  bulletDot: { width: 12 },
  bulletText: { flex: 1, marginRight: 20 },
  // Same box as the sample: x 21-576, y 784-822 on an A4 page (842pt tall).
  footer: { position: "absolute", left: 21, top: 784, width: 555, height: 38, backgroundColor: GREY, paddingHorizontal: 5, paddingVertical: 3 },
  pageNumber: { position: "absolute", top: 787, right: 45, fontSize: 10 },
});

/**
 * The built-in Helvetica font only covers Latin characters. Model text is written in English, but a name in
 * Chinese, Jawi or Tamil script can't be drawn, so it is replaced with a note rather than printed as garbage.
 */
export function pdfText(value: string, fallback = "(not shown: non-Latin script)"): string {
  const kept = value.replace(/[^\u0000-ɏ‐-‧‰-⁞]/g, "").replace(/\s+/g, " ").trim();
  return kept.length >= Math.ceil(value.trim().length / 2) ? kept : fallback;
}

/** "17-07-2020 11:06:00" in Singapore time, the format the sample report uses. */
export function sgtStamp(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

const NO_MATCH = "No match found.";

export function sanctionsText(l: SanctionsListResult | undefined) {
  if (!l) return { text: "Not checked.", hit: false };
  if (!l.checked) return { text: "Not checked: this list is not loaded.", hit: false };
  if (!l.matches.length) return { text: `${NO_MATCH} List as of ${l.asOf}.`, hit: false };
  const names = l.matches.map((m) => `${pdfText(m.listedName)} (${m.entryId}): ${m.reason}`).join("; ");
  return { text: `${l.matches.length} possible match${l.matches.length === 1 ? "" : "es"}: ${names}. List as of ${l.asOf}.`, hit: true };
}

export function findingsText(items: Finding[]) {
  if (!items.length) return { text: NO_MATCH, hit: false };
  const strong = items.filter((f) => f.matchConfidence === "strong").length;
  const titles = items.map((f, i) => `(${i + 1}) ${pdfText(f.title).replace(/\.$/, "")}.`).join(" ");
  return {
    text: `${items.length} record${items.length === 1 ? "" : "s"} found${strong ? `, ${strong} strong match${strong === 1 ? "" : "es"}` : ""}. ${titles} See details below.`,
    hit: true,
  };
}

export function Row({ label, value, hit }: { label: string; value: string; hit?: boolean }) {
  return (
    <View style={s.row} wrap={false}>
      <Text style={s.labelCell}>{label}</Text>
      <Text style={[s.valueCell, ...(hit ? [s.hit] : [])]}>{value}</Text>
    </View>
  );
}

export function FindingBox({ f, n, historicalNote = HISTORICAL_NOTE }: { f: Finding; n: number; historicalNote?: string }) {
  const finalOutcome = f.caseStage === "acquitted" || f.caseStage === "withdrawn";
  const rows: [string, string][] = [
    ["Category", CATEGORIES[f.category]],
    ["Date", f.date ?? "Unknown"],
    ["Source", pdfText(f.sourceName)],
    ["Case stage", CASE_STAGES[f.caseStage] + (finalOutcome ? " (final outcome)" : "")],
    ["Match", f.matchConfidence.charAt(0).toUpperCase() + f.matchConfidence.slice(1)],
    ["Summary", pdfText(f.summary, "")],
    ["Match evidence", pdfText(f.matchEvidence, "")],
  ];
  if (f.historical) rows.push(["Note", historicalNote]);
  return (
    <View style={s.finding} wrap={false}>
      <Text style={s.findingTitle}>
        {n}. {pdfText(f.title)}
      </Text>
      {rows.map(([label, value]) => (
        <View style={s.findingRow} key={label}>
          <Text style={s.findingLabel}>{label}</Text>
          <Text style={s.findingValue}>{value}</Text>
        </View>
      ))}
      <View style={[s.findingRow, { borderBottomWidth: 0 }]}>
        <Text style={s.findingLabel}>Source links</Text>
        <View style={s.findingValue}>
          {[f.sourceUrl, ...f.additionalSourceUrls].map((u) => (
            <Link key={u} src={u} style={s.link}>
              {u}
            </Link>
          ))}
        </View>
      </View>
    </View>
  );
}

function Footer({ stamp }: { stamp: string }) {
  return (
    <>
      <View style={s.footer} fixed>
        <Text>{stamp}</Text>
      </View>
      {/* A render prop only re-runs per page on a fixed Text placed directly on the page. */}
      <Text style={s.pageNumber} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </>
  );
}

/** Splits findings into the result-table rows: Singapore court records, regulators, MAS alerts, everything else. */
export function groupFindings(findings: Finding[]) {
  const isCourt = (f: Finding) => [f.sourceUrl, ...f.additionalSourceUrls].some((u) => onDomain(u, SG_COURT_RECORD_SOURCES));
  const isSgOfficial = (f: Finding) => [f.sourceUrl, ...f.additionalSourceUrls].some((u) => onDomain(u, SG_OFFICIAL_SOURCES));
  const court = findings.filter(isCourt);
  const alerts = findings.filter((f) => !isCourt(f) && f.category === "investor_alert");
  const regulatory = findings.filter((f) => !isCourt(f) && f.category !== "investor_alert" && isSgOfficial(f));
  const other = findings.filter((f) => !isSgOfficial(f));
  return { court, regulatory, alerts, other, ordered: [...court, ...regulatory, ...alerts, ...other] };
}

export function PersonDocument({ report }: { report: PersonReport }) {
  const subj = report.subject;
  const counts = findingCounts(report);
  const stamp = sgtStamp(report.generatedAt);
  const listByName = (code: string) => report.sanctions.lists.find((l) => l.list === code);

  const { court, regulatory, alerts, other, ordered } = groupFindings(report.findings);

  const un = sanctionsText(listByName("UN"));
  const ofac = sanctionsText(listByName("OFAC"));
  const tsofa = sanctionsText(listByName("TSOFA"));
  const courtT = findingsText(court);
  const regT = findingsText(regulatory);
  const alertT = findingsText(alerts);
  const otherT = findingsText(other);

  return (
    <Document title={`Individual Legal Screen ${report.reportId}`} author="Individual Legal Screen">
      <Page size="A4" style={s.page} wrap>
        <View style={s.band}>
          <Text style={s.bandTitle}>Individual Legal Screen</Text>
        </View>

        <View style={s.body}>
          <View style={s.nameLine}>
            <Text style={s.headLabel}>Name :</Text>
            <Text style={s.headValue}>{pdfText(subj.fullName)}</Text>
          </View>
          <View style={s.countryLine}>
            <Text style={s.headLabel}>Country:</Text>
            <Text style={s.headValue}>{subj.nationality ? pdfText(subj.nationality) : "--"}</Text>
          </View>
          <View style={s.searchLine}>
            <Text style={s.searchItem}>
              <Text style={s.bold}>Search Date: </Text>
              {stamp}
            </Text>
            <Text style={s.searchItem}>
              <Text style={s.bold}>Report ID: </Text>
              {report.reportId}
            </Text>
            <Text style={s.searchItem}>
              <Text style={s.bold}>Verification: </Text>
              {report.verificationCode}
            </Text>
          </View>

          <View style={s.table}>
            <Row label="Date of Birth" value={subj.dob ? subj.dob.split("-").reverse().join("-") : "--"} />
            <Row label="Aliases" value={subj.aliases.map((a) => pdfText(a)).join("; ") || "--"} />
            {subj.nativeName ? <Row label="Name in Local Script" value={pdfText(subj.nativeName, "Provided (shown on the web page only)")} /> : null}
            {subj.occupation ? <Row label="Occupation" value={pdfText(subj.occupation)} /> : null}
            {subj.company ? <Row label="Associated Company" value={pdfText(subj.company)} /> : null}
            <Row label="Purpose" value={report.purpose === "Not given" ? "--" : report.purpose} />
            <Row label="UN Sanctions List" value={un.text} hit={un.hit} />
            <Row label="OFAC SDN List" value={ofac.text} hit={ofac.hit} />
            <Row label="Singapore TSOFA List" value={tsofa.text} hit={tsofa.hit} />
            <Row label="Singapore Court Records" value={courtT.text} hit={courtT.hit} />
            <Row label="Singapore Regulatory Actions" value={regT.text} hit={regT.hit} />
            <Row label="MAS Investor Alert List" value={alertT.text} hit={alertT.hit} />
            <Row label="Other Legal Sources" value={otherT.text} hit={otherT.hit} />
            <Row
              label="Summary"
              value={`${counts.strong} strong and ${counts.possible} possible match${counts.possible === 1 ? "" : "es"}; sanctions: ${
                report.sanctions.status === "possible_match" ? "possible match" : "no match"
              }.`}
              hit={counts.strong + counts.possible > 0 || report.sanctions.status === "possible_match"}
            />
          </View>

          <Text style={s.note}>{NOT_A_CRIMINAL_RECORD_CHECK}</Text>
          {report.overallNote ? <Text style={s.note}>{pdfText(report.overallNote, "")}</Text> : null}

          {ordered.length ? (
            <View>
              <Text style={s.sectionTitle} break>
                Details of records found
              </Text>
              {ordered.map((f, i) => (
                <FindingBox key={f.sourceUrl} f={f} n={i + 1} />
              ))}
            </View>
          ) : null}

          {report.unlikelyMatches.length || report.unlikelyOmitted ? (
            <View>
              <Text style={s.sectionTitle} minPresenceAhead={80}>
                Unlikely matches, shown for transparency
              </Text>
              {report.unlikelyOmitted ? (
                <Text style={s.small}>
                  {report.unlikelyOmitted} weak name-only matches were found and left out because they most likely concern other people.
                </Text>
              ) : (
                report.unlikelyMatches.map((f, i) => <FindingBox key={f.sourceUrl} f={f} n={i + 1} />)
              )}
            </View>
          ) : null}

          <Text style={s.sectionTitle} minPresenceAhead={60}>
            Searches run on {stamp}
          </Text>
          {report.searchesRun.length ? (
            report.searchesRun.map((q, i) => (
              <Text key={i} style={s.small}>
                • {pdfText(q, "(search in local script)")}
              </Text>
            ))
          ) : (
            <Text style={s.small}>No searches were recorded.</Text>
          )}
        </View>

        <Footer stamp={stamp} />
      </Page>

      {/* Explanatory page, like the sample's description of what each category covers. */}
      <Page size="A4" style={[s.page, { paddingTop: 40 }]} wrap>
        <View style={s.body}>
          {SCOPE_NOTES.map((n) => (
            <View key={n.heading} wrap={false}>
              <Text style={s.aboutHeading}>{n.heading}</Text>
              <Text style={s.aboutIntro}>{n.intro}</Text>
              {n.bullets.map((b) => (
                <View style={s.bulletRow} key={b}>
                  <Text style={s.bulletDot}>•</Text>
                  <Text style={s.bulletText}>{b}</Text>
                </View>
              ))}
            </View>
          ))}

          <Text style={s.aboutHeading}>Limitations and disclaimer</Text>
          {PERSON_LIMITATIONS.map((t, i) => (
            <View style={s.bulletRow} key={i}>
              <Text style={s.bulletDot}>{i + 1}.</Text>
              <Text style={s.bulletText}>{t}</Text>
            </View>
          ))}
          <Text style={[s.aboutIntro, { marginTop: 10 }]}>
            To check this report is genuine, enter the report ID, name, date of birth, match counts, sanctions result and
            verification code on the /verify page of the website that issued it.
          </Text>
        </View>
        <Footer stamp={stamp} />
      </Page>
    </Document>
  );
}
