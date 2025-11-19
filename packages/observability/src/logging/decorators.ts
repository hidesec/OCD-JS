import { Inject } from "@ocd-js/core";
import { LOGGER } from "./tokens";

export const Logger = (): ParameterDecorator => Inject(LOGGER);
