import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/module';

type AuthorObj   = { author: string };
type AuthorEmbed = AuthorObj | AuthorObj[];
type BookTitle   = { title: string };

type BookRow = {
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
};

@Injectable()
export class GenreService {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  /**
   * Filtra livros por gênero (genres.genre ~ ilike), respeitando idioma do título e paginação.
   */
  async getByGenre(start: number, end: number, languageId: string, genreSlug: string) {
    const pattern = `%${genreSlug}%`; // “equivalente”: contém (case-insensitive)

    const { data, count, error } = await this.supabase
      .from('books')
      .select(
        `
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
