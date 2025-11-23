import {
  JsonDatabaseDriver,
  JsonDriverOptions,
  MemoryDatabaseDriver,
  SqliteDatabaseDriver,
  SqliteDriverOptions,
  PostgresDatabaseDriver,
  PostgresDriverOptions,
  MySqlDatabaseDriver,
  MySqlDriverOptions,
} from "./driver";
import { OrmDriver } from "./driver-registry";
import { OdbcCliDatabaseDriver, OdbcCliDriverOptions } from "./driver-odbc-cli";

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

@OrmDriver("postgres")
export class StandalonePostgresDriver extends PostgresDatabaseDriver {
  constructor(options: PostgresDriverOptions = {}) {
    super(options);
  }
}

@OrmDriver("mysql")
export class StandaloneMySqlDriver extends MySqlDatabaseDriver {
  constructor(options: MySqlDriverOptions = {}) {
    super(options);
  }
}

@OrmDriver("odbc-cli")
export class StandaloneOdbcCliDriver extends OdbcCliDatabaseDriver {
  constructor(options: OdbcCliDriverOptions) {
    super(options);
  }
}
