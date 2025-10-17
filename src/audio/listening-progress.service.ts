// src/audio/listening-progress.service.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';

type PassiveSessionKey = string;

interface PassiveSession {
  bookId: string;
  audioFileName?: string;
  lastReportedPosition: number;
  lastReportedAt: number;
  durationSeconds?: number;
}

interface ExistingProgressRow {
  position_seconds: number | null;
  duration_seconds: number | null;
  progress_percent: number | null;
  updated_at: string | null;
}

interface NormalizedProgressPayload {
  bookId?: string;
  audioFileName?: string;
  positionSeconds: number;
  durationSeconds: number | null;
  progressPercent: number | null;
  force: boolean;
  source: string;
}

export interface ReportProgressInput {
  bookId?: string;
  audioFileName?: string;
  positionSeconds: number;
  durationSeconds?: number | null;
  progressPercent?: number | null;
  source?: 'client' | 'server-stream' | string;
  force?: boolean;
}

export interface ReportProgressResult {
  persisted: boolean;
  progressPercent?: number | null;
  reason?: string;
  bookId?: string;
}

@Injectable()
export class ListeningProgressService {
  private readonly logger = new Logger(ListeningProgressService.name);
  private readonly audioBookCache = new Map<
    string,
    { bookId: string; cachedAt: number }
  >();

  private readonly passiveSessions = new Map<PassiveSessionKey, PassiveSession>();

  // Persistência
  private readonly MIN_PROGRESS_PERCENT = 2;
  private readonly MAX_PROGRESS_PERCENT = 99;
  private readonly MIN_VALID_POSITION_SECONDS = 5;
  private readonly AUTO_SAVE_POSITION_DELTA = 15;
  private readonly AUTO_SAVE_INTERVAL_MS = 60000;

  // Outros
  private readonly SESSION_TIMEOUT_MS = 5 * 60 * 1000;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {
    setInterval(() => this.cleanupPassiveSessions(), 60000);
  }

  /**
   * Endpoint principal: recebe batidas do cliente e persiste progresso
   */
  async reportProgress(
    profileId: string,
    input: ReportProgressInput,
  ): Promise<ReportProgressResult> {
    const normalized = await this.normalizePayload(profileId, input);
    if (!normalized.bookId) {
      return {
        persisted: false,
        reason: 'bookId não encontrado',
      };
    }

    this.logger.debug('Heartbeat recebido', {
      profileId,
      source: normalized.source,
      bookId: normalized.bookId,
      audioFileName: normalized.audioFileName ?? null,
      positionSeconds: normalized.positionSeconds,
      durationSeconds: normalized.durationSeconds,
      progressPercent: normalized.progressPercent,
      forced: input.force ?? false,
    });

    const existing = await this.loadExistingProgress(
      profileId,
      normalized.bookId,
    );

    const shouldPersist = this.shouldPersistProgress(
      normalized,
      existing,
      input.force,
    );

    if (!shouldPersist.persist) {
      this.logger.debug(
        `Progresso ignorado para ${profileId}:${normalized.bookId} (${shouldPersist.reason})`,
        {
          positionSeconds: normalized.positionSeconds,
          durationSeconds: normalized.durationSeconds,
          previousPosition: existing?.position_seconds ?? null,
          sinceLastUpdate: existing?.updated_at ?? null,
        },
      );
      return {
        persisted: false,
        reason: shouldPersist.reason,
        progressPercent: normalized.progressPercent,
        bookId: normalized.bookId,
      };
    }

    const persisted = await this.persistRow(
      profileId,
      normalized.bookId,
      normalized.positionSeconds,
      normalized.durationSeconds,
      normalized.progressPercent,
    );

    if (persisted) {
      this.logger.debug(
        `Progresso salvo: user=${profileId}, book=${normalized.bookId}, position=${normalized.positionSeconds}s`,
        {
          durationSeconds: normalized.durationSeconds,
          progressPercent: normalized.progressPercent,
        },
      );
      this.updatePassiveSession(profileId, normalized.bookId, {
        audioFileName: normalized.audioFileName,
        positionSeconds: normalized.positionSeconds,
        durationSeconds: normalized.durationSeconds ?? undefined,
      });
      return {
        persisted: true,
        progressPercent: normalized.progressPercent,
        bookId: normalized.bookId,
      };
    }

    return {
      persisted: false,
      reason: 'Erro ao persistir progresso',
      progressPercent: normalized.progressPercent,
      bookId: normalized.bookId,
    };
  }

