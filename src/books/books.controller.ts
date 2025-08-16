// src/books/books.controller.ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { BooksService } from './books.service';
import { GetBooksQueryDto } from './dto/get-books-query.dto';

@Controller('books')
export class BooksController {
  constructor(private readonly service: BooksService) {}

  // GET /books?start=0&end=9&languageId=en-US
  @Get()
  getRange(@Query() q: GetBooksQueryDto) {
    if (q.end < q.start) {
      throw new BadRequestException('Parâmetros inválidos: use start>=0 e end>=start.');
    }
    return this.service.getRange(q.start, q.end, q.languageId);
  }
}
