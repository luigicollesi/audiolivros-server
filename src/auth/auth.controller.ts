// src/auth/auth.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { ProviderIdTokenDto } from './dto/provider-idtoken.dto';
import { UsersService } from '../users/users.service';

interface SessionizedRequest extends Request {
  session?: { userId: string; tokenId: string; provider: string; providerSub?: string; expiresAt: string };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  // POST /auth/id-token
  // Recebe { provider, id_token } do front, valida/normaliza no serviço,
  // bloqueia email com provider diferente, gera token opaco,
  // grava hash em `tokens` e retorna { token, expiresAt, user }
  @Post('id-token')
  async exchangeIdToken(@Body() body: ProviderIdTokenDto) {
    try {
      if (!body?.id_token) {
        throw new HttpException(
          { message: 'id_token ausente' },
          HttpStatus.BAD_REQUEST,
        );
      }
      const result = await this.auth.loginWithProvider(body.provider, body.id_token);
      return result;
    } catch (e: any) {
      // mantém a mensagem que você pediu quando for provider diferente
      const providerLabel = body?.provider ? String(body.provider).trim() : 'desconhecido';
      const fallbackMessage = `Falha ao efetuar login com provider ${providerLabel}`;
      const message = e?.message ?? fallbackMessage;
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      throw new HttpException({ message }, status);
    }
  }

  // GET /auth/me
  // Lê o Bearer token (opaco), valida contra tabela `tokens`,
  // e retorna o perfil do usuário.
  @Get('me')
  async me(@Req() req: SessionizedRequest) {
    try {
      if (!req.session?.userId) {
        throw new HttpException({ message: 'Não autorizado.' }, HttpStatus.UNAUTHORIZED);
      }

      const user = await this.users.getById(req.session.userId);
      // fallback simples, caso você ainda não tenha getById:
      // const user = await this.users.getByTokenId(req.session.tokenId);

      if (!user) {
        return { userId: req.session.userId, name: null, email: null };
      }

      return {
        userId: user.id,
        email: user.email ?? null,
        name: user.name ?? null,
      };
    } catch {
      throw new HttpException({ message: 'Não autorizado.' }, HttpStatus.UNAUTHORIZED);
    }
  }
}
