// src/auth/auth.service.ts
import { Inject, Injectable, UnauthorizedException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SB_ADMIN } from '../supabase/module';
import { UsersService } from '../users/users.service';
import { base64UrlDecode } from '../common/utils/base64url';
import { generateOpaqueToken, hashToken, addHoursIso } from '../common/utils/token';

@Injectable()
export class AuthService {
  constructor(
    @Inject(SB_ADMIN) private readonly supabase: SupabaseClient,
    private readonly users: UsersService,
  ) {}

  // === helpers ===
  private decodeIdTokenUnsafe(idToken: string): any {
    const parts = idToken.split('.');
    if (parts.length < 2) throw new BadRequestException('Formato de id_token inválido.');
    const payloadJson = base64UrlDecode(parts[1]);
    return JSON.parse(payloadJson);
  }

  async loginWithProvider(provider: string, idToken: string) {
    const normalizedProvider = String(provider).trim().toLowerCase();
    if (!normalizedProvider) {
      throw new BadRequestException('Provider ausente.');
    }
    switch (normalizedProvider) {
      case 'google':
        return this.googleLogin(idToken);
      default:
        throw new BadRequestException(`Provider ${provider} não suportado.`);
    }
  }

  async googleLogin(idToken: string) {
    // 1) claims (aqui simulado; no real, use this.users.verifyGoogleIdToken)
    const claims = this.decodeIdTokenUnsafe(idToken);
    if (!claims?.email || !claims?.sub) {
      throw new BadRequestException('Claims inválidas do Google.');
    }

    const user = await Promise.resolve(this.users.upsertFromGoogleClaims(claims));
    const email = String(user.email).toLowerCase();
    const provider = user.provider ?? 'google';
    const providerSub = user.providerSub ?? String(claims.sub ?? '');
    if (!providerSub) {
      throw new InternalServerErrorException('Identificador do provider ausente.');
    }
    const name = user.name ?? null;

    // 2) Checar se já existe um perfil com outro provider
    const { data: existingProfile, error: selectErr } = await this.supabase
      .from('profiles')
      .select('email, provider')
      .eq('email', email)
      .maybeSingle();

    if (selectErr) throw new InternalServerErrorException(`Falha ao consultar profiles: ${selectErr.message}`);

    if (existingProfile && existingProfile.provider !== provider) {
      throw new UnauthorizedException('esse email está registrad com outro provider.');
    }

    // 3) Upsert do profile (idempotente)
    const { data: profile, error: upsertErr } = await this.supabase
      .from('profiles')
      .upsert(
        { email, name, provider },
        { onConflict: 'email' },
      )
      .select('id')   // <- Aqui pedimos explicitamente o id
      .single();

    if (upsertErr) throw new InternalServerErrorException(`Falha ao salvar profile: ${upsertErr.message}`);

    // 4) Gerar token opaco, salvar hash em `tokens`
    const { clear: tokenClear, hash: tokenHash } = generateOpaqueToken(32);
    const issuedAt = new Date().toISOString();
    const expiresAt = addHoursIso(1);

    const { error: tokErr } = await this.supabase.from('tokens').insert({
      user_id: profile.id,
      token_hash: tokenHash,
      provider,
      provider_sub: providerSub,
      issued_at: issuedAt,
      expires_at: expiresAt,
      revoked_at: null,
    });
    if (tokErr) throw new InternalServerErrorException(`Falha ao criar token: ${tokErr.message}`);

    // 5) Retorno ao front
    return {
      sessionToken: tokenClear,
      expiresAt: expiresAt,
      user: { email, name },
    };
  }

  async verifySessionToken(tokenClear: string) {
    if (!tokenClear) throw new UnauthorizedException('Token ausente.');
    const tokenHash = hashToken(tokenClear);

    const { data: row, error } = await this.supabase
      .from('tokens')
      .select('email, provider, provider_sub, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(`Falha ao consultar token: ${error.message}`);
    if (!row) throw new UnauthorizedException('Token inválido.');
    if (row.revoked_at) throw new UnauthorizedException('Token revogado.');
    if (!row.expires_at || new Date(row.expires_at) <= new Date()) {
      throw new UnauthorizedException('Token expirado.');
    }

    return { email: row.email, provider: row.provider, providerSub: row.provider_sub };
  }
}
