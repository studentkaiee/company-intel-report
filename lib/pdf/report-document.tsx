import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { COMPANY_HISTORICAL_NOTE, DISCLAIMER, LITIGATION_NOTE, REGISTRY_NOTE } from "../legal";
import { SECTION_KEYS, SECTION_TITLES, type Litigation, type Report } from "../report-schema";
import { FindingBox, Row, findingsText, groupFindings, pdfText, sanctionsText } from "./person-document";

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 60, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.45 },
  h1: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  meta: { fontSize: 9, color: "#555", marginBottom: 2 },
  disclaimer: { fontSize: 8, color: "#555", borderWidth: 0.5, borderColor: "#bbb", padding: 8, marginVertical: 12 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  confidence: { fontSize: 8, color: "#666", marginBottom: 4 },
  item: { flexDirection: "row", marginBottom: 4 },
  bullet: { width: 10 },
  itemText: { flex: 1 },
  cite: { fontSize: 8, color: "#2a5db0" },
  note: { fontStyle: "italic", color: "#666" },
  table: { borderWidth: 0.5, borderColor: "#ccc" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#eee" },
  cellLabel: { width: 140, padding: 4, fontFamily: "Helvetica-Bold" },
  cellValue: { flex: 1, padding: 4 },
  source: { fontSize: 8, marginBottom: 3 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 7, color: "#888", textAlign: "center" },
});

/** Litigation, court records and sanctions: the same result table and record boxes as the Individual Legal Screen. */
function LitigationSection({ litigation }: { litigation: Litigation }) {
  const { court, regulatory, alerts, other, ordered } = groupFindings(litigation.findings);
  const list = (code: string) => sanctionsText(litigation.sanctions.lists.find((l) => l.list === code));
  const rows: [string, { text: string; hit: boolean }][] = [
    ["Singapore Court Records", findingsText(court)],
    ["Singapore Regulatory Actions", findingsText(regulatory)],
    ["MAS Investor Alert List", findingsText(alerts)],
    ["Other Legal Sources", findingsText(other)],
    ["UN Sanctions (entities)", list("UN")],
    ["OFAC SDN (entities)", list("OFAC")],
    ["Singapore TSOFA (entities)", list("TSOFA")],
  ];
  return (
    <View>
      <Text style={s.h2} minPresenceAhead={120}>
        Litigation and court records
      </Text>
      <View style={lit.table}>
        {rows.map(([label, r]) => (
          <Row key={label} label={label} value={r.text} hit={r.hit} />
        ))}
      </View>
      {litigation.overallNote ? <Text style={[s.confidence, { marginTop: 6 }]}>{pdfText(litigation.overallNote, "")}</Text> : null}
      <Text style={[s.confidence, { marginTop: 4 }]}>{LITIGATION_NOTE}</Text>
      {ordered.map((f, i) => (
        <FindingBox key={f.sourceUrl} f={f} n={i + 1} historicalNote={COMPANY_HISTORICAL_NOTE} />
      ))}
      {litigation.unlikelyMatches.length ? (
        <View>
          <Text style={[s.h2, { fontSize: 11 }]} minPresenceAhead={80}>
            Unlikely matches, shown for transparency
          </Text>
          {litigation.unlikelyMatches.map((f, i) => (
            <FindingBox key={f.sourceUrl} f={f} n={i + 1} historicalNote={COMPANY_HISTORICAL_NOTE} />
          ))}
        </View>
      ) : null}
      {litigation.searchesRun.length ? (
        <Text style={[s.source, { marginTop: 8 }]}>Searched: {litigation.searchesRun.map((q) => pdfText(q, "(local script)")).join(" · ")}</Text>
      ) : null}
    </View>
  );
}

const lit = StyleSheet.create({
  table: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: "#000" },
});

export function ReportDocument({ report }: { report: Report }) {
  const generated = new Date(report.generatedAt).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
  const reg = report.registry;
  return (
    <Document title={`${report.companyName} — company intelligence report`} author="Company Intelligence Report">
      <Page size="A4" style={s.page} wrap>
        <Text style={s.h1}>{report.companyName}</Text>
        {report.uen ? <Text style={s.meta}>UEN {report.uen}</Text> : null}
        {report.website ? <Text style={s.meta}>{report.website}</Text> : null}
        <Text style={s.meta}>Generated {generated}</Text>
        <Text style={s.disclaimer}>{DISCLAIMER}</Text>

        <Text style={s.h2}>Registry facts</Text>
        {reg ? (
          <View>
            <View style={s.table}>
              {[
                ["Registered name", reg.entityName],
                ["UEN", reg.uen],
                ["Status", reg.status],
                ["Entity type", reg.entityType],
                ["Registration date", reg.registrationDate],
                ["Registered address", reg.address],
              ].map(([label, value]) => (
                <View style={s.row} key={label}>
                  <Text style={s.cellLabel}>{label}</Text>
                  <Text style={s.cellValue}>{value || "—"}</Text>
                </View>
              ))}
            </View>
            <Text style={[s.confidence, { marginTop: 4 }]}>{REGISTRY_NOTE}</Text>
          </View>
        ) : (
          <Text style={s.note}>Not matched in the Singapore ACRA registry.</Text>
        )}

        {report.litigation ? <LitigationSection litigation={report.litigation} /> : null}

        {SECTION_KEYS.map((key) => {
          const section = report.sections[key];
          return (
            <View key={key} wrap>
              <Text style={s.h2} minPresenceAhead={40}>
                {SECTION_TITLES[key]}
              </Text>
              <Text style={s.confidence}>Confidence: {section.confidence}</Text>
              {section.items.length === 0 ? (
                <Text style={s.note}>{section.note}</Text>
              ) : (
                section.items.map((item, i) => (
                  <View style={s.item} key={i} wrap={false}>
                    <Text style={s.bullet}>•</Text>
                    <Text style={s.itemText}>
                      {item.text} <Text style={s.cite}>[{item.sourceIds.join(", ")}]</Text>
                    </Text>
                  </View>
                ))
              )}
            </View>
          );
        })}

        <Text style={s.h2} break={report.sources.length > 15}>
          Sources
        </Text>
        {report.sources.map((src) => (
          <Text style={s.source} key={src.id}>
            [{src.id}] {src.title} — <Link src={src.url}>{src.url}</Link> (retrieved {src.retrievedAt})
          </Text>
        ))}

        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) => `AI-compiled from public sources. Not advice. Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  );
}
