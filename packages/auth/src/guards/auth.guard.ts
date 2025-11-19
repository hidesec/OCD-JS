import { Guard, GuardContext, Injectable } from "@ocd-js/core";
import { AuthService } from "../auth.service";

@Injectable()
export class AuthGuard implements Guard {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: GuardContext<{ headers?: Record<string, string>; user?: unknown }>): boolean {
    const authorization = context.request.headers?.authorization ?? "";
    const token = authorization.replace(/bearer /i, "");
    if (!token) {
      return false;
    }
    const user = this.auth.authenticateJwt(token);
    if (!user) {
      return false;
    }
    context.request.user = user;
    return true;
  }
}
