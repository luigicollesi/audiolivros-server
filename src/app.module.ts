// src/app.module.ts
import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { SessionMiddleware } from './auth/session.middleware';

import { SupabaseModule } from './supabase/module';
import { BooksModule } from './books/books.module';
import { SummariesModule } from './summaries/summaries.module';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // /covers
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public', 'covers'),
      serveRoot: '/covers',
      serveStaticOptions: {
        maxAge: '30d',
        etag: true,
        immutable: true,
      },
    }),

    // /audios (com Range por padrão)
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public', 'audios'),
      serveRoot: '/audios',
      serveStaticOptions: {
        index: false,
        maxAge: '365d',
        etag: true,
        immutable: true,
        setHeaders: (res, filePath) => {
          res.setHeader('Accept-Ranges', 'bytes');
          if (filePath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
          else if (filePath.endsWith('.ogg')) res.setHeader('Content-Type', 'audio/ogg');
          else if (filePath.endsWith('.aac')) res.setHeader('Content-Type', 'audio/aac');
        },
      },
    }),

    SupabaseModule,
    BooksModule,
    SummariesModule,
    AuthModule
  ],
  controllers: [HealthController], // <— adiciona o endpoint /healthz
})

export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SessionMiddleware)
      .exclude(
        // Liberadas:
        { path: 'auth/google/id-token', method: RequestMethod.POST },
        { path: 'health', method: RequestMethod.GET },
        // (opcional) docs/versões públicas
        { path: 'docs', method: RequestMethod.GET },
        { path: 'version', method: RequestMethod.GET },
        // assets públicos
        { path: 'covers', method: RequestMethod.ALL },
        { path: 'covers/*path', method: RequestMethod.ALL },
      )
      .forRoutes('*'); // Protege todo o resto
  }
}
