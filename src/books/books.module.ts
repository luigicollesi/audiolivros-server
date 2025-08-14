import { Module } from '@nestjs/common';
import { BooksService } from './books.service';
import { BooksController } from './books.controller';
import { GenreService } from './genre/genre.service';
import { GenreController } from './genre/genre.controller';

@Module({
  controllers: [BooksController, GenreController],
  providers:   [BooksService, GenreService],
})
export class BooksModule {}
