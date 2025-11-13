import {
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Req,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  FinishedBooksService,
  MarkFinishedResult,
} from './finished-books.service';

interface SessionizedRequest extends Request {
  session?: {
    userId: string;
  };
}

@Controller('finished-books')
export class FinishedBooksController {
  private readonly logger = new Logger(FinishedBooksController.name);

  constructor(private readonly finishedBooks: FinishedBooksService) {}

  @Put(':bookId')
  async markFinished(
    @Req() req: SessionizedRequest,
    @Param('bookId') bookId: string,
  ) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    this.logger.debug(`🎯 PUT /finished-books/${bookId} - User: ${profileId} - Iniciando marcação como concluído`);

    const result: MarkFinishedResult =
      await this.finishedBooks.markAsFinished(profileId, bookId);

    this.logger.log(`📖 Resultado da marcação como concluído - User: ${profileId}, Book: ${bookId}, Success: ${result.persisted}${result.reason ? `, Reason: ${result.reason}` : ''}`);
    
    // Debug detalhado
    if (!result.persisted) {
      this.logger.debug(`Marcação falhou:`, {
        profileId,
        bookId,
        reason: result.reason,
        alreadyFinished: result.alreadyFinished
      });
    }

    return {
      message: result.persisted
        ? 'Livro marcado como concluído'
        : result.reason ?? 'Livro não foi marcado como concluído',
      persisted: result.persisted,
      alreadyFinished: result.alreadyFinished ?? false,
      bookId: result.bookId ?? bookId,
      timestamp: new Date().toISOString(),
    };
  }

  @Delete(':bookId')
  async unmarkFinished(
    @Req() req: SessionizedRequest,
    @Param('bookId') bookId: string,
  ) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    this.logger.debug(`🗑️ DELETE /finished-books/${bookId} - User: ${profileId} - Iniciando remoção da lista de concluídos`);

    const result = await this.finishedBooks.unmarkFinished(profileId, bookId);

    this.logger.log(`📚 Resultado da remoção - User: ${profileId}, Book: ${bookId}, Removed: ${result.removed}`);

    return {
      message: result.removed
        ? 'Livro removido da lista de concluídos'
        : 'Nenhum registro de conclusão encontrado',
      removed: result.removed,
      bookId: result.bookId ?? bookId,
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  async listFinished(@Req() req: SessionizedRequest) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    this.logger.debug(`📚 GET /finished-books - User: ${profileId} - Listando livros concluídos`);

    const items = await this.finishedBooks.listFinished(profileId);

    const mapped = items.map((row) => ({
      bookId: row.book_id,
      finishedAt: row.created_at ?? null,
    }));

    this.logger.log(`📋 Lista de livros concluídos - User: ${profileId}, Total: ${mapped.length}${mapped.length > 0 ? `, Books: [${mapped.map(item => item.bookId).join(', ')}]` : ''}`);

    return {
      userId: profileId,
      total: mapped.length,
      items: mapped,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':bookId')
  async getFinished(
    @Req() req: SessionizedRequest,
    @Param('bookId') bookId: string,
  ) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    this.logger.debug(`🔍 GET /finished-books/${bookId} - User: ${profileId} - Verificando status de conclusão`);

    const row = await this.finishedBooks.getFinishedRow(profileId, bookId);

    this.logger.log(`📖 Status de conclusão - User: ${profileId}, Book: ${bookId}, Finished: ${Boolean(row)}${row?.created_at ? `, FinishedAt: ${row.created_at}` : ''}`);

    return {
      bookId,
      finished: Boolean(row),
      finishedAt: row?.created_at ?? null,
      timestamp: new Date().toISOString(),
    };
  }
}
