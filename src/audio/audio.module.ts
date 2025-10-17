// src/audio/audio.module.ts
import { Module } from '@nestjs/common';
import { ProtectedAssetsController } from './protected-assets.controller';
import { AssetsStatsController } from './assets-stats.controller';
import { ListeningProgressController } from './listening-progress.controller';
import { AssetAccessLoggerService } from './asset-access-logger.service';
import { ListeningProgressService } from './listening-progress.service';

@Module({
  controllers: [
    ProtectedAssetsController,
    AssetsStatsController,
    ListeningProgressController,
  ],
  providers: [AssetAccessLoggerService, ListeningProgressService],
  exports: [AssetAccessLoggerService, ListeningProgressService],
})
export class AudioModule {}
