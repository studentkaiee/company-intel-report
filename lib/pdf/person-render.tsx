import { renderToBuffer } from "@react-pdf/renderer";
import type { PersonReport } from "../person/schema";
import { PersonDocument } from "./person-document";

export async function renderPersonPdf(report: PersonReport): Promise<Buffer> {
  return renderToBuffer(<PersonDocument report={report} />);
}
