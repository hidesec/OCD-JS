import { ProbeRegistry, ProbeType } from "./probes";

export interface ProbeHttpResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export const handleProbeRequest = async (
  registry: ProbeRegistry,
  type: ProbeType | "all" = "all",
): Promise<ProbeHttpResult> => {
  if (type === "all") {
    const result = await registry.runAll();
    const status = Object.values(result).some(
      (entry) => entry.status === "fail",
    )
      ? 503
      : 200;
    return {
      status,
      body: JSON.stringify(result, null, 2),
      headers: { "content-type": "application/json" },
    };
  }
  const payload = await registry.run(type);
  return {
    status: payload.status === "ok" ? 200 : 503,
    body: JSON.stringify(payload, null, 2),
    headers: { "content-type": "application/json" },
  };
};
