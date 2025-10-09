// src/auth/session.middleware.ts
import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';
import { hashToken } from '../common/utils/token';
import { extractBearerToken } from '../common/utils/bearer';

type SessionPayload = { userId: string; tokenId: string; provider: string; providerSub?: string; expiresAt: string };
interface SessionizedRequest extends Request { session?: SessionPayload; }

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(@Inject(SUPABASE_CLIENT) private readonly sb: SupabaseClient) {}

  async use(req: SessionizedRequest, res: Response, next: NextFunction) {
    try {
      const tokenClear = extractBearerToken(req.headers['authorization']);
      if (!tokenClear) {
        // console.debug('Auth: header ausente/malformado:', JSON.stringify(req.headers['authorization']));
        return res.status(401).json({ message: 'Token ausente.' });
      }

      const tokenHash = hashToken(tokenClear);

      const { data, error } = await this.sb
        .from('tokens')
        .select('id,user_id,provider,provider_sub,expires_at')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      if (error || !data) {
        // console.debug('Auth: token não encontrado/expirado. hash=', tokenHash.slice(0,8));
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
      }

      const provider = data.provider ? String(data.provider) : 'unknown';
      const providerSub = data.provider_sub ? String(data.provider_sub) : undefined;

      req.session = {
        userId: String(data.user_id),
        tokenId: String(data.id),
        provider,
        providerSub,
        expiresAt: String(data.expires_at),
      };

      console.log(`Auth: user ${data.user_id} (${provider}) autenticado. tokenId=${data.id}, expira em ${data.expires_at}`);

      next();
    } catch (e) {
      // console.error('Auth error:', e);
      return res.status(401).json({ message: 'Não autorizado.' });
    }
  }
}
