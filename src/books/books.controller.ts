// src/books/books.controller.ts
import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { BooksService } from './books.service';
import { GetBooksQueryDto } from './dto/get-books-query.dto';

@Controller('books')
export class BooksController {
  constructor(private readonly service: BooksService) {}

  // GET /books?start=0&end=9&languageId=en-US
  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  getRange(@Query() q: GetBooksQueryDto) {
    return this.service.getRange(q.start, q.end, q.languageId);
  }
}
