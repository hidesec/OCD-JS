import { Inject, Injectable } from "@ocd-js/core";
import type { AppConfig } from "../config/app-config";
import { APP_CONFIG } from "./user.module";
import { CreateUserInput } from "./dto/create-user.dto";

export interface UserRecord {
  id: number;
  name: string;
}

@Injectable()
export class UserService {
  private readonly users: UserRecord[] = [
    { id: 1, name: `Env: ${this.config.NODE_ENV}` },
  ];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  findAll(): UserRecord[] {
    return this.users;
  }

  create(input: CreateUserInput): UserRecord {
    const record: UserRecord = {
      id: this.users.length + 1,
      name: input.name,
    };
    this.users.push(record);
    return record;
  }
}
