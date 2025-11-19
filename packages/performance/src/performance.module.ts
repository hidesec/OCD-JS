import { Module } from "@ocd-js/core";
import { CACHE_MANAGER } from "./cache/tokens";
import { CacheManager } from "./cache/cache-manager";
import { PIPELINE_MANAGER } from "./pipeline/tokens";
import { AsyncPipeline } from "./pipeline/pipeline-manager";

@Module({
  providers: [
    {
      token: CACHE_MANAGER,
      useValue: new CacheManager(),
    },
    {
      token: PIPELINE_MANAGER,
      useValue: new AsyncPipeline(),
    },
  ],
  exports: [CACHE_MANAGER, PIPELINE_MANAGER],
})
export class PerformanceModule {}
