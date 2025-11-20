import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';
import { ListeningProgressService } from '../audio/listening-progress.service';

type LanguageCode = 'pt-BR' | 'en-US';

type FinishedRow = {
  book_id: string | null;
  profileId: string | null;
  created_at: string | null;
};

type ListeningProgressRow = {
  book_id: string | null;
  position_seconds: number | null;
  duration_seconds: number | null;
  progress_percent: number | null;
  updated_at: string | null;
};

type AuthorRow = { author: string };
type AuthorEmbed = AuthorRow | AuthorRow[];

type BookRow = {
  id: string;
  cover_url: string;
  year: number;
  book_titles: { title: string }[];
  authors: AuthorEmbed;
};

export interface BookSummaryInfo {
  bookId: string;
  title: string;
  author: string;
  year: number;
  cover_url: string;
}

export interface UserHistoryItem extends BookSummaryInfo {
  finishedAt: string | null;
}

export interface UserListeningItem extends BookSummaryInfo {
  updatedAt: string | null;
  progressPercent: number | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
}

export interface TopBookItem extends BookSummaryInfo {
  finishes: number;
  mostRecentFinishAt: string | null;
}

export interface RecommendationItem extends BookSummaryInfo {
  recommendedAt: string | null;
  matchedProfileId?: string;
  referenceFinishedAt?: string | null;
}

