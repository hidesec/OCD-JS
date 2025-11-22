import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import {
  type ApplicationContext,
  type CompiledRoute,
  type RouteEnhancer,
  type Guard,
  type GuardContext,
  type ValidationContext,
  type Container,
  ValidationException,
  applyValidationEnhancers,
  createApplicationContext,
} from "@ocd-js/core";
import {
  applySecurityMiddlewares,
  resolveSecurityTokens,
  type SecurityMiddleware,
  type SecurityContext,
} from "@ocd-js/security";
import { HTTP_REQUEST, HTTP_RESPONSE, type HttpRequest } from "./tokens";
import {
  type ExpressAdapterOptions,
  type HttpContext,
  type VersioningStrategy,
} from "./types";

type GuardEnhancer = Extract<RouteEnhancer, { kind: "guard" }>;

interface AdapterConfig extends ExpressAdapterOptions {
  globalPrefix: string;
  jsonLimit: string | number;
  versioning: VersioningStrategy;
  middlewares: RequestHandler[];
  onError: (error: unknown, req: Request, res: Response) => void;
}

export class ExpressHttpAdapter {
  private readonly context: ApplicationContext;
  private readonly app: Express;
  private readonly options: AdapterConfig;
  private serverStarted = false;

  constructor(options: ExpressAdapterOptions) {
    if (!options?.module) {
      throw new Error("ExpressHttpAdapter requires a root module");
    }
    this.context = createApplicationContext(options.module);
    this.app = options.app ?? express();
    this.options = {
      ...options,
      globalPrefix: options.globalPrefix ?? "",
      jsonLimit: options.jsonLimit ?? "1mb",
      versioning: options.versioning ?? { strategy: "none" },
      middlewares: options.middlewares ?? [],
      onError:
        options.onError ??
        ((error, _req, res) => {
          if (res.headersSent) {
            return;
          }
          console.error("Express adapter error", error);
          res.status(500).json({ message: "Internal server error" });
        }),
    };
    this.configure();
    this.setupServerListener();
  }

  private setupServerListener(): void {
    const originalListen = this.app.listen.bind(this.app);
    this.app.listen = ((...args: any[]) => {
      const server = originalListen(...args);

      if (!this.serverStarted) {
        this.serverStarted = true;

        server.once("listening", () => {
          const address = server.address();
          let port = 3000;

          if (address && typeof address === "object") {
            port = address.port;
          }

          const timestamp = new Date().toLocaleString("en-US", {
            month: "2-digit",
            day: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          });

          console.log(
            `\x1b[32m[OCD-JS] ${timestamp}\x1b[0m Application successfully started`,
          );
          console.log(
            `\x1b[32m[OCD-JS] ${timestamp}\x1b[0m Listening on port \x1b[36m${port}\x1b[0m`,
          );
          this.logRoutes();
        });
      }

      return server;
    }) as any;
  }

  getApp(): Express {
    return this.app;
  }

  getRoutes(): CompiledRoute[] {
    return this.context.routes;
  }

  getMappedRoutes(): Array<{ method: string; path: string }> {
    return this.context.routes.map((route) => ({
      method: route.method,
      path: this.composePath(route),
    }));
  }

  logRoutes(): void {
    const colors = {
      GET: "\x1b[32m",
      POST: "\x1b[33m",
      PUT: "\x1b[36m",
      DELETE: "\x1b[31m",
      PATCH: "\x1b[35m",
      reset: "\x1b[0m",
    };

    const timestamp = new Date().toLocaleString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    this.getMappedRoutes().forEach(({ method, path }) => {
      const color = colors[method as keyof typeof colors] || colors.reset;
      const paddedMethod = method.padEnd(7);
      console.log(
        `\x1b[32m[OCD-JS] ${timestamp}\x1b[0m ${color}${paddedMethod}${colors.reset} ${path}`,
      );
    });
  }

  private configure(): void {
    this.app.use(express.json({ limit: this.options.jsonLimit }));
    this.options.middlewares.forEach((middleware) => this.app.use(middleware));
    this.registerRoutes();
    this.app.use(
      (error: unknown, req: Request, res: Response, _next: NextFunction) => {
        if (error instanceof ValidationException) {
          res
            .status(400)
            .json({ message: error.message, errors: error.errors });
          return;
        }
        if (error instanceof HttpError) {
          res
            .status(error.status)
            .json({ message: error.message, details: error.details });
          return;
        }
        this.options.onError(error, req, res);
      },
    );
  }

  private registerRoutes(): void {
    this.context.routes.forEach((route) => {
      const method = route.method.toLowerCase();
      const handler: RequestHandler = (req, res, next) => {
        this.handleRequest(route, req, res).catch(next);
      };
      const fullPath = this.composePath(route);
      const registrar = (this.app as unknown as Record<string, unknown>)[
        method
      ] as ((path: string, handler: RequestHandler) => void) | undefined;
      if (!registrar) {
        throw new Error(`Express does not support HTTP method ${route.method}`);
      }
      registrar.call(this.app, fullPath, handler);
    });
  }

