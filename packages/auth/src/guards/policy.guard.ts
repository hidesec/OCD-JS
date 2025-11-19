import { Guard, GuardContext, Inject, Injectable } from "@ocd-js/core";
import { AuthService } from "../auth.service";
import { POLICY_REGISTRY } from "../tokens";
import { AuthenticatedUser, PolicyHandler } from "../interfaces";

@Injectable()
export class PolicyGuard implements Guard {
  constructor(
    private readonly auth: AuthService,
    @Inject(POLICY_REGISTRY) private readonly registry: Map<string, PolicyHandler>
  ) {}

  async canActivate(
    context: GuardContext<{ user?: AuthenticatedUser; headers?: Record<string, string> }>,
    options?: Record<string, unknown>
  ): Promise<boolean> {
    const policies = (options?.policies as string[]) ?? [];
    const user = context.request.user;
    if (!user) {
      const authorization = context.request.headers?.authorization ?? "";
      const token = authorization.replace(/bearer /i, "");
      if (!token) {
        return false;
      }
      const resolved = this.auth.authenticateJwt(token);
      if (!resolved) {
        return false;
      }
      context.request.user = resolved;
      return this.evaluate(resolved, policies);
    }
    return this.evaluate(user, policies);
  }

  private async evaluate(user: AuthenticatedUser, policies: string[]): Promise<boolean> {
    for (const policy of policies) {
      const handler = this.registry.get(policy);
      if (!handler) {
        return false;
      }
      const result = await handler.evaluate(user);
      if (!result) {
        return false;
      }
    }
    return true;
  }
}
