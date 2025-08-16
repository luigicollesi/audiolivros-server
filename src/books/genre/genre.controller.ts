// src/genre/genre.controller.ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { GenreService } from './genre.service';
import { GetGenreQueryDto } from './dto/get-genre-query.dto';

@Controller('books')
export class GenreController {
  constructor(private readonly service: GenreService) {}

  // GET /books/genre?genre=Filosofia&languageId=en-US&start=0&end=9
  @Get('genre')
  getByGenre(@Query() q: GetGenreQueryDto) {
    if (q.end < q.start) {
      throw new BadRequestException('Parâmetros inválidos: use start>=0 e end>=start.');
    }
    return this.service.getByGenre(q.start, q.end, q.languageId, q.genre);
    //                      ^start  ^end  ^lang        ^genre
  }
}
