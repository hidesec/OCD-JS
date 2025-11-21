import { Controller, Get } from "@ocd-js/core";
import { Authenticated, Policies, Roles } from "@ocd-js/auth";

@Controller({ basePath: "/auth", version: "v1" })
export class AuthFlowController {
  @Get("/profile")
  @Authenticated()
  profile() {
    return { message: "Profile visible" };
  }

  @Get("/admin")
  @Authenticated()
  @Roles("admin")
  adminPanel() {
    return { auditLog: ["user created", "role updated"] };
  }

  @Get("/pro")
  @Authenticated()
  @Policies("paid-subscription")
  proFeatures() {
    return { features: ["priority-support", "usage-analytics"] };
  }
}
