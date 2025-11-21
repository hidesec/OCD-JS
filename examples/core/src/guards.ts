import { Guard, GuardContext, Inject, Injectable } from "@ocd-js/core";
import { REQUEST_CONTEXT, RequestContext } from "./tokens";

@Injectable({ scope: "request", deps: [REQUEST_CONTEXT] })
export class AdminGuard implements Guard {
  constructor(
    @Inject(REQUEST_CONTEXT) private readonly context: RequestContext,
  ) {}

  canActivate(_ctx: GuardContext): boolean {
    return (this.context.user?.roles ?? []).includes("admin");
  }
}