  private composePath(route: CompiledRoute): string {
    const segments = [
      this.options.globalPrefix,
      this.resolveVersionSegment(route.version),
      route.path,
    ];
    const path = segments
      .filter((segment) => segment && segment !== "/")
      .join("")
      .replace(/\/+/g, "/");
    return path || "/";
  }

  private resolveVersionSegment(version: string): string {
    const strategy = this.options.versioning.strategy;
    if (strategy === "path") {
      const prefix = this.options.versioning.prefix ?? "";
      return prefix ? `/${prefix}${version}` : `/${version}`;
    }
    return "";
  }

  private async handleRequest(
    route: CompiledRoute,
    req: Request,
    res: Response,
  ): Promise<void> {
    const requestScope = this.context.beginRequest([
      { token: HTTP_REQUEST, useValue: req, scope: "request" },
      { token: HTTP_RESPONSE, useValue: res, scope: "request" },
    ]);
    const { container } = requestScope;

    const enhancers = route.enhancers ?? [];
    const validated: ValidationContext = applyValidationEnhancers(enhancers, {
      body: req.body,
      query: req.query as Record<string, unknown>,
      params: req.params,
    });

    await this.runGuards(route, enhancers, req as HttpRequest, container);
    const securityBody = await this.runSecurityMiddlewares(
      route,
      enhancers,
      req,
      container,
      validated.body,
    );
    if (securityBody !== undefined) {
      validated.body = securityBody;
    }

    const result = await this.invokeController(
      route,
      container,
      req,
      res,
      validated,
    );
    if (res.headersSent) {
      return;
    }
    if (result === undefined) {
      res.status(204).end();
      return;
    }
    res.json(result);
  }

  private async runGuards(
    _route: CompiledRoute,
    enhancers: RouteEnhancer[],
    req: HttpRequest,
    container: Container,
  ): Promise<void> {
    const guardEnhancers = enhancers.filter(
      (enhancer): enhancer is GuardEnhancer => enhancer.kind === "guard",
    );
    if (!guardEnhancers.length) {
      return;
    }
    const guardContext: GuardContext<HttpRequest> = { request: req, container };
    for (const enhancer of [...guardEnhancers].reverse()) {
      const guard = container.resolve(enhancer.guardToken) as Guard;
      const allowed = await guard.canActivate(guardContext, enhancer.options);
      if (!allowed) {
        throw new HttpError(403, `${guard.constructor.name} blocked request`);
      }
    }
  }

  private async runSecurityMiddlewares(
    _route: CompiledRoute,
    enhancers: RouteEnhancer[],
    req: Request,
    container: Container,
    body: unknown,
  ): Promise<unknown> {
    const tokens = resolveSecurityTokens(enhancers);
    if (!tokens.length) {
      return undefined;
    }
    const middlewares = tokens.map(
      (token) => container.resolve(token) as SecurityMiddleware,
    );
    const securityContext: SecurityContext = {
      requestId:
        (req.headers["x-request-id"] as string | undefined) ??
        `req-${Date.now().toString(36)}`,
      method: req.method,
      path: req.path,
      headers: this.normalizeHeaders(req.headers),
      body,
      ip: req.ip,
      timestamp: Date.now(),
      metadata: {
        cookies:
          (req as Request & { cookies?: Record<string, string> }).cookies ?? {},
      },
    };
    const result = await applySecurityMiddlewares(
      middlewares,
      securityContext,
      async () => undefined,
    );
    if (result.blocked) {
      throw new HttpError(
        403,
        result.reason ?? "Request blocked by security middleware",
      );
    }
    return securityContext.body;
  }

  private normalizeHeaders(
    headers: Request["headers"],
  ): Record<string, string> {
    return Object.entries(headers).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        if (Array.isArray(value)) {
          acc[key] = value.join(",");
        } else if (typeof value === "string") {
          acc[key] = value;
        }
        return acc;
      },
      {},
    );
  }

  private async invokeController(
    route: CompiledRoute,
    container: Container,
    req: Request,
    res: Response,
    validated: ValidationContext,
  ): Promise<unknown> {
    const controller = container.resolve(route.controller) as Record<
      string | symbol,
      any
    >;
    const handler = controller[route.handlerKey];
    if (typeof handler !== "function") {
      throw new Error(
        `Handler ${String(route.handlerKey)} on ${route.controller.name} is not callable`,
      );
    }
    const httpContext: HttpContext = {
      request: req,
      response: res,
      container,
      params: req.params,
      query: validated.query ?? (req.query as Record<string, unknown>),
      body: validated.body ?? req.body,
    };
    const payload = this.resolvePayload(route.method, validated);
    const result = handler.call(controller, payload, httpContext);
    return Promise.resolve(result);
  }

  private resolvePayload(
    method: string,
    validated: ValidationContext,
  ): unknown {
    if (method === "GET" || method === "HEAD") {
      return validated.query ?? {};
    }
    if (method === "DELETE") {
      return {
        params: validated.params ?? {},
        query: validated.query ?? {},
      };
    }
    return validated.body;
  }
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
