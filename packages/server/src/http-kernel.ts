import http, { IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import {
  AppLike,
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "./types";

interface RouteEntry {
  method: string; // UPPERCASE
  pattern: string;
  regex: RegExp;
  keys: string[];
  handler: RequestHandler;
}

interface KernelOptions {
  jsonLimit?: string | number;
}

const parseLimit = (limit?: string | number): number => {
  if (!limit) return 1 * 1024 * 1024; // default 1mb
  if (typeof limit === "number") return limit;
  const m = /^(\d+(?:\.\d+)?)(kb|mb|b)?$/i.exec(limit.trim());
  if (!m) return 1 * 1024 * 1024;
  const value = parseFloat(m[1]);
  const unit = (m[2] ?? "b").toLowerCase();
  switch (unit) {
    case "mb":
      return Math.floor(value * 1024 * 1024);
    case "kb":
      return Math.floor(value * 1024);
    default:
      return Math.floor(value);
  }
};

const toPathRegex = (pattern: string): { regex: RegExp; keys: string[] } => {
  const keys: string[] = [];
  const escaped = pattern
    .replace(/\/+$/, "")
    .replace(/(^|\/)\*/g, "(?:$1.*)")
    .replace(/([.+?^=!:${}()|\[\]\\])/g, "\\$1")
    .replace(/:(\w+)/g, (_m, key) => {
      keys.push(key);
      return "([^/]+)";
    });
  const source = `^${escaped || "/"}$`;
  return { regex: new RegExp(source), keys };
};

const createResponse = (res: ServerResponse): Response => {
  let statusCode = 200;
  let sent = false;
  return {
    get headersSent() {
      return res.headersSent || sent;
    },
    status(code: number) {
      statusCode = code;
      res.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      if (!res.headersSent)
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      const data = Buffer.from(JSON.stringify(payload));
      if (!res.headersSent)
        res.setHeader("Content-Length", String(data.length));
      sent = true;
      res.end(data);
    },
    send(payload?: unknown) {
      if (payload === undefined) {
        sent = true;
        res.end();
        return;
      }
      if (typeof payload === "string" || Buffer.isBuffer(payload)) {
        if (!res.headersSent && typeof payload === "string")
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
        const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        if (!res.headersSent)
          res.setHeader("Content-Length", String(data.length));
        sent = true;
        res.end(data);
        return;
      }
      // fallback to json
      this.json(payload);
    },
    setHeader(name: string, value: string) {
      res.setHeader(name, value);
    },
    end(payload?: unknown) {
      sent = true;
      if (payload === undefined) res.end();
      else if (typeof payload === "string" || Buffer.isBuffer(payload))
        res.end(payload);
      else this.json(payload);
    },
  };
};

const createRequest = (req: IncomingMessage, body: any): Request => {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const query: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (query[key] === undefined) query[key] = value;
    else if (Array.isArray(query[key])) (query[key] as unknown[]).push(value);
    else query[key] = [query[key], value];
  }
  const incoming = req.headers["x-forwarded-for"] as string | undefined;
  const ip =
    (incoming ? incoming.split(",")[0] : req.socket.remoteAddress) ||
    "127.0.0.1";
  const get = (header: string): string | undefined => {
    const v = req.headers[header.toLowerCase()];
    if (Array.isArray(v)) return v[0];
    return v?.toString();
  };
  return {
    method: (req.method || "GET").toUpperCase(),
    url: req.url || "/",
    path,
    headers: req.headers,
    ip,
    socket: req.socket,
    params: {},
    query,
    body,
    get,
  };
};

export function createHttpKernel(options?: KernelOptions): AppLike {
  const routes: RouteEntry[] = [];
  const middlewares: RequestHandler[] = [];
  const errorMiddlewares: ErrorRequestHandler[] = [];
  const limit = parseLimit(options?.jsonLimit);

  const app = async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
    const res = createResponse(nodeRes);
    try {
      // run middlewares chain until a route handler
      const reqBody = await collectBody(nodeReq, limit);
      const req = createRequest(nodeReq, reqBody.body);

      if (reqBody.tooLarge) {
        res.status(413).json({ message: "Payload too large" });
        return;
      }
      if (reqBody.parseError) {
        res.status(400).json({
          message: "Invalid request body",
          details: String(reqBody.parseError),
        });
        return;
      }

      let idx = -1;
      const runNext: NextFunction = (err?: unknown) => {
        if (err) {
          runErrorChain(err, req, res);
          return;
        }
        const mw = middlewares[++idx];
        if (!mw) {
          // dispatch route
          const entry = matchRoute(req.method, req.path);
          if (!entry) {
            res.status(404).json({ message: "Not Found" });
            return;
          }
          // bind params
          const m = entry.regex.exec(req.path);
          const params: Record<string, string> = {};
          if (m) {
            entry.keys.forEach((k, i) => {
              params[k] = decodeURIComponent(m[i + 1]);
            });
          }
          req.params = params;
          try {
            const r = entry.handler(req, res, (e?: unknown) => {
              if (e) runErrorChain(e, req, res);
            });
            if (r && typeof (r as Promise<void>).then === "function") {
              (r as Promise<void>).catch((e) => runErrorChain(e, req, res));
            }
          } catch (e) {
            runErrorChain(e, req, res);
          }
          return;
        }
        try {
          const r = mw(req, res, runNext);
          if (r && typeof (r as Promise<void>).then === "function") {
            (r as Promise<void>).catch((e) => runErrorChain(e, req, res));
          }
        } catch (e) {
          runErrorChain(e, req, res);
        }
      };

      runNext();
    } catch (e) {
      createResponse(nodeRes)
        .status(500)
        .json({ message: "Internal server error" });
    }
  };

  const runErrorChain = (err: unknown, req: Request, res: Response) => {
    let i = -1;
    const next: NextFunction = (error?: unknown) => {
      const fn = errorMiddlewares[++i];
      if (!fn) {
        if (!res.headersSent) {
          res.status(500).json({ message: "Internal server error" });
        }
        return;
      }
      try {
        const r = fn(error ?? err, req, res, next);
        if (r && typeof (r as Promise<void>).then === "function") {
          (r as Promise<void>).catch((e) => next(e));
        }
      } catch (e) {
        next(e);
      }
    };
    next(err);
  };

  const register =
    (method: string) => (path: string, handler: RequestHandler) => {
      const { regex, keys } = toPathRegex(path);
      routes.push({
        method: method.toUpperCase(),
        pattern: path,
        regex,
        keys,
        handler,
      });
    };

  const matchRoute = (method: string, path: string) => {
    method = method.toUpperCase();
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(path);
      if (m) return r;
    }
    return undefined;
  };

  (app as unknown as AppLike).use = ((mw: any) => {
    if (typeof mw !== "function") return;
    if (mw.length >= 4) errorMiddlewares.push(mw as ErrorRequestHandler);
    else middlewares.push(mw as RequestHandler);
  }) as any;

  (app as unknown as AppLike).listen = ((...args: any[]) => {
    const server = http.createServer(app as any);
    return (server.listen as any)(...args);
  }) as any;

  (app as unknown as AppLike).get = register("GET");
  (app as unknown as AppLike).post = register("POST");
  (app as unknown as AppLike).put = register("PUT");
  (app as unknown as AppLike).patch = register("PATCH");
  (app as unknown as AppLike).delete = register("DELETE");
  (app as unknown as AppLike).head = register("HEAD");
  (app as unknown as AppLike).options = register("OPTIONS");

  return app as unknown as AppLike;
}

async function collectBody(
  req: IncomingMessage,
  limit: number,
): Promise<{ body: any; parseError?: unknown; tooLarge: boolean }> {
  const contentType = (req.headers["content-type"] || "").toString();
  const shouldParseJson = /application\/json/i.test(contentType);
  if (!shouldParseJson) {
    return { body: undefined, tooLarge: false };
  }
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve({ body: undefined, tooLarge: true });
        req.removeAllListeners("data");
        req.removeAllListeners("end");
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (size === 0) {
        resolve({ body: undefined, tooLarge: false });
        return;
      }
      const buffer = Buffer.concat(chunks);
      try {
        const parsed = JSON.parse(buffer.toString("utf8"));
        resolve({ body: parsed, tooLarge: false });
      } catch (e) {
        resolve({ body: undefined, parseError: e, tooLarge: false });
      }
    });
    req.on("error", (e) => {
      resolve({ body: undefined, parseError: e, tooLarge: false });
    });
  });
}
