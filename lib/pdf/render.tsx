import { renderToBuffer } from "@react-pdf/renderer";
import type { Report } from "../report-schema";
import { ReportDocument } from "./report-document";

export async function renderReportPdf(report: Report): Promise<Buffer> {
  return renderToBuffer(<ReportDocument report={report} />);
}
