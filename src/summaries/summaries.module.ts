// src/summaries/summaries.module.ts
import { Module } from '@nestjs/common';
import { SummariesService } from './summaries.service';
import { SummariesController } from './summaries.controller';
import { FavoritesModule } from '../favorites/favorites.module';

@Module({
  imports: [FavoritesModule],
  controllers: [SummariesController],
  providers: [SummariesService],
})
export class SummariesModule {}
