import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { GenreService } from './genre.service';

@Controller('books')
export class GenreController {
  constructor(private readonly service: GenreService) {}

  /**
   * GET /book/genre?genre=Filosofia&languageId=<uuid>&start=0&end=9
   * - genre: obrigatório (string a ser buscada em genres.genre)
   * - languageId: UUID da língua para títulos (default opcional abaixo)
   * - start/end: range dos resultados
   */
  @Get('genre')
  getByGenre(
    @Query('genre') genre: string,
    @Query('languageId', new DefaultValuePipe('en-US')) languageId: string,
    @Query('start', new DefaultValuePipe(0), ParseIntPipe) start: number,
    @Query('end',   new DefaultValuePipe(9), ParseIntPipe) end: number,
  ) {
    if (!genre?.trim()) throw new BadRequestException("Informe 'genre'.");
    if (start < 0 || end < start) throw new BadRequestException('start/end inválidos.');

    return this.service.getByGenre(start, end, languageId, genre.trim());
  }
}
