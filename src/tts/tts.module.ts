import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';
import { SpeechifyProvider } from './providers/speechify.provider';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [TtsController],
  providers: [
    TtsService,
    {
      provide: 'TTS_PROVIDER',
      useFactory: () => {
        const key = process.env.SPEECHIFY_API_KEY || '';
        const fmt = process.env.SPEECHIFY_FORMAT || 'audio/mpeg';
        const lang = process.env.SPEECHIFY_LANGUAGE || undefined;
        console.log('[TTS_PROVIDER] key presente?', !!key, 'format:', fmt, 'lang:', lang);
        return new SpeechifyProvider(key, fmt);
      },
    },
  ],
})
export class TtsModule {}
