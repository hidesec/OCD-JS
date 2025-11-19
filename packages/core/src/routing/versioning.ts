export type ApiVersion = `v${number}` | string;

export const DEFAULT_VERSION: ApiVersion = "v1";

export const resolveVersion = (version?: ApiVersion, fallback: ApiVersion = DEFAULT_VERSION): ApiVersion =>
  version ?? fallback;

export const isSameVersion = (a: ApiVersion, b: ApiVersion) => a.toLowerCase() === b.toLowerCase();
