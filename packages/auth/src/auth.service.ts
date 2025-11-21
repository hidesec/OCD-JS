import { Inject, Injectable } from "@ocd-js/core";
import { AuthOptions, AuthenticatedUser, PolicyHandler } from "./interfaces";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { SessionStrategy } from "./strategies/session.strategy";
import { OAuthStrategy } from "./strategies/oauth.strategy";
import { AUTH_OPTIONS, POLICY_REGISTRY } from "./tokens";

@Injectable({
  deps: [
    AUTH_OPTIONS,
    JwtStrategy,
    SessionStrategy,
    OAuthStrategy,
    POLICY_REGISTRY,
  ],
})
export class AuthService {
  constructor(
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
    private readonly jwt: JwtStrategy,
    private readonly sessions: SessionStrategy,
    private readonly oauth: OAuthStrategy,
    @Inject(POLICY_REGISTRY)
    private readonly registry: Map<string, PolicyHandler>,
  ) {}

  authenticateJwt(token: string): AuthenticatedUser | null {
    return this.jwt.authenticate(token);
  }

  authenticateSession(id: string): AuthenticatedUser | null {
    return this.sessions.authenticate(id);
  }

  async authenticateOAuth(code: string): Promise<AuthenticatedUser | null> {
    return this.oauth.authenticate(code);
  }

  createSession(user: AuthenticatedUser): string {
    return this.sessions.createSession(
      user,
      this.options.sessionTtlSeconds ?? 3600,
    );
  }

  registerPolicy(handler: PolicyHandler): void {
    this.registry.set(handler.name, handler);
  }

  async assertPolicies(
    user: AuthenticatedUser,
    policies: string[],
    context?: Record<string, unknown>,
  ): Promise<boolean> {
    for (const policyName of policies) {
      const handler = this.registry.get(policyName);
      if (!handler) {
        throw new Error(`Unknown policy ${policyName}`);
      }
      const result = await handler.evaluate(user, context);
      if (!result) {
        return false;
      }
    }
    return true;
  }
}