  /**
   * Compatibilidade com rastreamento baseado no streaming do backend
   * (mantido para reutilizar lógica existente até que o front seja adaptado)
   */
  async startListeningSession(
    profileId: string,
    audioFileName: string,
    duration: number | undefined,
    initialPosition = 0,
    providedBookId?: string,
  ): Promise<void> {
    const bookId = await this.resolveBookId(audioFileName, providedBookId);
    if (!bookId) {
      this.logger.warn(`Book ID não encontrado para áudio: ${audioFileName}`);
      return;
    }

    const key = this.sessionKey(profileId, bookId);
    this.passiveSessions.set(key, {
      bookId,
      audioFileName,
      lastReportedPosition: initialPosition,
      lastReportedAt: Date.now(),
      durationSeconds: duration,
    });

    if (initialPosition > 0) {
      await this.reportProgress(profileId, {
        bookId,
        audioFileName,
        positionSeconds: initialPosition,
        durationSeconds: duration,
        source: 'server-stream',
      });
    }

    this.logger.debug(
      `Sessão passiva iniciada: user=${profileId}, audio=${audioFileName}, book=${bookId}`,
    );
  }

  async updateListeningPosition(
    profileId: string,
    audioFileName: string,
    currentPosition: number,
    options: { duration?: number; forceSave?: boolean; bookId?: string } = {},
  ): Promise<ReportProgressResult | null> {
    const bookId = options.bookId
      ? options.bookId
      : await this.resolveBookId(audioFileName);
    if (!bookId) {
      return null;
    }

    const key = this.sessionKey(profileId, bookId);
    const passive = this.passiveSessions.get(key);
    const durationSeconds = options.duration ?? passive?.durationSeconds;

    const result = await this.reportProgress(profileId, {
      bookId,
      audioFileName,
      positionSeconds: currentPosition,
      durationSeconds,
      source: 'server-stream',
      force: options.forceSave,
    });

    if (result.persisted && passive) {
      passive.lastReportedPosition = currentPosition;
      passive.lastReportedAt = Date.now();
      passive.durationSeconds =
        typeof durationSeconds === 'number' ? durationSeconds : passive.durationSeconds;
    }

    return result;
  }

  async endListeningSession(
    profileId: string,
    audioFileName: string,
    options: { bookId?: string; force?: boolean } = {},
  ): Promise<void> {
    const bookId = options.bookId
      ? options.bookId
      : await this.resolveBookId(audioFileName);
    if (!bookId) return;

    const key = this.sessionKey(profileId, bookId);
    const passive = this.passiveSessions.get(key);

    const finalPosition = passive?.lastReportedPosition ?? 0;
    const durationSeconds = passive?.durationSeconds;

    await this.reportProgress(profileId, {
      bookId,
      audioFileName,
      positionSeconds: finalPosition,
      durationSeconds,
      source: 'server-stream',
      force: options.force ?? true,
    });

    this.passiveSessions.delete(key);

    this.logger.debug(
      `Sessão passiva encerrada: user=${profileId}, book=${bookId}`,
    );
  }

  /**
   * Busca progresso atual de um livro específico
   */
  async getListeningProgress(profileId: string, bookId: string) {
    try {
      const { data, error } = await this.supabase
        .from('listening_progress')
        .select('*')
        .eq('profileId', profileId)
        .eq('book_id', bookId)
        .maybeSingle();

      if (error) {
        this.logger.error(`Erro ao buscar progresso: ${error.message}`);
        return null;
      }

      return data;
    } catch (err) {
      this.logger.error(`Erro inesperado ao buscar progresso: ${err}`);
      return null;
    }
  }

  /**
   * Lista todos os progressos do usuário, ordenados pelo mais recente
   */
  async getUserListeningProgress(profileId: string) {
    try {
      const { data, error } = await this.supabase
        .from('listening_progress')
        .select('*')
        .eq('profileId', profileId)
        .order('updated_at', { ascending: false });

      if (error) {
        this.logger.error(`Erro ao buscar progressos do usuário: ${error.message}`);
        return [];
      }

      return data ?? [];
    } catch (err) {
      this.logger.error(`Erro inesperado ao buscar progressos: ${err}`);
      return [];
    }
  }

