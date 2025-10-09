// src/auth/session.middleware.ts
import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';
import * as crypto from 'crypto';

type SessionPayload = { userId: string; tokenId: string; expiresAt: string };
interface SessionizedRequest extends Request { session?: SessionPayload; }

function hashToken(clear: string): string {
  return crypto.createHash('sha256').update(clear, 'utf8').digest('base64');
}

// Regex: "Bearer <qualquer coisa>" com espaços extras permitido; case-insensitive
const BEARER_RE = /^Bearer\s+(.+)$/i;

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(@Inject(SUPABASE_CLIENT) private readonly sb: SupabaseClient) {}

  async use(req: SessionizedRequest, res: Response, next: NextFunction) {
    try {
      const raw = req.headers['authorization'];
      const header = Array.isArray(raw) ? raw[0] : raw || '';

      const match = header.match(BEARER_RE);
      if (!match) {
        // console.debug('Auth: header ausente/malformado:', JSON.stringify(header));
        return res.status(401).json({ message: 'Token ausente.' });
      }

      // Normaliza: remove espaços, tabs, quebras e aspas acidentais
      const tokenClear = match[1].trim().replace(/^"|"$/g, '');
      if (!tokenClear || tokenClear.toLowerCase() === 'undefined' || tokenClear.toLowerCase() === 'null') {
        return res.status(401).json({ message: 'Token ausente.' });
      }

      const tokenHash = hashToken(tokenClear);
      console.log(`Bearer ${String(tokenClear).trim()}`);
      const nowIso = new Date().toISOString();

      const { data, error } = await this.sb
        .from('tokens')
        .select('id,user_id,expires_at')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      if (error || !data) {
        // console.debug('Auth: token não encontrado/expirado. hash=', tokenHash.slice(0,8));
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
      }

      req.session = {
        userId: String(data.user_id),
        tokenId: String(data.id),
        expiresAt: String(data.expires_at),
      };

      console.log(`Auth: user ${data.user_id} autenticado com token ${data.id} (expira em ${data.expires_at})`);

      next();
    } catch (e) {
      // console.error('Auth error:', e);
      return res.status(401).json({ message: 'Não autorizado.' });
    }
  }
}
