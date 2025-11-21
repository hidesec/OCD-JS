export interface AppLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface RequestUser {
  id: string;
  roles: string[];
}

export interface RequestContext {
  id: string;
  user?: RequestUser;
}

export const APP_CONFIG = Symbol.for("CORE_APP_CONFIG");
export const LOGGER = Symbol.for("CORE_APP_LOGGER");
export const REQUEST_CONTEXT = Symbol.for("CORE_APP_REQUEST_CONTEXT");
