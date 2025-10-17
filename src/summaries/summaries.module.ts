// src/summaries/summaries.module.ts
import { Module } from '@nestjs/common';
import { SummariesController } from './summaries.controller';
import { SummariesService } from './summaries.service';
import { FavoritesModule } from '../favorites/favorites.module';
import { AudioModule } from '../audio/audio.module';

@Module({
  imports: [FavoritesModule, AudioModule],
  controllers: [SummariesController],
  providers: [SummariesService],
})
export class SummariesModule {}
