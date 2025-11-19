import { Module } from "@ocd-js/core";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { SessionStrategy } from "./strategies/session.strategy";
import { OAuthStrategy } from "./strategies/oauth.strategy";
import { AUTH_OPTIONS, POLICY_REGISTRY } from "./tokens";
import { AuthGuard } from "./guards/auth.guard";
import { RoleGuard } from "./guards/role.guard";
import { PolicyGuard } from "./guards/policy.guard";

@Module({
  providers: [
    AuthService,
    JwtStrategy,
    SessionStrategy,
    OAuthStrategy,
    AuthGuard,
    RoleGuard,
    PolicyGuard,
    {
      token: AUTH_OPTIONS,
      useValue: {
        jwtSecret: "changeme",
        jwtTtlSeconds: 3600,
        sessionTtlSeconds: 3600,
      },
    },
    {
      token: POLICY_REGISTRY,
      useValue: new Map(),
    },
  ],
  exports: [
    AuthService,
    JwtStrategy,
    SessionStrategy,
    OAuthStrategy,
    AuthGuard,
    RoleGuard,
    PolicyGuard,
  ],
})
export class AuthModule {}
