// src/audio/assets-stats.controller.ts
import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AssetAccessLoggerService } from './asset-access-logger.service';

interface SessionizedRequest extends Request {
  session?: {
    userId: string;
    tokenId: string;
    provider: string;
    providerSub?: string;
    expiresAt: string;
  };
}

@Controller('assets')
export class AssetsStatsController {
  constructor(private readonly accessLogger: AssetAccessLoggerService) {}

  @Get('stats')
  async getAccessStats(@Req() req: SessionizedRequest) {
    // Verificar se o usuário está autenticado
    const userId = req.session?.userId;
    if (!userId) {
      throw new UnauthorizedException(
        'Acesso negado. Faça login para ver estatísticas.',
      );
    }

    const stats = this.accessLogger.getUserAccessStats(userId);

    return {
      message: 'Estatísticas de acesso aos assets protegidos',
      data: stats,
      timestamp: new Date().toISOString(),
      user: userId,
    };
  }
}
