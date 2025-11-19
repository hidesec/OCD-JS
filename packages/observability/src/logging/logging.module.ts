import { Module } from "@ocd-js/core";
import { StructuredLogger } from "./structured-logger";
import { LOGGING_OPTIONS, LOG_SINK, TRACE_BRIDGE, LOGGER } from "./tokens";
import { LogSink, LoggingOptions, TraceBridge } from "./interfaces";

const defaultSink: LogSink = (payload) => {
  console.log(payload);
};

const defaultTraceBridge: TraceBridge = {
  getActiveSpan: () => ({}),
};

@Module({
  providers: [
    {
      token: LOGGING_OPTIONS,
      useValue: {
        serviceName: "ocd-service",
        logLevel: "info",
      } satisfies LoggingOptions,
    },
    {
      token: LOG_SINK,
      useValue: defaultSink,
    },
    {
      token: TRACE_BRIDGE,
      useValue: defaultTraceBridge,
    },
    {
      token: LOGGER,
      scope: "singleton",
      useFactory: ({ container }) => {
        const options = container.resolve(LOGGING_OPTIONS) as LoggingOptions;
        const sink = container.resolve(LOG_SINK) as LogSink;
        const bridge = container.resolve(TRACE_BRIDGE) as TraceBridge;
        return new StructuredLogger(options, sink, bridge);
      },
      deps: [LOGGING_OPTIONS, LOG_SINK, TRACE_BRIDGE],
    },
  ],
  exports: [LOGGER, LOGGING_OPTIONS, LOG_SINK, TRACE_BRIDGE],
})
export class LoggingModule {}
