import { Inject, Injectable } from "@ocd-js/core";
import {
  OWASP_TOP10_BUNDLE,
  POLICY_SERVICE,
  PolicyBundle,
  PolicyResult,
  PolicyService,
  ReleaseChecklist,
} from "@ocd-js/governance";

interface QualitySignal {
  codeCoverage: number;
  openCriticalBugs: number;
  securityFindings: number;
  docsUpdated: boolean;
}

export interface GovernanceReport {
  baseline: PolicyResult;
  releaseBundle: PolicyResult;
  checklist: Array<{ id: string; passed: boolean }>;
}

@Injectable()
export class ComplianceService {
  private readonly signals: QualitySignal = {
    codeCoverage: 88,
    openCriticalBugs: 1,
    securityFindings: 0,
    docsUpdated: false,
  };

  constructor(
    @Inject(POLICY_SERVICE) private readonly policyService: PolicyService,
  ) {}

  async runGovernanceSweep(): Promise<GovernanceReport> {
    const baseline = await this.policyService.evaluate(OWASP_TOP10_BUNDLE);
    const releaseBundle = await this.policyService.evaluate(
      this.buildReleaseBundle(),
    );
    const checklist = await this.buildChecklist().run();
    return { baseline, releaseBundle, checklist };
  }

  private buildReleaseBundle(): PolicyBundle {
    return {
      name: "release-gates",
      version: "1.0.0",
      rules: [
        {
          id: "coverage-90",
          description: "Code coverage must be >= 90%",
          check: () => this.signals.codeCoverage >= 90,
        },
        {
          id: "critical-bugs-zero",
          description: "No open critical bugs",
          check: async () => this.signals.openCriticalBugs === 0,
        },
        {
          id: "security-findings",
          description: "Security dashboard clear",
          check: () => this.signals.securityFindings === 0,
        },
      ],
    };
  }

  private buildChecklist(): ReleaseChecklist {
    return new ReleaseChecklist([
      {
        id: "smoke-tests",
        description: "Production smoke tests",
        verify: () => true,
      },
      {
        id: "rollback-plan",
        description: "Rollback plan reviewed",
        verify: () => true,
      },
      {
        id: "docs-updated",
        description: "Documentation refreshed",
        verify: () => this.signals.docsUpdated,
      },
    ]);
  }
}
