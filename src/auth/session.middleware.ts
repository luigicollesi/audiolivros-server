// src/auth/session.middleware.ts
import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';
import { hashToken } from '../common/utils/token';
import { extractBearerToken } from '../common/utils/bearer';
import { DuplicateRequestDetectorService } from './duplicate-request-detector.service';
import { DuplicateRequestStatsService } from './duplicate-request-stats.service';

type SessionPayload = {
  userId: string;
  tokenId: string;
  provider: string;
  providerSub?: string;
  expiresAt: string;
  permission: boolean;
};

interface SessionizedRequest extends Request {
  session?: SessionPayload;
}

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SessionMiddleware.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly sb: SupabaseClient,
    private readonly duplicateDetector: DuplicateRequestDetectorService,
    private readonly duplicateStats: DuplicateRequestStatsService,
  ) {}

  async use(req: SessionizedRequest, res: Response, next: NextFunction) {
    try {
      const { token: tokenClear, source } = this.extractTokenFromRequest(req);
      const isAuthFlowRoute = this.isAuthFlowRoute(req);
      if (!tokenClear) {
        this.logger.warn('Token ausente (header/query/cookie).');
        return res.status(401).json({ message: 'Token ausente.' });
      }

      if (!req.headers['authorization']) {
        req.headers['authorization'] = `Bearer ${tokenClear}`;
      }

      const tokenHash = hashToken(tokenClear);

      const shouldEnforceDuplicateGuard =
        !this.isSafeMethod(req.method) && !isAuthFlowRoute;
      let cleanup: () => void = () => {};

      if (shouldEnforceDuplicateGuard) {
        const isDuplicate = this.duplicateDetector.checkDuplicateRequest(
          req,
          tokenClear,
        );
        if (isDuplicate) {
          this.duplicateStats.recordDuplicateRequest({
            method: req.method,
            url: req.url,
            userAgent: req.headers['user-agent'],
            ip: req.ip || req.connection?.remoteAddress,
          });

          this.logger.warn(
            `Requisição duplicada detectada: ${req.method} ${req.url} - token: ${tokenHash.slice(
              0,
              8,
            )}...`,
          );
          return res.status(429).json({
            message:
              'Requisição duplicada detectada. Aguarde a conclusão da requisição anterior.',
            code: 'DUPLICATE_REQUEST',
          });
        }

        cleanup = this.duplicateDetector.registerRequest(req, tokenClear);

        const originalSend = res.send.bind(res);
        const originalJson = res.json.bind(res);
        const originalEnd = res.end.bind(res);

        res.send = function (body?: any) {
          cleanup();
          return originalSend(body);
        };

        res.json = function (body?: any) {
          cleanup();
          return originalJson(body);
        };

        res.end = function (chunk?: any, encoding?: any) {
          cleanup();
          return originalEnd(chunk, encoding);
        };
      }

      // Handle errors and cleanup
      const handleError = (message: string, statusCode = 401) => {
        cleanup();
        return res.status(statusCode).json({ message });
      };

      const { data, error } = await this.sb
        .from('tokens')
        .select('id,user_id,provider,provider_sub,expires_at,permission')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      if (error || !data) {
        this.logger.warn(
          `Token inválido ou expirado (hash=${tokenHash.slice(0, 8)}...).`,
        );
        return handleError('Token inválido ou expirado.');
      }

      const provider = data.provider ? String(data.provider) : 'unknown';
      const providerSub = data.provider_sub
        ? String(data.provider_sub)
        : undefined;

      const permission = Boolean((data as any)?.permission);

      if (!permission && !isAuthFlowRoute) {
        this.logger.warn(
          `Token ${data.id} sem permissão tentou acessar rota ${req.method} ${req.originalUrl}`,
        );
        return handleError('Permissão insuficiente.', 403);
      }

      req.session = {
        userId: String(data.user_id),
        tokenId: String(data.id),
        provider,
        providerSub,
        expiresAt: String(data.expires_at),
        permission,
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

  private extractTokenFromRequest(
    req: Request,
  ): { token: string | null; source: 'header' | 'query' | 'cookie' | null } {
    const headerToken = extractBearerToken(req.headers['authorization']);
    if (headerToken) {
      return { token: headerToken, source: 'header' };
    }

    const queryObj = req.query as Record<string, unknown>;
    const queryToken =
      this.normalizeToken(this.pickFirstString(queryObj?.token)) ??
      this.normalizeToken(this.pickFirstString(queryObj?.access_token)) ??
      this.normalizeToken(this.pickFirstString(queryObj?.auth_token));

    if (queryToken) {
      return { token: queryToken, source: 'query' };
    }

    const cookieHeader = req.headers['cookie'];
    if (cookieHeader && typeof cookieHeader === 'string') {
      const cookieToken = this.extractTokenFromCookie(cookieHeader);
      if (cookieToken) {
        return { token: cookieToken, source: 'cookie' };
      }
    }

    return { token: null, source: null };
  }

  private pickFirstString(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string');
      return (first as string | undefined) ?? null;
    }
    if (typeof value === 'object') {
      const maybeValue = (value as any).toString?.();
      if (typeof maybeValue === 'string') {
        return maybeValue;
      }
    }
    return null;
  }

  private normalizeToken(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const withoutBearer = trimmed.replace(/^Bearer\s+/i, '').trim();
    if (!withoutBearer) return null;
    const lowered = withoutBearer.toLowerCase();
    if (lowered === 'undefined' || lowered === 'null') return null;
    return withoutBearer;
  }

  private extractTokenFromCookie(cookieHeader: string): string | null {
    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
      const [key, ...rest] = pair.split('=');
      if (!key || rest.length === 0) continue;
      const normalizedKey = key.trim().toLowerCase();
      if (
        normalizedKey === 'token' ||
        normalizedKey === 'access_token' ||
        normalizedKey === 'auth_token'
      ) {
        const value = rest.join('=');
        return this.normalizeToken(value);
      }
    }
    return null;
  }

  private isSafeMethod(method: string | undefined): boolean {
    if (!method) return false;
    const upper = method.toUpperCase();
    return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
  }

  private isAuthFlowRoute(req: Request): boolean {
    const path =
      (req.baseUrl ? `${req.baseUrl}${req.path}` : req.path) || req.originalUrl;
    if (!path) return false;
    const normalized = path.toLowerCase();
    return (
      normalized.startsWith('/auth/email') ||
      normalized.startsWith('/auth/phone') ||
      normalized.startsWith('/auth/terms')
    );
  }
}
