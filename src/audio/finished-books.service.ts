import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';

type FinishedRow = {
  id?: string | number;
  book_id: string;
  profileId: string;
  created_at?: string | null;
};

export interface MarkFinishedResult {
  persisted: boolean;
  reason?: string;
  bookId: string;
  alreadyFinished?: boolean;
}

export interface UnmarkFinishedResult {
  removed: boolean;
  bookId: string;
}

@Injectable()
export class FinishedBooksService {
  private readonly logger = new Logger(FinishedBooksService.name);
  private readonly MAX_FINISHED_BOOKS_PER_USER = 15;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async markAsFinished(
    profileId: string,
    bookId: string,
  ): Promise<MarkFinishedResult> {
    this.logger.debug(`Iniciando markAsFinished - profileId: ${profileId}, bookId: ${bookId}`);
    
    if (!bookId) {
      this.logger.warn(`markAsFinished falhado - bookId ausente para profileId: ${profileId}`);
      return {
        persisted: false,
        reason: 'bookId ausente',
        bookId,
      };
    }

    this.logger.debug(`Verificando se livro já está concluído - profileId: ${profileId}, bookId: ${bookId}`);
    const existing = await this.fetchExistingRow(profileId, bookId);
    if (existing) {
      this.logger.debug(`Livro já estava concluído - limpando progresso ativo - profileId: ${profileId}, bookId: ${bookId}`);
      await this.removeListeningProgress(profileId, bookId);
      this.logger.debug(`Livro já estava concluído - profileId: ${profileId}, bookId: ${bookId}, finishedAt: ${existing.created_at}`);
      return {
        persisted: false,
        reason: 'Livro já marcado como concluído',
        alreadyFinished: true,
        bookId,
      };
    }

    this.logger.debug(`Inserindo registro na tabela 'finished' - profileId: ${profileId}, bookId: ${bookId}`);
    const { error: insertError } = await this.supabase
      .from('finished')
      .insert({ profileId, book_id: bookId });

    if (insertError) {
      if (insertError.code === '23505') {
        this.logger.warn(
          `Violação de unicidade ao marcar livro concluído (user=${profileId}, book=${bookId}) - Code: ${insertError.code}`,
        );
        this.logger.debug(`Violação de unicidade detectada - limpando progresso ativo - profileId: ${profileId}, bookId: ${bookId}`);
        await this.removeListeningProgress(profileId, bookId);
        return {
          persisted: false,
          reason: 'Livro já marcado como concluído',
          alreadyFinished: true,
          bookId,
        };
      }

      this.logger.error(
        `Erro ao inserir finalização (user=${profileId}, book=${bookId}): ${insertError.message} - Code: ${insertError.code}`,
      );
      return {
        persisted: false,
        reason: 'Erro ao salvar finalização',
        bookId,
      };
    }

    this.logger.debug(`Registro inserido com sucesso - profileId: ${profileId}, bookId: ${bookId}`);
    
    this.logger.debug(`Aplicando enforce de linha única - profileId: ${profileId}, bookId: ${bookId}`);
    await this.enforceSingleRow(profileId, bookId);
    
    this.logger.debug(`Aplicando cota de livros concluídos - profileId: ${profileId}`);
    await this.enforceFinishedQuota(profileId);
    
    this.logger.debug(`Removendo progresso ativo do livro concluído - profileId: ${profileId}, bookId: ${bookId}`);
    await this.removeListeningProgress(profileId, bookId);

    this.logger.log(
      `✅ Livro ${bookId} marcado como concluído pelo perfil ${profileId}.`,
    );

    return {
      persisted: true,
      bookId,
    };
  }

  async unmarkFinished(
    profileId: string,
    bookId: string,
  ): Promise<UnmarkFinishedResult> {
    this.logger.debug(`Iniciando remoção de livro concluído - profileId: ${profileId}, bookId: ${bookId}`);
    
    const { data, error } = await this.supabase
      .from('finished')
      .delete()
      .eq('profileId', profileId)
      .eq('book_id', bookId)
      .select('id');

    if (error) {
      this.logger.error(
        `Erro ao remover finalização (user=${profileId}, book=${bookId}): ${error.message} - Code: ${error.code}`,
      );
      return { removed: false, bookId };
    }

    const removedCount = data?.length ?? 0;
    if (removedCount > 0) {
      this.logger.log(`🗑️ Livro ${bookId} removido da lista de concluídos do perfil ${profileId} (${removedCount} registro(s) removido(s))`);
    } else {
      this.logger.debug(`Nenhum registro encontrado para remoção - profileId: ${profileId}, bookId: ${bookId}`);
    }

    return {
      removed: removedCount > 0,
      bookId,
    };
  }

  async isFinished(profileId: string, bookId: string): Promise<boolean> {
    const existing = await this.fetchExistingRow(profileId, bookId);
    return Boolean(existing?.id);
  }

