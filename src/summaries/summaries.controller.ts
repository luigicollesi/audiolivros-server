// src/summaries/summaries.controller.ts
import {
  ConflictException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SummariesService } from './summaries.service';
import { GetSummaryDto } from './dto/get-summary.dto';
import { FavoritesService } from '../favorites/favorites.service';
import { ListeningProgressService } from '../audio/listening-progress.service';

interface SessionizedRequest extends Request {
  session?: {
    userId: string;
  };
}

@Controller('summaries')
export class SummariesController {
  constructor(
    private readonly summaries: SummariesService,
    private readonly favorites: FavoritesService,
    private readonly listeningProgress: ListeningProgressService,
  ) {}

  private readonly logger = new Logger(SummariesController.name);

  // GET /summaries?title=O%20Pr%C3%ADncipe&language=pt-BR
  @Get()
  async getByTitleAndLanguage(
    @Req() req: SessionizedRequest,
    @Query() q: GetSummaryDto,
  ) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const items = await this.summaries.findByTitleAndLanguage(
      q.title,
      q.language,
    );

    if (items.length === 0) {
      throw new NotFoundException(
        `Nenhum summary encontrado para "${q.title}" em ${q.language}.`,
      );
    }
    if (items.length > 1) {
      throw new ConflictException(
        `Foram encontrados ${items.length} summaries para "${q.title}" em ${q.language}. Era esperado apenas 1.`,
      );
    }

    const summary = items[0];
    const favorite = await this.favorites.isFavorite(profileId, summary.bookId);

    const listeningProgress = await this.listeningProgress.getListeningProgress(
      profileId,
      summary.bookId,
    );

    const response = {
      audio_url: summary.audio_url,
      summary: summary.summary,
      favorite,
      bookId: summary.bookId,
      listeningProgress,
    };

    this.logger.debug(
      `Resumo recuperado para "${q.title}" (${q.language}) - favorito=${favorite}.`,
    );

    return response;
  }
}
