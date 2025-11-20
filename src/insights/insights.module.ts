import { Module } from '@nestjs/common';
import { AudioModule } from '../audio/audio.module';
import { AudioInsightsController } from './audio-insights.controller';
import { AudioInsightsService } from './audio-insights.service';

@Module({
  imports: [AudioModule],
  controllers: [AudioInsightsController],
  providers: [AudioInsightsService],
  exports: [AudioInsightsService],
})
export class InsightsModule {}
