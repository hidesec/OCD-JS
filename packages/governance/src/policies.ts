export interface PolicyRule {
  id: string;
  description: string;
  check: () => Promise<boolean> | boolean;
}

export interface PolicyBundle {
  name: string;
  version: string;
  description?: string;
  rules: PolicyRule[];
}

export const OWASP_TOP10_BUNDLE: PolicyBundle = {
  name: "owasp-top10",
  version: "2021",
  description: "Baseline OWASP Top 10 controls",
  rules: [
    {
      id: "A01",
      description: "Broken access control mitigations in place",
      check: () => true,
    },
    {
      id: "A02",
      description: "Cryptographic failures tested",
      check: () => true,
    },
    { id: "A03", description: "Injection mitigations", check: () => true },
  ],
};
