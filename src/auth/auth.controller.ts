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
import { PhoneVerificationRequestDto } from './dto/phone-verification-request.dto';
import { PhoneVerificationConfirmDto } from './dto/phone-verification-confirm.dto';
import { EmailLoginDto } from './dto/email-login.dto';
import { EmailRequestCodeDto } from './dto/email-request.dto';
import { EmailVerifyCodeDto } from './dto/email-verify.dto';
import { EmailRegisterDto } from './dto/email-register.dto';
import { EmailResetRequestDto } from './dto/email-reset-request.dto';
import { EmailResetVerifyDto } from './dto/email-reset-code.dto';
import { EmailResetPasswordDto } from './dto/email-reset-password.dto';
import { AcceptTermsDto } from './dto/accept-terms.dto';
import { UsersService } from '../users/users.service';
import { extractBearerToken } from '../common/utils/bearer';
import { DuplicateRequestStatsService } from './duplicate-request-stats.service';

interface SessionizedRequest extends Request {
  session?: {
    userId: string;
    tokenId: string;
    provider: string;
    providerSub?: string;
    expiresAt: string;
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly duplicateStats: DuplicateRequestStatsService,
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
      const result = await this.auth.loginWithProvider(
        body.provider,
        body.id_token,
      );
      return result;
    } catch (e: any) {
      // mantém a mensagem que você pediu quando for provider diferente
      const providerLabel = body?.provider
        ? String(body.provider).trim()
        : 'desconhecido';
      const fallbackMessage = `Falha ao efetuar login com provider ${providerLabel}`;
      const message = e?.message ?? fallbackMessage;
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      throw new HttpException({ message }, status);
    }
  }

  @Post('email/login')
  async loginWithEmail(@Body() body: EmailLoginDto) {
    try {
      return await this.auth.loginWithEmail(body.email, body.password);
    } catch (e: any) {
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      const message = e?.message ?? 'Falha ao autenticar com email/senha.';
      throw new HttpException({ message }, status);
    }
  }

  @Post('email/request-code')
  async requestEmailCode(@Body() body: EmailRequestCodeDto) {
    try {
      return await this.auth.requestEmailRegistration(body.email);
    } catch (e: any) {
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      const message = e?.message ?? 'Falha ao iniciar verificação por email.';
      throw new HttpException({ message }, status);
    }
  }

  @Post('email/verify-code')
  async verifyEmailCode(@Body() body: EmailVerifyCodeDto) {
    try {
      return await this.auth.verifyEmailRegistration(
        body.pendingToken,
        body.code,
      );
    } catch (e: any) {
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      const message = e?.message ?? 'Código inválido.';
      throw new HttpException({ message }, status);
    }
  }

  @Post('email/register')
  async registerEmail(@Body() body: EmailRegisterDto) {
    try {
      return await this.auth.completeEmailRegistration(body);
    } catch (e: any) {
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      const message = e?.message ?? 'Falha ao concluir cadastro.';
      throw new HttpException({ message }, status);
    }
  }

  @Post('email/reset/request')
  async requestReset(@Body() body: EmailResetRequestDto) {
    try {
      return await this.auth.requestPasswordReset(body.email);
    } catch (e: any) {
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      const message = e?.message ?? 'Falha ao iniciar redefinição de senha.';
      throw new HttpException({ message }, status);
    }
  }

  @Post('email/reset/verify')
  async verifyReset(@Body() body: EmailResetVerifyDto) {
    try {
      return await this.auth.verifyPasswordReset(body.pendingToken, body.code);
    } catch (e: any) {
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      const message = e?.message ?? 'Código inválido.';
      throw new HttpException({ message }, status);
    }
  }

  @Post('email/reset/confirm')
  async confirmReset(@Body() body: EmailResetPasswordDto) {
    try {
      return await this.auth.completePasswordReset(body);
    } catch (e: any) {
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      const message = e?.message ?? 'Falha ao redefinir senha.';
      throw new HttpException({ message }, status);
    }
  }

  @Post('token/refresh')
  async refreshToken(@Req() req: SessionizedRequest) {
    try {
      const tokenClear = extractBearerToken(req.headers?.authorization);
      if (!tokenClear) {
        throw new HttpException(
          { message: 'Token ausente.' },
          HttpStatus.UNAUTHORIZED,
        );
      }
      const result = await this.auth.refreshSessionToken(tokenClear);
      return result;
    } catch (e: any) {
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      const message = e?.message ?? 'Falha ao renovar sessão.';
      throw new HttpException({ message }, status);
    }
  }

  @Post('terms/accept')
  async acceptTerms(@Body() body: AcceptTermsDto) {
    try {
      return await this.auth.acceptTerms(body.pendingToken);
    } catch (e: any) {
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      const message = e?.message ?? 'Falha ao aceitar termos.';
      throw new HttpException({ message }, status);
    }
  }

  @Post('phone/request-code')
  async requestPhoneCode(@Body() body: PhoneVerificationRequestDto) {
    try {
      const result = await this.auth.requestPhoneVerification(body);
      return result;
    } catch (e: any) {
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      const message = e?.message ?? 'Falha ao iniciar verificação.';
      throw new HttpException({ message }, status);
    }
  }

  @Post('phone/verify-code')
  async verifyPhoneCode(@Body() body: PhoneVerificationConfirmDto) {
    try {
      const result = await this.auth.verifyPhoneCode(body);
      return result;
    } catch (e: any) {
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.BAD_REQUEST;
      const message = e?.message ?? 'Código inválido.';
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
        throw new HttpException(
          { message: 'Não autorizado.' },
          HttpStatus.UNAUTHORIZED,
        );
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
      throw new HttpException(
        { message: 'Não autorizado.' },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  // GET /auth/duplicate-stats
  // Endpoint para monitoramento das estatísticas de requisições duplicadas
  @Get('duplicate-stats')
  async getDuplicateStats(@Req() req: SessionizedRequest) {
    // Verificar se o usuário tem permissão (pode ser expandido para verificar roles)
    if (!req.session?.userId) {
      throw new HttpException(
        { message: 'Não autorizado.' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const stats = this.duplicateStats.getStats();
      return {
        message: 'Estatísticas de requisições duplicadas',
        data: stats,
        timestamp: new Date().toISOString(),
      };
    } catch (e: any) {
      throw new HttpException(
        { message: 'Erro ao recuperar estatísticas.' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