  /**
   * Estatísticas simples das últimas N atualizações do usuário
   */
  async getRecentProgressSnapshots(
    profileId: string,
    limit = 10,
  ) {
    try {
      const { data, error } = await this.supabase
        .from('listening_progress')
        .select('book_id, position_seconds, duration_seconds, progress_percent, updated_at')
        .eq('profileId', profileId)
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (error) {
        this.logger.error(`Erro ao buscar snapshots de progresso: ${error.message}`);
        return [];
      }

      return data ?? [];
    } catch (err) {
      this.logger.error(`Erro inesperado ao buscar snapshots: ${err}`);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async normalizePayload(
    profileId: string,
    input: ReportProgressInput,
  ): Promise<NormalizedProgressPayload> {
    const resolvedBookId = input.bookId
      ? input.bookId
      : input.audioFileName
      ? await this.resolveBookId(input.audioFileName)
      : undefined;

    const positionSeconds = Math.max(
      0,
      Math.floor(Number.isFinite(input.positionSeconds) ? input.positionSeconds : 0),
    );

    const durationSeconds =
      typeof input.durationSeconds === 'number' && input.durationSeconds > 0
        ? Math.max(Math.floor(input.durationSeconds), positionSeconds || 0)
        : null;

    let progressPercent =
      typeof input.progressPercent === 'number' && Number.isFinite(input.progressPercent)
        ? input.progressPercent
        : null;

    if (
      progressPercent == null &&
      durationSeconds != null &&
      durationSeconds > 0
    ) {
      progressPercent = Math.min(
        100,
        (positionSeconds / durationSeconds) * 100,
      );
    }

    if (progressPercent != null) {
      progressPercent = Math.round(progressPercent * 100) / 100;
    }

    return {
      bookId: resolvedBookId,
      audioFileName: input.audioFileName,
      positionSeconds,
      durationSeconds,
      progressPercent,
      force: input.force ?? false,
      source: input.source ?? 'client',
    };
  }

  private async loadExistingProgress(
    profileId: string,
    bookId: string,
  ): Promise<ExistingProgressRow | null> {
    const query = () =>
      this.supabase
        .from('listening_progress')
        .select('position_seconds, duration_seconds, progress_percent, updated_at')
        .eq('profileId', profileId)
        .eq('book_id', bookId)
        .maybeSingle();

    let { data, error } = await query();

    if (error) {
      if (error.code === 'PGRST116') {
        await this.enforceSingleRow(profileId, bookId);
        const retry = await query();
        if (retry.error) {
          this.logger.error(
            `Erro ao carregar progresso existente após deduplicação: ${retry.error.message}`,
          );
          return null;
        }
        data = retry.data;
      } else {
        this.logger.error(`Erro ao carregar progresso existente: ${error.message}`);
        return null;
      }
    }

    return data ?? null;
  }

  private shouldPersistProgress(
    payload: NormalizedProgressPayload,
    existing: ExistingProgressRow | null,
    force = false,
  ): { persist: boolean; reason?: string } {
    if (force) {
      return { persist: true };
    }

    if (!payload.bookId) {
      return { persist: false, reason: 'bookId ausente' };
    }

    if (payload.positionSeconds < this.MIN_VALID_POSITION_SECONDS) {
      return {
        persist: false,
        reason: `posição < ${this.MIN_VALID_POSITION_SECONDS}s`,
      };
    }

    if (
      payload.progressPercent != null &&
      (payload.progressPercent < this.MIN_PROGRESS_PERCENT ||
        payload.progressPercent > this.MAX_PROGRESS_PERCENT)
    ) {
      return {
        persist: false,
        reason: `percentual fora do intervalo (${payload.progressPercent?.toFixed(1)}%)`,
      };
    }

    if (!existing) {
      return { persist: true };
    }

    const previousPosition = Math.max(
      0,
      existing.position_seconds ?? 0,
    );
    const positionDelta = Math.abs(payload.positionSeconds - previousPosition);

    const lastUpdate = existing.updated_at ? Date.parse(existing.updated_at) : NaN;
    const timeSinceLastUpdate = isNaN(lastUpdate)
      ? Number.POSITIVE_INFINITY
      : Date.now() - lastUpdate;

    if (positionDelta >= this.AUTO_SAVE_POSITION_DELTA) {
      return { persist: true };
    }

    if (timeSinceLastUpdate >= this.AUTO_SAVE_INTERVAL_MS) {
      return { persist: true };
    }

    return {
      persist: false,
      reason: `delta ${positionDelta.toFixed(1)}s e ${Math.round(timeSinceLastUpdate / 1000)}s desde última gravação`,
    };
  }

  private async persistRow(
    profileId: string,
    bookId: string,
    positionSeconds: number,
    durationSeconds: number | null,
    progressPercent: number | null,
  ): Promise<boolean> {
    const nowIso = new Date().toISOString();

    const updatePayload = {
      position_seconds: positionSeconds,
      duration_seconds: durationSeconds ?? null,
      progress_percent: progressPercent ?? null,
      updated_at: nowIso,
    };

    const { data: updatedRows, error: updateError } = await this.supabase
      .from('listening_progress')
      .update(updatePayload)
      .eq('profileId', profileId)
      .eq('book_id', bookId)
      .select('id');

    if (updateError) {
      this.logger.error(`Erro ao atualizar progresso: ${updateError.message}`);
      return false;
    }

    if ((updatedRows?.length ?? 0) > 0) {
      await this.enforceSingleRow(profileId, bookId);
      return true;
    }

    const insertPayload = {
      profileId,
      book_id: bookId,
      ...updatePayload,
    };

    const { error: insertError } = await this.supabase
      .from('listening_progress')
      .insert(insertPayload);

    if (insertError) {
      if (insertError.code === '23505') {
        this.logger.warn(
          `Violação de unicidade ao inserir progresso (user=${profileId}, book=${bookId}). Tentando atualização.`,
        );
        const retryUpdate = await this.supabase
          .from('listening_progress')
          .update(updatePayload)
          .eq('profileId', profileId)
          .eq('book_id', bookId)
          .select('id');

        if (retryUpdate.error) {
          this.logger.error(
            `Erro ao atualizar progresso após violação de unicidade: ${retryUpdate.error.message}`,
          );
          return false;
        }

        await this.enforceSingleRow(profileId, bookId);
        return true;
      }

      this.logger.error(`Erro ao inserir progresso: ${insertError.message}`);
      return false;
    }

    await this.enforceSingleRow(profileId, bookId);
    return true;
  }

  private async enforceSingleRow(profileId: string, bookId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('listening_progress')
      .select('id, updated_at')
      .eq('profileId', profileId)
      .eq('book_id', bookId)
      .order('updated_at', { ascending: false });

    if (error) {
      this.logger.error(
        `Erro ao verificar duplicatas de progresso: ${error.message}`,
      );
      return;
    }

    if (!Array.isArray(data) || data.length <= 1) {
      return;
    }

    const [, ...duplicates] = data;
    const idsToDelete = duplicates
      .map((row: any) => row?.id)
      .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number');

    if (idsToDelete.length === 0) {
      return;
    }

    const { error: deleteError } = await this.supabase
      .from('listening_progress')
      .delete()
      .in('id', idsToDelete);

    if (deleteError) {
      this.logger.error(
        `Erro ao remover duplicatas de progresso: ${deleteError.message}`,
      );
    } else {
      this.logger.warn(
        `Removidas ${idsToDelete.length} duplicatas de progresso para user=${profileId}, book=${bookId}.`,
      );
    }
  }

  private async resolveBookId(
    audioFileName: string,
    providedBookId?: string,
  ): Promise<string | undefined> {
    if (providedBookId) {
      return providedBookId;
    }

    const audioBaseName = this.extractAudioBaseName(audioFileName);
    if (!audioBaseName) return undefined;

    const cached = this.audioBookCache.get(audioBaseName);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.bookId;
    }

    const { data, error } = await this.supabase
      .from('summaries')
      .select('book_id')
      .like('audio_url', `%${audioBaseName}%`)
      .maybeSingle();

    if (error) {
      this.logger.error(`Erro ao buscar book_id para ${audioFileName}: ${error.message}`);
      return undefined;
    }

    const bookId = data?.book_id ? String(data.book_id) : undefined;
    if (bookId) {
      this.audioBookCache.set(audioBaseName, {
        bookId,
        cachedAt: Date.now(),
      });
    }

    return bookId;
  }

  private extractAudioBaseName(fileName: string): string | null {
    if (!fileName) return null;
    const sanitized = fileName.trim();
    if (!sanitized) return null;
    return sanitized.replace(/\.[^/.]+$/, '');
  }

  private sessionKey(profileId: string, bookId: string): PassiveSessionKey {
    return `${profileId}:${bookId}`;
  }

  private updatePassiveSession(
    profileId: string,
    bookId: string,
    info: { positionSeconds: number; durationSeconds?: number; audioFileName?: string },
  ) {
    const key = this.sessionKey(profileId, bookId);
    const existing = this.passiveSessions.get(key);
    if (!existing) return;

    existing.lastReportedPosition = info.positionSeconds;
    existing.lastReportedAt = Date.now();
    if (typeof info.durationSeconds === 'number') {
      existing.durationSeconds = info.durationSeconds;
    }
    if (info.audioFileName) {
      existing.audioFileName = info.audioFileName;
    }
  }

  private cleanupPassiveSessions(): void {
    const now = Date.now();
    for (const [key, session] of this.passiveSessions.entries()) {
      if (now - session.lastReportedAt > this.SESSION_TIMEOUT_MS) {
        this.passiveSessions.delete(key);
        this.logger.debug(`Sessão passiva expirada removida (${key})`);
      }
    }
  }
}
