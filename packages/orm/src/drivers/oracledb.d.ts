declare module "oracledb" {
  export interface PoolAttributes {
    user?: string;
    password?: string;
    connectString?: string;
    poolMin?: number;
    poolMax?: number;
    poolIncrement?: number;
  }

  export interface Connection {
    execute(
      sql: string,
      binds?: any[],
      options?: any,
    ): Promise<{ rows?: any[] }>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    close(): Promise<void>;
  }

  export interface Pool {
    getConnection(): Promise<Connection>;
  }

  export function createPool(attrs: PoolAttributes): Promise<Pool>;

  export const OUT_FORMAT_OBJECT: number;
}
