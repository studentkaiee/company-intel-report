/** 4900 -> "S$49", 4950 -> "S$49.50". */
export function formatSgd(cents: number): string {
  const dollars = cents / 100;
  return `S$${Number.isInteger(dollars) ? dollars.toLocaleString("en-SG") : dollars.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
