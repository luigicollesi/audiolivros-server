import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { SupabaseModule } from './supabase/module';
import { BooksModule } from './books/books.module';
import { SummariesModule } from './summaries/summaries.module';

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

    // /audio (com Range por padrão)
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public', 'audios'),
      serveRoot: '/audios',
      serveStaticOptions: {
        index: false,
        maxAge: '365d',
        etag: true,
        immutable: true,
        setHeaders: (res, filePath) => {
          // opcional: afirmar o suporte a Range
          res.setHeader('Accept-Ranges', 'bytes');

          // MIME (geralmente o express já acerta, mas garantimos)
          if (filePath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
          else if (filePath.endsWith('.ogg')) res.setHeader('Content-Type', 'audio/ogg');
          else if (filePath.endsWith('.aac')) res.setHeader('Content-Type', 'audio/aac');
        },
      },
    }),

    SupabaseModule,
    BooksModule,
    SummariesModule,
  ],
})
export class AppModule {}