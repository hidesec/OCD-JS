import { Inject, Injectable } from "@ocd-js/core";
import type { AppConfig } from "../config/app-config";
import { APP_CONFIG } from "./user.module";

export interface UserRecord {
  id: number;
  name: string;
}

@Injectable()
export class UserService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  findAll(): UserRecord[] {
    return [
      {
        id: 1,
        name: `Env: ${this.config.NODE_ENV}`,
      },
    ];
  }
}
