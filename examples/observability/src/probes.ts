import { Injectable } from "@ocd-js/core";
import {
  HealthCheck,
  LivenessCheck,
  ReadinessCheck,
  ProbeResult,
} from "@ocd-js/observability";

@Injectable()
export class ObservabilityProbeSuite {
  private databaseConnected = true;
  private lastDeploymentTs = Date.now();

  @HealthCheck("database")
  async databaseHealth(): Promise<ProbeResult> {
    return {
      name: "database",
      status: this.databaseConnected ? "up" : "down",
      details: this.databaseConnected ? "connected" : "disconnected",
    };
  }

  @ReadinessCheck("deploy-status")
  readiness(): ProbeResult {
    const seconds = Math.floor((Date.now() - this.lastDeploymentTs) / 1000);
    return {
      name: "deploy-status",
      status: seconds > 30 ? "up" : "down",
      details: seconds > 30 ? "stable" : "warming",
    };
  }

  @LivenessCheck("event-loop")
  heartbeat(): ProbeResult {
    return { name: "event-loop", status: "up" };
  }

  simulateDatabaseOutage() {
    this.databaseConnected = false;
  }

  simulateStabilizedDeployment() {
    this.lastDeploymentTs -= 60_000;
  }
}
