import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { SupabaseModule } from './supabase/module';
import { BooksModule } from './books/books.module';

import { TtsModule } from './tts/tts.module';

@Module({
  imports: [
    // serve tudo que estiver em public/covers/ na rota /covers
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public', 'covers'),
      serveRoot: '/covers',
      serveStaticOptions: {
        // opcional: cache agressivo em produção
        maxAge: '30d',
        etag: true,
        immutable: true,
      },
    }),
    SupabaseModule,
    BooksModule,
    TtsModule
  ],
})
export class AppModule {}