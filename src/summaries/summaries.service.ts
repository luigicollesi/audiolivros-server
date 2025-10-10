// src/summaries/summaries.service.ts
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';

export type SummaryItem = { audio_url: string; summary: string };
type BookTitleRow = { book_id: string };

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
      .select('audio_url, summary')
      .in('book_id', bookIds)
      .eq('language', language);
    if (sumErr) throw new InternalServerErrorException(sumErr.message);

    const items = (summaries ?? []) as SummaryItem[];
    if (items.length === 0)
      throw new NotFoundException(
        `Nenhum summary para "${title}" em ${language}.`,
      );
    // opcional dedupe
    const uniq = new Map(items.map((s) => [`${s.audio_url}|${s.summary}`, s]));
    return Array.from(uniq.values());
  }
}
