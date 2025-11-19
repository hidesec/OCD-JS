import { PolicyBundle } from "./policies";

export interface PolicyResult {
  bundle: string;
  passed: boolean;
  failures: string[];
}

export class PolicyService {
  async evaluate(bundle: PolicyBundle): Promise<PolicyResult> {
    const failures: string[] = [];
    for (const rule of bundle.rules) {
      const ok = await Promise.resolve(rule.check());
      if (!ok) {
        failures.push(rule.id);
      }
    }
    return {
      bundle: bundle.name,
      passed: failures.length === 0,
      failures,
    };
  }
}
