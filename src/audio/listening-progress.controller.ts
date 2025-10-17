// src/audio/listening-progress.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ListeningProgressService } from './listening-progress.service';

interface SessionizedRequest extends Request {
  session?: {
    userId: string;
    tokenId: string;
    provider: string;
    providerSub?: string;
    expiresAt: string;
  };
}

interface ReportProgressDto {
  positionSeconds: number;
  durationSeconds?: number;
  audioFileName?: string;
  progressPercent?: number;
  force?: boolean;
  source?: string;
  bookId?: string;
}

@Controller('listening-progress')
export class ListeningProgressController {
  constructor(private readonly listeningProgress: ListeningProgressService) {}

  /**
   * Endpoint recomendado: cliente envia batidas periódicas ou eventos (pause/stop)
   * informando a posição atual do áudio.
   */
  @Put(':bookId')
  async upsertProgress(
    @Req() req: SessionizedRequest,
    @Param('bookId') bookId: string,
    @Body() body: ReportProgressDto,
  ) {
    const userId = req.session?.userId;
    if (!userId) {
      throw new UnauthorizedException(
        'Acesso negado. Faça login para atualizar progresso.',
      );
    }

    const result = await this.listeningProgress.reportProgress(userId, {
      bookId,
      positionSeconds: body.positionSeconds,
      durationSeconds: body.durationSeconds,
      audioFileName: body.audioFileName,
      progressPercent: body.progressPercent,
      force: body.force,
      source: body.source ?? 'client-put',
    });

    return {
      message: result.persisted
        ? 'Progresso salvo com sucesso'
        : result.reason ?? 'Progresso não persistido',
      persisted: result.persisted,
      progressPercent: result.progressPercent,
      bookId: result.bookId ?? bookId,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Endpoint legado para compatibilidade até que o app seja migrado.
   * Internamente, delega para o fluxo consolidado de save.
   */
  @Post('update')
  async legacyUpdateProgress(
    @Req() req: SessionizedRequest,
    @Body()
    body: {
      audioFileName: string;
      currentPosition: number;
      duration?: number;
      bookId?: string;
      forceSave?: boolean;
      autoPersist?: boolean;
    },
  ) {
    const userId = req.session?.userId;
    if (!userId) {
      throw new UnauthorizedException(
        'Acesso negado. Faça login para atualizar progresso.',
      );
    }

    const result = await this.listeningProgress.reportProgress(userId, {
      bookId: body.bookId,
      audioFileName: body.audioFileName,
      positionSeconds: body.currentPosition,
      durationSeconds: body.duration,
      force: body.forceSave,
      source: 'legacy-update',
    });

    return {
      message: result.persisted
        ? 'Progresso atualizado com sucesso'
        : result.reason ?? 'Progresso não persistido',
      persisted: result.persisted,
      progressPercent: result.progressPercent,
      bookId: result.bookId ?? body.bookId,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Evento de encerramento explícito para clientes que ainda o utilizam.
   * Usa reportProgress com force=true para garantir persistência.
   */
  @Post('end-session')
  async endSession(
    @Req() req: SessionizedRequest,
    @Body()
    body: {
      audioFileName?: string;
      bookId?: string;
      positionSeconds?: number;
      durationSeconds?: number;
    },
  ) {
    const userId = req.session?.userId;
    if (!userId) {
      throw new UnauthorizedException('Acesso negado.');
    }

    const result = await this.listeningProgress.reportProgress(userId, {
      bookId: body.bookId,
      audioFileName: body.audioFileName,
      positionSeconds: body.positionSeconds ?? 0,
      durationSeconds: body.durationSeconds,
      force: true,
      source: 'manual-end-session',
    });

    return {
      message: result.persisted
        ? 'Sessão finalizada e progresso salvo'
        : result.reason ?? 'Sessão finalizada',
      persisted: result.persisted,
      bookId: result.bookId ?? body.bookId,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('book/:bookId')
  async getBookProgress(
    @Req() req: SessionizedRequest,
    @Param('bookId') bookId: string,
  ) {
    const userId = req.session?.userId;
    if (!userId) {
      throw new UnauthorizedException('Acesso negado.');
    }

    const progress = await this.listeningProgress.getListeningProgress(
      userId,
      bookId,
    );

    return {
      bookId,
      progress,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('user')
  async getUserProgress(@Req() req: SessionizedRequest) {
    const userId = req.session?.userId;
    if (!userId) {
      throw new UnauthorizedException('Acesso negado.');
    }

    const progressList =
      await this.listeningProgress.getUserListeningProgress(userId);

    return {
      userId,
      totalBooks: progressList.length,
      progress: progressList,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('active-sessions')
  async getRecentSessions(@Req() req: SessionizedRequest) {
    const userId = req.session?.userId;
    if (!userId) {
      throw new UnauthorizedException('Acesso negado.');
    }

    const snapshots =
      await this.listeningProgress.getRecentProgressSnapshots(userId);

    return {
      userId,
      sessions: snapshots,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('force-save/:bookId')
  async forceSaveProgress(
    @Req() req: SessionizedRequest,
    @Param('bookId') bookId: string,
  ) {
    const userId = req.session?.userId;
    if (!userId) {
      throw new UnauthorizedException('Acesso negado.');
    }

    const result = await this.listeningProgress.reportProgress(userId, {
      bookId,
      positionSeconds: 0,
      force: true,
      source: 'force-save',
    });

    return {
      message: result.persisted
        ? 'Progresso salvo forçadamente'
        : result.reason ?? 'Nenhum progresso salvo',
      bookId,
      timestamp: new Date().toISOString(),
    };
  }
}
