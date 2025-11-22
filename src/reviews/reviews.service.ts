import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SB_ADMIN } from '../supabase/module';

type ReviewRow = { rating?: number | null };
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(@Inject(SB_ADMIN) private readonly supabase: SupabaseClient) {}

  async getUserReview(profileId: string, bookId: string) {
    const { data, error } = await this.supabase
      .from('reviews')
      .select('rating')
      .eq('profileId', profileId)
      .eq('book_id', bookId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw new InternalServerErrorException(
        `Falha ao buscar avaliação: ${error.message}`,
      );
    }

    const row = (data ?? null) as ReviewRow | null;
    const rating =
      row?.rating != null && !Number.isNaN(Number(row.rating))
        ? Number(row.rating)
        : null;

    return rating;
  }

  async upsertReview(profileId: string, bookId: string, rating: number) {
    await this.ensureFinished(profileId, bookId);

    const { data: updated, error: updateError } = await this.supabase
      .from('reviews')
      .update({ rating })
      .eq('profileId', profileId)
      .eq('book_id', bookId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      throw new InternalServerErrorException(
        `Falha ao atualizar avaliação: ${updateError.message}`,
      );
    }

    if (!updated) {
      const { error: insertError } = await this.supabase
        .from('reviews')
        .insert({ profileId, book_id: bookId, rating })
        .select('id')
        .maybeSingle();

      if (insertError) {
        throw new InternalServerErrorException(
          `Falha ao salvar avaliação: ${insertError.message}`,
        );
      }
    }

    this.logger.log(
      `Avaliação registrada para user=${profileId}, book=${bookId}, rating=${rating}`,
    );

    return { rating };
  }

  private async ensureFinished(profileId: string, bookId: string) {
    const { data, error } = await this.supabase
      .from('finished')
      .select('id')
      .eq('profileId', profileId)
      .eq('book_id', bookId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw new InternalServerErrorException(
        `Falha ao validar conclusão do livro: ${error.message}`,
      );
    }

    if (!data) {
      throw new ForbiddenException(
        'Você precisa concluir o livro antes de avaliá-lo.',
      );
    }
  }
}
