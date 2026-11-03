import type { PersonInputRaw } from "@/lib/person/schema";

export const validInput: PersonInputRaw = {
  fullName: "Tan Wei Ming",
  aliases: ["Tan Wei-Ming", "William Tan"],
  nativeName: "陈伟明",
  dob: "1980-05-17",
  nationality: "Singaporean",
  occupation: "Director",
  company: "Acme Trading",
  purpose: "director_onboarding",
  consent: true,
};

/** Every personal value in validInput, for "never appears in logs or metadata" checks. */
export const PERSONAL_VALUES = ["Tan Wei Ming", "Tan Wei-Ming", "William Tan", "陈伟明", "1980-05-17", "Singaporean", "Acme Trading", "Director"];
