// src/app.module.ts
import {
  Module,
  MiddlewareConsumer,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { SessionMiddleware } from './auth/session.middleware';

import { SupabaseModule } from './supabase/module';
import { BooksModule } from './books/books.module';
import { FavoritesModule } from './favorites/favorites.module';
import { AccountModule } from './account/account.module';
import { SummariesModule } from './summaries/summaries.module';
import { AudioModule } from './audio/audio.module';
import { InsightsModule } from './insights/insights.module';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    SupabaseModule,
    BooksModule,
    FavoritesModule,
    AccountModule,
    SummariesModule,
    AudioModule,
    AuthModule,
    InsightsModule,
  ],
  controllers: [HealthController], // <— adiciona o endpoint /healthz
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SessionMiddleware)
      .exclude(
        // Fluxos públicos de autenticação
        { path: 'auth/id-token', method: RequestMethod.POST },
        { path: 'auth/email/(.*)', method: RequestMethod.ALL },
        { path: 'auth/email', method: RequestMethod.ALL },
        // health/docs públicos
        { path: 'health', method: RequestMethod.GET },
        { path: 'docs', method: RequestMethod.GET },
        { path: 'version', method: RequestMethod.GET },
      )
      .forRoutes('*'); // Protege todo o resto
  }
}
