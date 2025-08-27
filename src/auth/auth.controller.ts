import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleIdTokenDto } from './dto/google-idtoken.dto';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  // POST /auth/google/id-token
  // Recebe { id_token } do front, valida/normaliza no serviço,
  // bloqueia email com provider diferente, gera token opaco,
  // grava hash em `tokens` e retorna { token, expiresAt, user }
  @Post('google/id-token')
  async googleIdToken(@Body() body: GoogleIdTokenDto) {
    try {
      if (!body?.id_token) {
        throw new HttpException(
          { message: 'id_token ausente' },
          HttpStatus.BAD_REQUEST,
        );
      }
      const result = await this.auth.googleLogin(body.id_token);
      return result;
    } catch (e: any) {
      // mantém a mensagem que você pediu quando for provider diferente
      const message = e?.message ?? 'Falha ao efetuar login com Google';
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
  async me(@Headers('authorization') authz?: string) {
    try {
      const header = authz ?? '';
      const hasBearer = header.toLowerCase().startsWith('bearer ');
      if (!hasBearer) {
        throw new HttpException(
          { message: 'Token ausente.' },
          HttpStatus.UNAUTHORIZED,
        );
      }
      const token = header.slice('Bearer '.length);

      // valida token opaco -> { email, provider }
      const { email, provider } = await this.auth.verifySessionToken(token);

      // Busca perfil por email (idealmente via Supabase, implementado no UsersService)
      const user = await this.users.getByEmail(email);
      if (!user) {
        // fallback: ainda assim devolve email/provider válidos
        return { email, provider, name: null };
      }

      return {
        email: user.email,
        name: user.name ?? null,
      };
    } catch (e: any) {
      const message = e?.message ?? 'Token inválido';
      const status =
        e?.status && Number.isInteger(e.status)
          ? e.status
          : HttpStatus.UNAUTHORIZED;
      throw new HttpException({ message }, status);
    }
  }
}
