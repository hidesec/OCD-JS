import { spawn } from "node:child_process";
import type { DatabaseDriver, TableSchema, TransactionDriver } from "./driver";
import type { QueryPlan } from "./query/criteria";

export interface OdbcCliDriverOptions {
  dsn: string;
  user?: string;
  password?: string;
  command?: string; // default: isql
}

export class OdbcCliDatabaseDriver implements DatabaseDriver {
  private readonly dsn: string;
  private readonly user?: string;
  private readonly password?: string;
  private readonly command: string;
  private initialized = false;

  constructor(options: OdbcCliDriverOptions) {
    if (!options || !options.dsn) {
      throw new Error("OdbcCliDatabaseDriver requires a DSN");
    }
    this.dsn = options.dsn;
    this.user = options.user;
    this.password = options.password;
    this.command = options.command ?? "isql";
  }

  async init(): Promise<void> {
    this.initialized = true;
  }

  async ensureTable(_schema: TableSchema): Promise<void> {
    throw new Error("ensureTable is not supported by OdbcCliDatabaseDriver");
  }

  async readTable<T>(name: string): Promise<T[]> {
    this.ensureInit();
    const sql = `SELECT * FROM ${quoteIdent(name)}`;
    (this as any).__lastQueryInfo = { sql, params: [] };
    try {
      const { stdout } = await this.executeCli(sql);
      const rows = this.parseSelectOutput(stdout);
      return rows as T[];
    } catch {
      return [] as T[];
    }
  }

  async writeTable<T>(_name: string, _rows: T[]): Promise<void> {
    this.ensureInit();
    throw new Error("writeTable is not supported by OdbcCliDatabaseDriver");
  }

  async getSchema(_name: string): Promise<TableSchema | undefined> {
    this.ensureInit();
    return undefined;
  }

  async updateSchema(_schema: TableSchema): Promise<void> {
    this.ensureInit();
    throw new Error("updateSchema is not supported by OdbcCliDatabaseDriver");
  }

  async beginTransaction(): Promise<TransactionDriver> {
    throw new Error("Transactions are not supported by OdbcCliDatabaseDriver");
  }

  async dropTable(_name: string): Promise<void> {
    this.ensureInit();
    throw new Error("dropTable is not supported by OdbcCliDatabaseDriver");
  }

  supportsQuery(_plan: QueryPlan): boolean {
    return false;
  }

  private ensureInit() {
    if (!this.initialized) {
      throw new Error("OdbcCliDatabaseDriver not initialized");
    }
  }

  private buildArgs(): string[] {
    const args: string[] = [];
    if (this.user && this.password) {
      args.push(this.dsn, this.user, this.password);
    } else {
      args.push(this.dsn);
    }
    args.push("-b");
    return args;
  }

  private executeCli(
    sql: string,
    timeoutMs = 10000,
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const child: any = spawn(this.command, this.buildArgs());
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        reject(new Error("ODBC CLI timeout"));
      }, timeoutMs);
      child.stdout?.on?.("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on?.("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on?.("error", (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on?.("close", (code: number) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
      try {
        child.stdin?.write?.(sql + ";\n");
        child.stdin?.end?.();
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  private parseSelectOutput(text: string): Array<Record<string, unknown>> {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (!lines.length) return [];

    // Try pipe-delimited first: header and rows separated by '|', ignore border lines
    const pipeLines = lines.filter(
      (l) => l.includes("|") && !/^[+\-+]+$/.test(l.replace(/\s/g, "")),
    );
    if (pipeLines.length >= 2) {
      const split = (l: string) =>
        l
          .split("|")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      const header = split(pipeLines[0]);
      const data = pipeLines
        .slice(1)
        .map(split)
        .filter((cols) => cols.length === header.length);
      if (header.length && data.length) {
        return data.map((cols) =>
          Object.fromEntries(
            header.map((h, i) => [h, cols[i] === "NULL" ? null : cols[i]]),
          ),
        );
      }
    }

    // Tab-delimited fallback
    if (lines[0].includes("\t")) {
      const header = lines[0].split("\t").map((s) => s.trim());
      const data = lines
        .slice(1)
        .map((l) => l.split("\t").map((s) => s.trim()));
      return data.map((cols) =>
        Object.fromEntries(
          header.map((h, i) => [
            h,
            (cols[i] ?? "") === "NULL" ? null : cols[i],
          ]),
        ),
      );
    }

    // ASCII table fallback: remove separator lines and split by 2+ spaces
    const content = lines.filter((l) => !/^[-+]+$/.test(l));
    if (content.length >= 2) {
      const header = content[0].split(/\s{2,}/).map((s) => s.trim());
      const body = content
        .slice(1)
        .map((l) => l.split(/\s{2,}/).map((s) => s.trim()));
      if (header.length) {
        return body
          .filter((cols) => cols.length >= 1)
          .map((cols) =>
            Object.fromEntries(
              header.map((h, i) => [
                h,
                (cols[i] ?? "") === "NULL" ? null : cols[i],
              ]),
            ),
          );
      }
    }

    return [];
  }
}

const quoteIdent = (identifier: string): string => {
  const safe = String(identifier).replace(/"/g, '""');
  return `"${safe}"`;
};
