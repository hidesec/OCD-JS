import { Inject, Injectable } from "@ocd-js/core";
import { APP_MESSAGE } from "./tokens";

@Injectable()
export class AppService {
  constructor(@Inject(APP_MESSAGE) private readonly message: string) {}

  getMessage() {
    return this.message;
  }

  listUsers() {
    return [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
  }
}
