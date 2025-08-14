// src/books/books.service.ts
import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';

type AuthorObj = { author: string };
type AuthorEmbed = AuthorObj | AuthorObj[];
type BookTitle = { title: string };

type BookRow = {
  cover_url: string;
  year: number;
  authors: AuthorEmbed;
  book_titles: BookTitle[];
};

type BookItem = {
  title: string;
  author: string;
  year: number;
  cover_url: string;
};

@Injectable()
export class BooksService {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async getRange(start: number, end: number, languageId: string) {
    const { data, count, error } = await this.supabase
      .from('books')
      .select(
        `
        cover_url,
        year,
        authors:authors(author),
        book_titles:book_titles!inner(title)
      ` as const,
        { count: 'exact' },
      )
      .eq('book_titles.language', languageId)
      .order('created_at', { ascending: true })
      .range(start, end);

    if (error) throw new InternalServerErrorException(error.message);

    // Cast seguro via unknown (mantém tipagem depois)
    const rows = (data ?? []) as unknown as BookRow[];

    const items: BookItem[] = rows.map((book) => {
      const author =
        Array.isArray(book.authors) ? book.authors[0].author : book.authors.author;

      return {
        title: book.book_titles[0].title,
        author,
        year: book.year,
        cover_url: book.cover_url,
      };
    });

    return { total: count ?? 0, items };
  }
}
