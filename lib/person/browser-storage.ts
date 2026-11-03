import type { PersonInputRaw, PersonReportPayload } from "./schema";

/**
 * The subject's details and the finished report live only in this tab's sessionStorage (no database, nothing
 * kept on the server). They are gone when the tab closes.
 */
const INPUTS_KEY = "person-check:inputs";
const reportKey = (sessionId: string) => `person-check:report:${sessionId}`;

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the flow still works in this page view.
  }
}

export const loadInputs = () => read<PersonInputRaw>(INPUTS_KEY);
export const saveInputs = (inputs: PersonInputRaw) => write(INPUTS_KEY, inputs);
export const loadReport = (sessionId: string) => read<PersonReportPayload>(reportKey(sessionId));
export const saveReport = (sessionId: string, payload: PersonReportPayload) => write(reportKey(sessionId), payload);
