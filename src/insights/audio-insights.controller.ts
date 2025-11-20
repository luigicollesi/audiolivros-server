import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AudioInsightsService } from './audio-insights.service';
import {
  InsightsLanguageQueryDto,
  InsightsTopBooksQueryDto,
} from './insights-query.dto';

interface SessionizedRequest extends Request {
  session?: {
    userId: string;
  };
}

@Controller('audio-insights')
export class AudioInsightsController {
  constructor(private readonly insights: AudioInsightsService) {}

  @Get('watched')
  async getWatchedHistory(
    @Req() req: SessionizedRequest,
    @Query() query: InsightsLanguageQueryDto,
  ) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const items = await this.insights.getUserFinishedHistory(
      profileId,
      query.languageId,
    );
    return {
      userId: profileId,
      languageId: query.languageId,
      total: items.length,
      items,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('listening')
  async getListeningQueue(
    @Req() req: SessionizedRequest,
    @Query() query: InsightsLanguageQueryDto,
  ) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const items = await this.insights.getUserListeningQueue(
      profileId,
      query.languageId,
    );
    return {
      userId: profileId,
      languageId: query.languageId,
      total: items.length,
      items,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('top-books')
  async getTopBooks(@Query() query: InsightsTopBooksQueryDto) {
    const parsedDays = query.days;
    const items = await this.insights.getTopFinishedBooks(
      query.languageId,
      parsedDays,
    );
    return {
      languageId: query.languageId,
      windowDays: parsedDays ?? undefined,
      total: items.length,
      items,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('recommendations')
  async getRecommendations(
    @Req() req: SessionizedRequest,
    @Query() query: InsightsLanguageQueryDto,
  ) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const { baseBookId, baseBookTitle, items } =
      await this.insights.getRecommendationsFromLatestFinished(
        profileId,
        query.languageId,
      );

    return {
      userId: profileId,
      languageId: query.languageId,
      baseBookId,
      baseBookTitle,
      total: items.length,
      items,
      timestamp: new Date().toISOString(),
    };
  }
}
