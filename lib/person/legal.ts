/** Fixed wording for the Individual Legal Screen (web page and PDF). To be reviewed by a Singapore lawyer. */

export const NOT_A_CRIMINAL_RECORD_CHECK =
  "This is not a criminal record check. Singapore criminal records are not public. The official document is a " +
  "Certificate of Clearance from the Singapore Police Force, which only the individual can apply for.";

export const PERSON_LIMITATIONS = [
  NOT_A_CRIMINAL_RECORD_CHECK,
  "Sources may describe allegations or charges that did not lead to a conviction, and may not show the final outcome.",
  "Singapore news media (for example The Straits Times, CNA and Lianhe Zaobao) are not searched. The screen covers " +
    "Singapore court and regulator websites first, then other public legal and regulatory sources.",
  "A person named in an official Singapore court record (judiciary.gov.sg or eLitigation) is shown as a strong match. " +
    "If few identifying details were given, check the record's details (age, address, occupation) before relying on it.",
  "Results are limited to information published on the public web at the time of the search. They may be incomplete, " +
    "and a finding may relate to a different person with the same name. Each finding shows the evidence for and against a match.",
  "Findings were compiled automatically by AI from public sources and may contain errors. Paywalled articles were read " +
    "only as far as their free preview allows. Bankruptcy records and paid or login-only government e-services were not searched.",
  "Sanctions screening compares names, aliases, year of birth and nationality against static copies of the lists, as of the dates shown. " +
    "A possible match is not a confirmed match: check the official list before acting.",
  "This report is not legal advice. Verify every finding with the original source before acting on it. " +
    "Our liability is limited to the fee paid for this report.",
  "The buyer confirmed they had the subject's consent to carry out this check and a legitimate purpose for it.",
];

/** What each check covers: the explanatory page at the end of the PDF. */
export const SCOPE_NOTES: { heading: string; intro: string; bullets: string[] }[] = [
  {
    heading: "Sanctions lists",
    intro: "The subject's name and aliases are compared with static copies of these lists, taken on the dates shown in the report:",
    bullets: [
      "UN Security Council Consolidated List, which Singapore gives effect to through MAS targeted financial sanctions regulations.",
      "US OFAC Specially Designated Nationals (SDN) List.",
      "Individuals designated in the First Schedule of Singapore's Terrorism (Suppression of Financing) Act, when that list is loaded.",
    ],
  },
  {
    heading: "Singapore court records",
    intro: "Published judgments and hearing lists on the Singapore Judiciary's websites (judiciary.gov.sg and eLitigation). A person named as a party, for example as the accused in \"Public Prosecutor v <name>\", is reported as a strong match.",
    bullets: [],
  },
  {
    heading: "Singapore regulatory actions",
    intro: "Enforcement and disciplinary records published by Singapore regulators, including:",
    bullets: [
      "Monetary Authority of Singapore enforcement actions, prohibition orders and the Investor Alert List.",
      "SGX RegCo, ACRA, CCCS, PDPC and Ministry of Manpower enforcement decisions.",
      "Singapore Police Force and Attorney-General's Chambers announcements.",
      "Law Society and other professional disciplinary decisions.",
    ],
  },
  {
    heading: "Other legal and regulatory sources",
    intro: "Court records, regulator notices and disqualification or enforcement registers published elsewhere on the public web. Singapore news media are not searched.",
    bullets: [],
  },
];

export const HISTORICAL_NOTE =
  "Historical (over 10 years old). Minor convictions may be legally spent under the Registration of Criminals Act.";
