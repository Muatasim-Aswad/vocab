import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from "@nestjs/common";

import { Database, type DatabaseOptions } from "./database.js";
import { MutationReceipts } from "./mutation-receipts.js";

/** Owns the process's database connection; closes it after the HTTP server stops. */
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(Database) private readonly database: Database) {}

  static forRoot(options: Omit<DatabaseOptions, "create">): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [{ provide: Database, useFactory: () => new Database(options) }, MutationReceipts],
      exports: [Database, MutationReceipts],
    };
  }

  onApplicationShutdown(): void {
    this.database.close();
  }
}
