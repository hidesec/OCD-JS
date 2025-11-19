export interface AuthOptions {
  jwtSecret: string;
  jwtTtlSeconds?: number;
  sessionTtlSeconds?: number;
}

export interface AuthenticatedUser {
  id: string | number;
  roles: string[];
  policies?: string[];
  metadata?: Record<string, unknown>;
}

export interface AuthStrategy {
  authenticate(
    payload: unknown,
  ): Promise<AuthenticatedUser | null> | AuthenticatedUser | null;
}

export interface PolicyHandler {
  name: string;
  evaluate(
    user: AuthenticatedUser,
    context?: Record<string, unknown>,
  ): boolean | Promise<boolean>;
}
