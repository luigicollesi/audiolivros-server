// src/books/books.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { BooksService } from './books.service';

@Controller('books')
export class BooksController {
  constructor(private readonly service: BooksService) {}

  // GET /books?start=0&end=9&languageId=<uuid>
  @Get()
  getRange(
    @Query('languageId', new DefaultValuePipe('en-US')) languageId: string,
    @Query('start', new DefaultValuePipe(0), ParseIntPipe) start: number,
    @Query('end',   new DefaultValuePipe(9), ParseIntPipe) end: number,
  ) {
    if (!languageId) {
      throw new BadRequestException("Informe 'languageId' ou use valor padrão.");
    }
    if (start < 0 || end < start) {
      throw new BadRequestException('Parâmetros inválidos: use start>=0 e end>=start.');
    }

    return this.service.getRange(start, end, languageId);
  }
}
