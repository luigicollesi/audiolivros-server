import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/module';

type AuthorObj = { author: string };
type AuthorEmbed = AuthorObj | AuthorObj[];
type BookTitle = { title: string };

type BookRow = {
  id: string;
  cover_url: string;
  year: number;
  authors: AuthorEmbed;
  book_titles: BookTitle[]; // inner + filtro de idioma ⇒ pelo menos 1 esperado
  // o embed de gêneros é só para filtrar, não precisamos mapear
};

type BookItem = {
  title: string;
  author: string;
  year: number;
  cover_url: string;
  listeningProgressPercent?: number | null;
};

@Injectable()
export class GenreService {
  private readonly logger = new Logger(GenreService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Filtra livros por gênero (genres.genre ~ ilike), respeitando idioma do título e paginação.
   */
  async getByGenre(
    start: number,
    end: number,
    languageId: string,
    genreSlug: string,
    profileId?: string | null,
  ) {
    const pattern = `%${genreSlug}%`; // “equivalente”: contém (case-insensitive)

    const { data, count, error } = await this.supabase
      .from('books')
      .select(
        `
        id,
        cover_url,
        year,
        authors:authors(author),
        book_titles:book_titles!inner(title),
        book_genres:book_genres!inner(
          genres:genres!inner(genre)
        )
      ` as const,
        { count: 'exact' },
      )
      .eq('book_titles.language', languageId)
      .ilike('book_genres.genres.genre', pattern)
      .order('created_at', { ascending: true })
      .range(start, end);

    if (error) throw new InternalServerErrorException(error.message);

    const rows = (data ?? []) as unknown as BookRow[];
    const progressMap = await this.fetchUserProgress(profileId, rows);

    const items: BookItem[] = rows.map((book) => {
      const author = Array.isArray(book.authors)
        ? book.authors[0].author
        : book.authors.author;

      return {
        title: book.book_titles[0].title,
        author,
        year: book.year,
        cover_url: book.cover_url,
        listeningProgressPercent: progressMap.get(String(book.id)) ?? null,
      };
    });

    return { total: count ?? 0, items };
  }

  private async fetchUserProgress(
    profileId?: string | null,
    rows?: BookRow[],
  ): Promise<Map<string, number | null>> {
    const progressMap = new Map<string, number | null>();
    if (!profileId || !rows || rows.length === 0) {
      return progressMap;
    }

    const bookIds = Array.from(
      new Set(
        rows
          .map((row) => (row?.id ? String(row.id) : null))
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (bookIds.length === 0) {
      return progressMap;
    }

    const { data, error } = await this.supabase
      .from('listening_progress')
      .select('book_id, progress_percent')
      .eq('profileId', profileId)
      .in('book_id', bookIds);

    if (error) {
      this.logger.warn(
        `Falha ao carregar listening_progress (genre) para profile ${profileId}: ${error.message}`,
      );
      return progressMap;
    }

    for (const row of data ?? []) {
      const bookId =
        typeof row?.book_id === 'string'
          ? row.book_id
          : row?.book_id != null
            ? String(row.book_id)
            : null;
      if (!bookId) continue;
      const percent =
        typeof row?.progress_percent === 'number'
          ? row.progress_percent
          : null;
      progressMap.set(bookId, percent);
    }

    return progressMap;
  }
}