  async listFinished(profileId: string): Promise<FinishedRow[]> {
    this.logger.debug(`Buscando lista de livros concluídos - profileId: ${profileId}`);
    
    try {
      const { data, error } = await this.supabase
        .from('finished')
        .select('id, profileId, book_id, created_at')
        .eq('profileId', profileId)
        .order('created_at', { ascending: false });

      if (error) {
        this.logger.error(
          `Erro ao listar livros concluídos do perfil ${profileId}: ${error.message} - Code: ${error.code}`,
        );
        return [];
      }

      const results = data ?? [];
      this.logger.debug(`Lista de livros concluídos carregada - profileId: ${profileId}, total: ${results.length}`);
      
      if (results.length > 0) {
        this.logger.debug(`Livros concluídos encontrados: ${results.map(r => r.book_id).join(', ')}`);
      }

      return results;
    } catch (err) {
      this.logger.error(
        `Erro inesperado ao listar livros concluídos do perfil ${profileId}: ${err}`,
      );
      return [];
    }
  }

  async getFinishedRow(
    profileId: string,
    bookId: string,
  ): Promise<FinishedRow | null> {
    return this.fetchExistingRow(profileId, bookId);
  }

  private async fetchExistingRow(
    profileId: string,
    bookId: string,
  ): Promise<FinishedRow | null> {
    const query = () =>
      this.supabase
        .from('finished')
        .select('id, profileId, book_id, created_at')
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
            `Erro ao carregar finalização após deduplicação (user=${profileId}, book=${bookId}): ${retry.error.message}`,
          );
          return null;
        }
        data = retry.data;
      } else {
        this.logger.error(
          `Erro ao carregar finalização (user=${profileId}, book=${bookId}): ${error.message}`,
        );
        return null;
      }
    }

    return (data as FinishedRow | null) ?? null;
  }

  private async enforceSingleRow(
    profileId: string,
    bookId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('finished')
      .select('id, created_at')
      .eq('profileId', profileId)
      .eq('book_id', bookId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(
        `Erro ao verificar duplicatas (user=${profileId}, book=${bookId}): ${error.message}`,
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
      .from('finished')
      .delete()
      .in('id', idsToDelete);

    if (deleteError) {
      this.logger.error(
        `Erro ao remover duplicatas (user=${profileId}, book=${bookId}): ${deleteError.message}`,
      );
    } else {
      this.logger.warn(
        `🧹 Removidas ${idsToDelete.length} duplicatas de livros concluídos (user=${profileId}, book=${bookId}) - IDs: [${idsToDelete.join(', ')}]`,
      );
    }
  }

  private async enforceFinishedQuota(profileId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('finished')
        .select('id')
        .eq('profileId', profileId)
        .order('created_at', { ascending: false });

      if (error) {
        this.logger.error(
          `Erro ao aplicar limite de livros concluídos (user=${profileId}): ${error.message}`,
        );
        return;
      }

      if (!Array.isArray(data) || data.length <= this.MAX_FINISHED_BOOKS_PER_USER) {
        return;
      }

      const idsToDelete = data
        .slice(this.MAX_FINISHED_BOOKS_PER_USER)
        .map((row: any) => row?.id)
        .filter(
          (id): id is string | number =>
            typeof id === 'string' || typeof id === 'number',
        );

      if (idsToDelete.length === 0) {
        return;
      }

      const { error: deleteError } = await this.supabase
        .from('finished')
        .delete()
        .in('id', idsToDelete);

      if (deleteError) {
        this.logger.error(
          `Erro ao remover excedentes de livros concluídos (user=${profileId}): ${deleteError.message}`,
        );
      } else {
        this.logger.warn(
          `📚 Removidos ${idsToDelete.length} livros concluídos antigos por limite de quota (user=${profileId}) - Limite: ${this.MAX_FINISHED_BOOKS_PER_USER}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Erro inesperado ao aplicar limite de livros concluídos (user=${profileId}): ${err}`,
      );
    }
  }

  private async removeListeningProgress(profileId: string, bookId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('listening_progress')
        .delete()
        .eq('profileId', profileId)
        .eq('book_id', bookId)
        .select('id');

      if (error) {
        this.logger.error(
          `Erro ao remover progresso ao concluir livro (user=${profileId}, book=${bookId}): ${error.message}`,
        );
        return;
      }

      const removed = data?.length ?? 0;
      if (removed > 0) {
        this.logger.log(
          `🎧 Removidos ${removed} registros de progresso para o livro concluído (user=${profileId}, book=${bookId}).`,
        );
      } else {
        this.logger.debug(
          `Nenhum registro de progresso para remover após conclusão (user=${profileId}, book=${bookId}).`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Erro inesperado ao limpar progresso do livro concluído (user=${profileId}, book=${bookId}): ${err}`,
      );
    }
  }
}
