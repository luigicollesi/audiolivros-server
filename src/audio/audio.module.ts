// src/audio/audio.module.ts
import { Module } from '@nestjs/common';
import { ProtectedAssetsController } from './protected-assets.controller';
import { AssetsStatsController } from './assets-stats.controller';
import { ListeningProgressController } from './listening-progress.controller';
import { AssetAccessLoggerService } from './asset-access-logger.service';
import { ListeningProgressService } from './listening-progress.service';
import { FinishedBooksController } from './finished-books.controller';
import { FinishedBooksService } from './finished-books.service';

@Module({
  controllers: [
    ProtectedAssetsController,
    AssetsStatsController,
    ListeningProgressController,
    FinishedBooksController,
  ],
  providers: [
    AssetAccessLoggerService,
    ListeningProgressService,
    FinishedBooksService,
  ],
  exports: [AssetAccessLoggerService, ListeningProgressService, FinishedBooksService],
})
export class AudioModule {}
