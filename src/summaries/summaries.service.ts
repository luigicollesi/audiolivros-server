// src/summaries/summaries.service.ts
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';

export type SummaryItem = {
  bookId: string;
  audio_url: string;
  summary: string;
};
type BookTitleRow = { book_id: string };
type GenreRow = {
  genres?:
    | { genre?: string | null }
    | Array<{ genre?: string | null }>
    | null;
};

@Injectable()
export class SummariesService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findByTitleAndLanguage(
    title: string,
    language: 'pt-BR' | 'en-US',
  ): Promise<SummaryItem[]> {
    const { data: titleRows, error: titleErr } = await this.supabase
      .from('book_titles')
      .select('book_id')
      .eq('title', title)
      .eq('language', language);
    if (titleErr) throw new InternalServerErrorException(titleErr.message);

    const ids = (titleRows ?? []) as BookTitleRow[];
    if (ids.length === 0)
      throw new NotFoundException(
        `Nenhum book_id para "${title}" em ${language}.`,
      );

    const bookIds = Array.from(
      new Set(ids.map((r) => r.book_id).filter(Boolean)),
    );
    const { data: summaries, error: sumErr } = await this.supabase
      .from('summaries')
      .select('book_id, audio_url, summary')
      .in('book_id', bookIds)
      .eq('language', language);
    if (sumErr) throw new InternalServerErrorException(sumErr.message);

    const items = (summaries ?? []).map((s: any) => ({
      bookId: String(s.book_id),
      audio_url: s.audio_url,
      summary: s.summary,
    })) as SummaryItem[];
    if (items.length === 0)
      throw new NotFoundException(
        `Nenhum summary para "${title}" em ${language}.`,
      );
    // opcional dedupe
    const uniq = new Map(items.map((s) => [s.bookId, s]));
    return Array.from(uniq.values());
  }

  async getGenresForBook(bookId: string): Promise<string[]> {
    if (!bookId) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('book_genres')
      .select('genres:genres!inner(genre)')
      .eq('book_id', bookId);

    if (error) {
      throw new InternalServerErrorException(
        `Falha ao buscar gêneros do livro ${bookId}: ${error.message}`,
      );
    }

    const rows = (data ?? []) as GenreRow[];
    const genres = rows.flatMap((row) => {
      if (Array.isArray(row.genres)) {
        return row.genres;
      }
      return row.genres ? [row.genres] : [];
    });

    return genres
      .map((entry) => entry?.genre)
      .filter((genre): genre is string => Boolean(genre && genre.trim()))
      .map((genre) => genre.trim());
  }
}
