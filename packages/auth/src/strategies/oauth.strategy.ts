import { Injectable } from "@ocd-js/core";
import { AuthenticatedUser, AuthStrategy } from "../interfaces";

@Injectable()
export class OAuthStrategy implements AuthStrategy {
  async authenticate(code: string): Promise<AuthenticatedUser | null> {
    if (!code) {
      return null;
    }
    return {
      id: code,
      roles: ["user"],
      metadata: { provider: "oauth" },
    };
  }
}
