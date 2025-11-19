import { Guard, GuardContext, Injectable } from "@ocd-js/core";
import { AuthenticatedUser } from "../interfaces";

@Injectable()
export class RoleGuard implements Guard {
  canActivate(
    context: GuardContext<{ user?: AuthenticatedUser }>,
    options?: Record<string, unknown>,
  ): boolean {
    const user = context.request.user;
    if (!user) {
      return false;
    }
    const roles = (options?.roles as string[]) ?? [];
    if (!roles.length) {
      return true;
    }
    return roles.some((role) => user.roles.includes(role));
  }
}
