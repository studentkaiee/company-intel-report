export function reportFilename(companyName: string): string {
  return `${companyName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company"}-report.pdf`;
}
