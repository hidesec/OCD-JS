import {
  JsonDatabaseDriver,
  JsonDriverOptions,
  MemoryDatabaseDriver,
  SqliteDatabaseDriver,
  SqliteDriverOptions,
} from "./driver";
import { OrmDriver } from "./driver-registry";

@OrmDriver("memory")
export class StandaloneMemoryDriver extends MemoryDatabaseDriver {}

@OrmDriver("json")
export class StandaloneJsonDriver extends JsonDatabaseDriver {
  constructor(options: JsonDriverOptions = {}) {
    super(options);
  }
}

@OrmDriver("sqlite")
export class StandaloneSqliteDriver extends SqliteDatabaseDriver {
  constructor(options: SqliteDriverOptions = {}) {
    super(options);
  }
}
