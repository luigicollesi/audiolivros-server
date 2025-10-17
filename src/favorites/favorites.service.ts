import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';

type BookTitleRow = { title: string; language?: string };
type AuthorRow = { author: string };

type BookRow = {
  id: string;
  cover_url: string;
  year: number;
  book_titles: BookTitleRow[];
  authors: AuthorRow | AuthorRow[];
};

export type FavoriteBookItem = {
  title: string;
  author: string;
  year: number;
  cover_url: string;
};

@Injectable()
export class FavoritesService {
  private readonly logger = new Logger(FavoritesService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async addFavorite(
    profileId: string,
    title: string,
    author: string,
    languageId?: 'pt-BR' | 'en-US',
  ) {
    const bookId = await this.findBookIdByTitleAndAuthor(
      title,
      author,
      languageId,
    );

    const { data: existing, error: existingErr } = await this.supabase
      .from('favorites')
      .select('id')
      .eq('profileId', profileId)
      .eq('book_id', bookId)
      .maybeSingle();

    if (existingErr && existingErr.code !== 'PGRST116') {
      throw new InternalServerErrorException(existingErr.message);
    }
    if (existing) {
      throw new ConflictException('Livro já está na lista de favoritos.');
    }

    const { error: insertErr } = await this.supabase
      .from('favorites')
      .insert({ profileId, book_id: bookId });

    if (insertErr) {
      throw new InternalServerErrorException(insertErr.message);
    }

    this.logger.log(`Livro ${bookId} favoritado pelo perfil ${profileId}.`);

    return { success: true };
  }

  async getFavorites(
    profileId: string,
    languageId: 'pt-BR' | 'en-US',
    start: number,
    end: number,
  ) {
    const { data, count, error } = await this.supabase
      .from('favorites')
      .select('book_id, created_at', { count: 'exact' })
      .eq('profileId', profileId)
      .order('created_at', { ascending: false })
      .range(start, end);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const bookIds = (data ?? []).map((row) => row.book_id).filter(Boolean);
    if (bookIds.length === 0) {
      return { total: count ?? 0, items: [] as FavoriteBookItem[] };
    }

    const { data: booksData, error: booksErr } = await this.supabase
      .from('books')
      .select(
        `
        id,
        cover_url,
        year,
        authors:authors(author),
        book_titles:book_titles!inner(title, language)
      `,
      )
      .eq('book_titles.language', languageId)
      .in('id', bookIds);

    if (booksErr) {
      throw new InternalServerErrorException(booksErr.message);
    }

    const rows = (booksData ?? []) as unknown as BookRow[];
    const byId = new Map<string, FavoriteBookItem>();
    for (const row of rows) {
      byId.set(row.id, this.toBookItem(row));
    }

    const orderedItems = bookIds
      .map((id) => byId.get(String(id)))
      .filter((item): item is FavoriteBookItem => Boolean(item));

    this.logger.debug(
      `Perfil ${profileId} listou ${orderedItems.length}/${count ?? orderedItems.length} favoritos.`,
    );

    return { total: count ?? orderedItems.length, items: orderedItems };
  }

  async removeFavorite(
    profileId: string,
    title: string,
    author: string,
    languageId?: 'pt-BR' | 'en-US',
  ) {
    const bookId = await this.findBookIdByTitleAndAuthor(
      title,
      author,
      languageId,
    );

    const { data, error } = await this.supabase
      .from('favorites')
      .delete()
      .eq('profileId', profileId)
      .eq('book_id', bookId)
      .select('id');

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data || data.length === 0) {
      throw new NotFoundException('Livro não está na lista de favoritos.');
    }

    this.logger.log(
      `Livro ${bookId} removido dos favoritos do perfil ${profileId}.`,
    );

    return { success: true };
  }

  async isFavorite(profileId: string, bookId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('favorites')
      .select('id')
      .eq('profileId', profileId)
      .eq('book_id', bookId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw new InternalServerErrorException(error.message);
    }

    return Boolean(data?.id);
  }

  private async findBookIdByTitleAndAuthor(
    title: string,
    author: string,
    languageId?: 'pt-BR' | 'en-US',
  ): Promise<string> {
    const titlePattern = `%${this.escapeForIlike(title)}%`;
    const authorPattern = `%${this.escapeForIlike(author)}%`;

    const queryBase = this.supabase
      .from('books')
      .select(
        `
        id,
        book_titles:book_titles!inner(title, language),
        authors:authors!inner(author)
      `,
      )
      .ilike('book_titles.title', titlePattern)
      .ilike('authors.author', authorPattern)
      .order('created_at', { ascending: true })
      .limit(1);

    const withLanguage = languageId
      ? queryBase.eq('book_titles.language', languageId)
      : queryBase;

    const { data, error } = await withLanguage.maybeSingle();
    if (error && error.code !== 'PGRST116') {
      throw new InternalServerErrorException(error.message);
    }

    if (data && data.id) {
      return String(data.id);
    }

    if (languageId) {
      const { data: fallback, error: fallbackErr } =
        await queryBase.maybeSingle();
      if (fallbackErr && fallbackErr.code !== 'PGRST116') {
        throw new InternalServerErrorException(fallbackErr.message);
      }
      if (fallback && fallback.id) {
        return String(fallback.id);
      }
    }

    throw new NotFoundException(
      'Livro não encontrado para o título e autor informados.',
    );
  }

  private toBookItem(book: BookRow): FavoriteBookItem {
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
}
