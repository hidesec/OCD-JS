import { createHmac } from "node:crypto";
import { Inject, Injectable } from "@ocd-js/core";
import { AuthOptions, AuthenticatedUser, AuthStrategy } from "../interfaces";
import { AUTH_OPTIONS } from "../tokens";

@Injectable()
export class JwtStrategy implements AuthStrategy {
  constructor(@Inject(AUTH_OPTIONS) private readonly options: AuthOptions) {}

  authenticate(token: string): AuthenticatedUser | null {
    if (!token) {
      return null;
    }
    const [header, payload, signature] = token.split(".");
    if (!signature || !this.verifySignature(`${header}.${payload}`, signature)) {
      return null;
    }
    const data = JSON.parse(Buffer.from(payload, "base64").toString());
    return data as AuthenticatedUser;
  }

  private verifySignature(input: string, signature: string): boolean {
    const hmac = createHmac("sha256", this.options.jwtSecret);
    hmac.update(input);
    const expected = hmac.digest("base64url");
    return expected === signature;
  }
}
