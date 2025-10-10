// src/books/books.service.ts
import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';

type AuthorObj = { author: string };
type AuthorEmbed = AuthorObj | AuthorObj[];
type BookTitle = { title: string };

type BookRow = {
  id: string;
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
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  private readonly SEARCH_FETCH_BUFFER = 50;
  private readonly MIN_SEARCH_LENGTH = 3;

  async getRange(start: number, end: number, languageId: string) {
    const { data, count, error } = await this.supabase
      .from('books')
      .select(
        `
        id,
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

    const items: BookItem[] = rows.map((book) => this.toBookItem(book));

    return { total: count ?? 0, items };
  }

  async searchByText(
    text: string,
    start: number,
    end: number,
    languageId: string,
  ) {
    const query = String(text ?? '').trim();
    if (!query || query.length < this.MIN_SEARCH_LENGTH) {
      return { total: 0, items: [] };
    }

    const pageSize = end - start + 1;
    if (pageSize <= 0) {
      return { total: 0, items: [] };
    }

    const pattern = `%${this.escapeForIlike(query)}%`;
    const lowerQuery = query.toLowerCase();
    const fetchLimit = Math.max(
      start + pageSize + this.SEARCH_FETCH_BUFFER,
      this.SEARCH_FETCH_BUFFER,
    );

    const selectFields = `
      id,
      cover_url,
      year,
      authors:authors(author),
      book_titles:book_titles!inner(title)
    ` as const;

    const [titleResp, authorResp] = await Promise.all([
      this.supabase
        .from('books')
        .select(selectFields, { count: 'exact' })
        .eq('book_titles.language', languageId)
        .ilike('book_titles.title', pattern)
        .order('created_at', { ascending: true })
        .range(0, fetchLimit - 1),
      this.supabase
        .from('books')
        .select(selectFields, { count: 'exact' })
        .eq('book_titles.language', languageId)
        .ilike('authors.author', pattern)
        .order('created_at', { ascending: true })
        .range(0, fetchLimit - 1),
    ]);

    if (titleResp.error) {
      throw new InternalServerErrorException(titleResp.error.message);
    }
    if (authorResp.error) {
      throw new InternalServerErrorException(authorResp.error.message);
    }

    const titleRows = (titleResp.data ?? []) as unknown as BookRow[];
    const authorRows = (authorResp.data ?? []) as unknown as BookRow[];

    const ranked = new Map<
      string,
      { item: BookItem; weight: number; order: number }
    >();
    let order = 0;

    const pushRows = (rows: BookRow[], weight: number) => {
      for (const book of rows) {
        const id = book.id ? String(book.id) : undefined;
        if (!id) continue;

        const titleMatches = book.book_titles.some((entry) =>
          (entry?.title ?? '').toLowerCase().includes(lowerQuery),
        );
        const authorsArray = Array.isArray(book.authors)
          ? book.authors
          : book.authors
          ? [book.authors]
          : [];
        const authorMatches = authorsArray.some((entry) =>
          (entry?.author ?? '').toLowerCase().includes(lowerQuery),
        );
        if (weight === 0 && !titleMatches) continue;
        if (weight === 1 && !authorMatches) continue;

        const existing = ranked.get(id);
        if (existing && existing.weight <= weight) {
          continue;
        }
        const item = this.toBookItem(book);
        ranked.set(id, { item, weight, order: order++ });
      }
    };

    pushRows(titleRows, 0);
    pushRows(authorRows, 1);

    const combined = Array.from(ranked.values()).sort(
      (a, b) => a.weight - b.weight || a.order - b.order,
    );

    const totalUniqueEstimated = await this.estimateSearchTotal(
      languageId,
      pattern,
      titleResp.count ?? titleRows.length,
      authorResp.count ?? authorRows.length,
    );

    const total = totalUniqueEstimated ?? combined.length;
    const sliceStart = Math.min(start, combined.length);
    const sliceEnd = Math.min(end + 1, combined.length);
    const items = combined
      .slice(sliceStart, sliceEnd)
      .map((entry) => entry.item);

    return { total, items };
  }

  private toBookItem(book: BookRow): BookItem {
    const authorsArr = Array.isArray(book.authors)
      ? book.authors
      : book.authors
      ? [book.authors]
      : [];
    const author = authorsArr
      .map((entry) => entry?.author)
      .filter((value): value is string => Boolean(value && value.trim()))
      .map((value) => value.trim())
      .join(', ');

    return {
      title: book.book_titles[0]?.title ?? '',
      author,
      year: book.year,
      cover_url: book.cover_url,
    };
  }

  private escapeForIlike(term: string) {
    return term.replace(/[%_\\]/g, '\\$&');
  }

  private async estimateSearchTotal(
    languageId: string,
    pattern: string,
    titleCount: number,
    authorCount: number,
  ) {
    if (!titleCount && !authorCount) {
      return 0;
    }

    const overlap = await this.supabase
      .from('books')
      .select(
        `
        id,
        book_titles:book_titles!inner(title),
        authors:authors!inner(author)
      `,
        { count: 'exact', head: true },
      )
      .eq('book_titles.language', languageId)
      .ilike('book_titles.title', pattern)
      .ilike('authors.author', pattern);

    if (overlap.error) {
      throw new InternalServerErrorException(overlap.error.message);
    }

    const overlapCount = overlap.count ?? 0;
    return titleCount + authorCount - overlapCount;
  }
}