@Injectable()
export class AudioInsightsService {
  private readonly logger = new Logger(AudioInsightsService.name);
  private readonly HISTORY_LIMIT = 10;
  private readonly DEFAULT_LOOKBACK_DAYS = 30;
  private readonly UNKNOWN_AUTHOR = 'Autor desconhecido';
  private readonly UNKNOWN_TITLE = 'Título indisponível';

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly listeningProgress: ListeningProgressService,
  ) {}

  async getUserFinishedHistory(
    profileId: string,
    languageId: LanguageCode,
    limit = this.HISTORY_LIMIT,
  ): Promise<UserHistoryItem[]> {
    try {
      const { data, error } = await this.supabase
        .from('finished')
        .select('book_id, created_at')
        .eq('profileId', profileId)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) {
        this.logger.error(
          `Erro ao carregar histórico de concluídos do perfil ${profileId}: ${error.message}`,
        );
        return [];
      }

      const rows = (data ?? []).filter(
        (row): row is FinishedRow => Boolean(row?.book_id),
      );
      if (rows.length === 0) return [];

      const summaries = await this.fetchBookSummaries(
        rows.map((row) => row.book_id!),
        languageId,
      );

      return rows.map((row) => ({
        ...this.summaryForBook(summaries, row.book_id!),
        finishedAt: row.created_at ?? null,
      }));
    } catch (err) {
      this.logger.error(
        `Falha inesperada ao carregar histórico de concluídos do perfil ${profileId}: ${err}`,
      );
      return [];
    }
  }

  async getMostRecentFinished(
    profileId: string,
    languageId: LanguageCode,
  ): Promise<UserHistoryItem | null> {
    try {
      const { data, error } = await this.supabase
        .from('finished')
        .select('book_id, created_at')
        .eq('profileId', profileId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        this.logger.error(
          `Erro ao carregar último livro concluído do perfil ${profileId}: ${error.message}`,
        );
        return null;
      }

      if (!data?.book_id) {
        return null;
      }

      const summaries = await this.fetchBookSummaries([data.book_id], languageId);
      return {
        ...this.summaryForBook(summaries, data.book_id),
        finishedAt: data.created_at ?? null,
      };
    } catch (err) {
      this.logger.error(
        `Falha inesperada ao carregar último livro concluído do perfil ${profileId}: ${err}`,
      );
      return null;
    }
  }

  async getUserListeningQueue(
    profileId: string,
    languageId: LanguageCode,
    limit = this.HISTORY_LIMIT,
  ): Promise<UserListeningItem[]> {
    try {
      const snapshots =
        await this.listeningProgress.getRecentProgressSnapshots(
          profileId,
          limit,
        );

      const rows = (snapshots as ListeningProgressRow[]).filter((row) =>
        Boolean(row.book_id),
      );
      if (rows.length === 0) return [];

      const summaries = await this.fetchBookSummaries(
        rows.map((row) => row.book_id!),
        languageId,
      );

      return rows.map((row) => ({
        ...this.summaryForBook(summaries, row.book_id!),
        updatedAt: row.updated_at ?? null,
        progressPercent: row.progress_percent ?? null,
        positionSeconds: row.position_seconds ?? null,
        durationSeconds: row.duration_seconds ?? null,
      }));
    } catch (err) {
      this.logger.error(
        `Falha inesperada ao carregar fila de audição do perfil ${profileId}: ${err}`,
      );
      return [];
    }
  }

  async getTopFinishedBooks(
    languageId: LanguageCode,
    daysWindow = this.DEFAULT_LOOKBACK_DAYS,
    limit = this.HISTORY_LIMIT,
  ): Promise<TopBookItem[]> {
    const windowDays =
      Number.isFinite(daysWindow) && daysWindow > 0
        ? daysWindow
        : this.DEFAULT_LOOKBACK_DAYS;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    try {
      const { data, error } = await this.supabase
        .from('finished')
        .select('book_id, created_at')
        .gte('created_at', since.toISOString());

      if (error) {
        this.logger.error(
          `Erro ao calcular livros mais lidos (últimos ${windowDays} dias): ${error.message}`,
        );
        return [];
      }

      const stats = new Map<
        string,
        { count: number; mostRecent: string | null }
      >();

      for (const row of data ?? []) {
        if (!row?.book_id) continue;
        const entry = stats.get(row.book_id) ?? { count: 0, mostRecent: null };
        entry.count += 1;
        if (
          row.created_at &&
          (!entry.mostRecent ||
            Date.parse(row.created_at) > Date.parse(entry.mostRecent))
        ) {
          entry.mostRecent = row.created_at;
        }
        stats.set(row.book_id, entry);
      }

      const ranked = Array.from(stats.entries())
        .map(([bookId, meta]) => ({
          bookId,
          finishes: meta.count,
          mostRecentFinishAt: meta.mostRecent,
        }))
        .sort((a, b) => {
          if (b.finishes !== a.finishes) {
            return b.finishes - a.finishes;
          }
          const aTime = a.mostRecentFinishAt
            ? Date.parse(a.mostRecentFinishAt)
            : 0;
          const bTime = b.mostRecentFinishAt
            ? Date.parse(b.mostRecentFinishAt)
            : 0;
          return bTime - aTime;
        })
        .slice(0, limit);

      if (ranked.length === 0) {
        return [];
      }

      const summaries = await this.fetchBookSummaries(
        ranked.map((item) => item.bookId),
        languageId,
      );

      return ranked.map((item) => ({
        ...this.summaryForBook(summaries, item.bookId),
        finishes: item.finishes,
        mostRecentFinishAt: item.mostRecentFinishAt ?? null,
      }));
    } catch (err) {
      this.logger.error(
        `Falha inesperada ao calcular livros mais lidos: ${err}`,
      );
      return [];
    }
  }

  async getBookRecommendations(
    bookId: string,
    languageId: LanguageCode,
    options?: { limit?: number; excludeProfileId?: string },
  ): Promise<RecommendationItem[]> {
    if (!bookId) {
      return [];
    }

    const limit = options?.limit ?? this.HISTORY_LIMIT;

    try {
      const { data: baseRows, error: baseError } = await this.supabase
        .from('finished')
        .select('profileId, created_at')
        .eq('book_id', bookId);

      if (baseError) {
        this.logger.error(
          `Erro ao buscar perfis que finalizaram ${bookId}: ${baseError.message}`,
        );
        return [];
      }

      const watchers = (baseRows ?? []).filter(
        (row) =>
          row?.profileId && row.profileId !== options?.excludeProfileId,
      );

      if (watchers.length === 0) {
        return [];
      }

      const profileIds = Array.from(
        new Set(watchers.map((row) => row.profileId as string)),
      );

      const { data: relatedRows, error: relatedError } = await this.supabase
        .from('finished')
        .select('profileId, book_id, created_at')
        .in('profileId', profileIds)
        .neq('book_id', bookId);

      if (relatedError) {
        this.logger.error(
          `Erro ao buscar livros relacionados para ${bookId}: ${relatedError.message}`,
        );
        return [];
      }

      const relatedByProfile = new Map<
        string,
        { book_id: string | null; created_at: string | null }[]
      >();
      for (const row of relatedRows ?? []) {
        if (!row?.profileId || !row.book_id) continue;
        const list = relatedByProfile.get(row.profileId) ?? [];
        list.push(row);
        relatedByProfile.set(row.profileId, list);
      }

      const now = Date.now();
      const candidateMap = new Map<
        string,
        {
          bookId: string;
          recommendedAt: string | null;
          matchedProfileId?: string;
          referenceFinishedAt?: string | null;
          distanceToNow: number;
        }
      >();

      for (const watcher of watchers) {
        const profileId = watcher.profileId as string;
        const candidates = relatedByProfile.get(profileId);
        if (!candidates?.length) continue;
        const targetDate = watcher.created_at
          ? Date.parse(watcher.created_at)
          : 0;

        let closest: { book_id: string; created_at: string | null } | null =
          null;
        let closestDiff = Number.POSITIVE_INFINITY;
        for (const candidate of candidates) {
          if (!candidate.book_id) continue;
          const candidateDate = candidate.created_at
            ? Date.parse(candidate.created_at)
            : 0;
          const diff = Math.abs(candidateDate - targetDate);
          if (diff < closestDiff) {
            closestDiff = diff;
            closest = {
              book_id: candidate.book_id,
              created_at: candidate.created_at ?? null,
            };
          }
        }

        if (!closest) continue;

        const distanceToNow =
          closest.created_at != null
            ? Math.abs(now - Date.parse(closest.created_at))
            : Number.MAX_SAFE_INTEGER;

        const existing = candidateMap.get(closest.book_id);
        if (!existing || distanceToNow < existing.distanceToNow) {
          candidateMap.set(closest.book_id, {
            bookId: closest.book_id,
            recommendedAt: closest.created_at ?? null,
            matchedProfileId: profileId,
            referenceFinishedAt: watcher.created_at ?? null,
            distanceToNow,
          });
        }
      }

      const ranked = Array.from(candidateMap.values())
        .sort((a, b) => a.distanceToNow - b.distanceToNow)
        .slice(0, limit);

      if (ranked.length < limit) {
        this.logger.warn(
          `Menos de ${limit} recomendações encontradas para o livro ${bookId}.`,
        );
        return [];
      }

      const summaries = await this.fetchBookSummaries(
        ranked.map((item) => item.bookId),
        languageId,
      );

      return ranked.map(({ distanceToNow: _distance, ...rest }) => ({
        ...this.summaryForBook(summaries, rest.bookId),
        recommendedAt: rest.recommendedAt,
        matchedProfileId: rest.matchedProfileId,
        referenceFinishedAt: rest.referenceFinishedAt,
      }));
    } catch (err) {
      this.logger.error(
        `Falha inesperada ao montar recomendações para ${bookId}: ${err}`,
      );
      return [];
    }
  }

  async getRecommendationsFromLatestFinished(
    profileId: string,
    languageId: LanguageCode,
    options?: { limit?: number },
  ): Promise<{
    baseBookId: string | null;
    baseBookTitle: string | null;
    baseBook?: BookSummaryInfo | null;
    items: RecommendationItem[];
  }> {
    const latest = await this.getMostRecentFinished(profileId, languageId);
    if (!latest?.bookId) {
      return { baseBookId: null, baseBookTitle: null, baseBook: null, items: [] };
    }

    const items = await this.getBookRecommendations(latest.bookId, languageId, {
      limit: options?.limit,
      excludeProfileId: profileId,
    });

    return {
      baseBookId: latest.bookId,
      baseBookTitle: latest.title,
      baseBook: latest,
      items,
    };
  }

  private async fetchBookSummaries(
    bookIds: string[],
    languageId: LanguageCode,
  ): Promise<Map<string, BookSummaryInfo>> {
    const uniqueIds = Array.from(new Set(bookIds.filter(Boolean)));
    if (uniqueIds.length === 0) {
      return new Map();
    }

    try {
      const { data, error } = await this.supabase
        .from('books')
        .select(
          `
          id,
          cover_url,
          year,
          authors:authors(author),
          book_titles:book_titles!inner(title)
        `,
        )
        .eq('book_titles.language', languageId)
        .in('id', uniqueIds);

      if (error) {
        this.logger.error(
          `Erro ao carregar metadados de livros (${languageId}): ${error.message}`,
        );
        return new Map();
      }

      const rows = (data ?? []) as unknown as BookRow[];
      const map = new Map<string, BookSummaryInfo>();
      for (const row of rows) {
        map.set(String(row.id), this.toBookSummary(row));
      }
      return map;
    } catch (err) {
      this.logger.error(`Falha inesperada ao carregar metadados de livros: ${err}`);
      return new Map();
    }
  }

  private toBookSummary(row: BookRow): BookSummaryInfo {
    const authors = Array.isArray(row.authors)
      ? row.authors
      : row.authors
        ? [row.authors]
        : [];
    const author = authors.find((entry) => entry?.author?.trim())?.author;
    return {
      bookId: String(row.id),
      title: row.book_titles?.[0]?.title ?? this.UNKNOWN_TITLE,
      author: author ?? this.UNKNOWN_AUTHOR,
      year: typeof row.year === 'number' ? row.year : 0,
      cover_url: row.cover_url ?? '',
    };
  }

  private summaryForBook(
    summaries: Map<string, BookSummaryInfo>,
    bookId: string,
  ): BookSummaryInfo {
    return (
      summaries.get(bookId) ?? {
        bookId,
        title: this.UNKNOWN_TITLE,
        author: this.UNKNOWN_AUTHOR,
        year: 0,
        cover_url: '',
      }
    );
  }
}
