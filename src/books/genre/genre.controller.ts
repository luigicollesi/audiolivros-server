// src/genre/genre.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { GenreService } from './genre.service';
import { GetGenreQueryDto } from './dto/get-genre-query.dto';
import { resolveGenreSlug } from './genre.constants';

interface SessionizedRequest extends Request {
  session?: {
    userId?: string;
  };
}

@Controller('books')
export class GenreController {
  constructor(private readonly service: GenreService) {}

  // GET /books/genre?genreId=12&languageId=en-US&start=0&end=9
  @Get('genre')
  getByGenre(@Req() req: SessionizedRequest, @Query() q: GetGenreQueryDto) {
    if (q.end < q.start) {
      throw new BadRequestException(
        'Parâmetros inválidos: use start>=0 e end>=start.',
      );
    }
    const slug = resolveGenreSlug(q.genreId);
    if (!slug) {
      throw new BadRequestException('genreId inválido.');
    }
    const profileId = req.session?.userId;
    return this.service.getByGenre(
      q.start,
      q.end,
      q.languageId,
      slug,
      profileId,
    );
    //                                ^start  ^end  ^lang        ^slug
  }
}
