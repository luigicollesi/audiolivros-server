// src/auth/session.middleware.ts
import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';
import { hashToken } from '../common/utils/token';
import { extractBearerToken } from '../common/utils/bearer';

type SessionPayload = {
  userId: string;
  tokenId: string;
  provider: string;
  providerSub?: string;
  expiresAt: string;
};
interface SessionizedRequest extends Request {
  session?: SessionPayload;
}

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SessionMiddleware.name);

  constructor(@Inject(SUPABASE_CLIENT) private readonly sb: SupabaseClient) {}

  async use(req: SessionizedRequest, res: Response, next: NextFunction) {
    try {
      const tokenClear = extractBearerToken(req.headers['authorization']);
      if (!tokenClear) {
        this.logger.warn('Cabeçalho de autorização ausente ou malformado.');
        return res.status(401).json({ message: 'Token ausente.' });
      }

      const tokenHash = hashToken(tokenClear);

      const { data, error } = await this.sb
        .from('tokens')
        .select('id,user_id,provider,provider_sub,expires_at')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      if (error || !data) {
        this.logger.warn(
          `Token inválido ou expirado (hash=${tokenHash.slice(0, 8)}...).`,
        );
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
      }

      const provider = data.provider ? String(data.provider) : 'unknown';
      const providerSub = data.provider_sub
        ? String(data.provider_sub)
        : undefined;

      req.session = {
        userId: String(data.user_id),
        tokenId: String(data.id),
        provider,
        providerSub,
        expiresAt: String(data.expires_at),
      };

      this.logger.debug(
        `Usuário ${data.user_id} autenticado com provider ${provider}. tokenId=${data.id}`,
      );

      next();
    } catch (e) {
      this.logger.error(`Falha ao autenticar requisição: ${String(e)}`);
      return res.status(401).json({ message: 'Não autorizado.' });
    }
  }
}
