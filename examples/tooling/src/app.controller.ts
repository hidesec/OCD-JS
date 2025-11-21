import { Controller, Get } from "@ocd-js/core";

@Controller({ basePath: "/health", version: "v1" })
export class AppController {
  @Get("/")
  status() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
