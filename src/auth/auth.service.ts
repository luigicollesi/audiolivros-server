// src/auth/auth.service.ts
import { Inject, Injectable, UnauthorizedException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SB_ADMIN } from '../supabase/module';
import { UsersService } from '../users/users.service';
import { base64UrlDecode } from '../common/utils/base64url';
import { generateOpaqueToken, hashToken, utcTimestampPlusMinutes } from '../common/utils/token';
import { ProfileDetails, ProfileDetailsService } from './profile-details.service';
import { PhoneVerificationService } from './phone-verification.service';

const SESSION_TTL_MINUTES = 2;

@Injectable()
export class AuthService {
  constructor(
    @Inject(SB_ADMIN) private readonly supabase: SupabaseClient,
    private readonly users: UsersService,
    private readonly profileDetails: ProfileDetailsService,
    private readonly phoneVerification: PhoneVerificationService,
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
    const nameClaim =
      (typeof claims.name === 'string' && claims.name.trim()) ||
      (typeof claims.given_name === 'string' && claims.given_name.trim()) ||
      null;
    const profileName =
      (typeof user.name === 'string' && user.name.trim()) || nameClaim;
    if (!providerSub) {
      throw new InternalServerErrorException('Identificador do provider ausente.');
    }
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
        { email, name: profileName, provider },
        { onConflict: 'email' },
      )
      .select('id')   // <- Aqui pedimos explicitamente o id
      .single();

    if (upsertErr) throw new InternalServerErrorException(`Falha ao salvar profile: ${upsertErr.message}`);

    const details = await this.profileDetails.getDetails(profile.id);

    if (!details || !details.phone) {
      const pending = await this.phoneVerification.createPending(profile.id, provider, providerSub);
      return {
        user: null,
        requiresPhone: true,
        pendingToken: pending.token,
        pendingTokenExpiresAt: pending.expiresAt,
      };
    }

    return this.issueSession(profile.id, provider, providerSub, details);
  }

  async verifySessionToken(tokenClear: string) {
    if (!tokenClear) throw new UnauthorizedException('Token ausente.');
    const tokenHash = hashToken(tokenClear);

    const { data: row, error } = await this.supabase
      .from('tokens')
      .select('provider, provider_sub, expires_at, revoked_at, profiles!inner(email)')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(`Falha ao consultar token: ${error.message}`);
    if (!row) throw new UnauthorizedException('Token inválido.');
    if (row.revoked_at) throw new UnauthorizedException('Token revogado.');
    if (!row.expires_at || new Date(row.expires_at) <= new Date()) {
      throw new UnauthorizedException('Token expirado.');
    }

    const related = (row as any).profiles;
    const email =
      Array.isArray(related) ? related[0]?.email ?? null : related?.email ?? null;

    return { email, provider: row.provider, providerSub: row.provider_sub };
  }

  async refreshSessionToken(tokenClear: string) {
    if (!tokenClear) throw new UnauthorizedException('Token ausente.');
    const tokenHash = hashToken(tokenClear);

    const { data: current, error } = await this.supabase
      .from('tokens')
      .select('id,user_id,provider,provider_sub,expires_at,revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(`Falha ao consultar token: ${error.message}`);
    if (!current) throw new UnauthorizedException('Token inválido.');
    if (current.revoked_at) throw new UnauthorizedException('Token revogado.');
    if (!current.expires_at || new Date(current.expires_at) <= new Date()) {
      throw new UnauthorizedException('Token expirado.');
    }

    const { clear: newTokenClear, hash: newTokenHash } = generateOpaqueToken(32);
    const issuedAt = new Date().toISOString();
    const expiresAt = await utcTimestampPlusMinutes(SESSION_TTL_MINUTES);

    const { error: insertErr } = await this.supabase.from('tokens').insert({
      user_id: current.user_id,
      token_hash: newTokenHash,
      provider: current.provider,
      provider_sub: current.provider_sub,
      issued_at: issuedAt,
      expires_at: expiresAt,
      revoked_at: null,
    });
    if (insertErr) throw new InternalServerErrorException(`Falha ao criar novo token: ${insertErr.message}`);

    this.scheduleTokenDeletion(String(current.id), 60_000);

    const details = await this.profileDetails.getDetails(String(current.user_id));
    if (!details || !details.phone) {
      throw new UnauthorizedException('Perfil incompleto.');
    }

    const profile = await this.loadProfileBasics(String(current.user_id));

    return {
      sessionToken: newTokenClear,
      expiresAt,
      user: {
        email: profile.email,
        name: profile.name,
        phone: details.phone,
        language: details.language,
        genre: details.genre,
      },
      requiresPhone: false,
    };
  }

  async requestPhoneVerification(input: { pendingToken: string; phone: string; machineCode: string; language?: string }) {
    return this.phoneVerification.requestCode(input);
  }

  async verifyPhoneCode(input: { pendingToken: string; machineCode: string; code: string }) {
    const result = await this.phoneVerification.verifyCode(input);
    return this.issueSession(result.profileId, result.provider, result.providerSub, result.details);
  }

  private async issueSession(profileId: string, provider: string, providerSub: string, details: ProfileDetails) {
    if (!details.phone) {
      throw new InternalServerErrorException('Telefone ausente nos detalhes do perfil.');
    }

    const profile = await this.loadProfileBasics(profileId);

    const { clear: tokenClear, hash: tokenHash } = generateOpaqueToken(32);
    const issuedAt = new Date().toISOString();
    const expiresAt = await utcTimestampPlusMinutes(SESSION_TTL_MINUTES);

    const { error } = await this.supabase.from('tokens').insert({
      user_id: profileId,
      token_hash: tokenHash,
      provider,
      provider_sub: providerSub,
      issued_at: issuedAt,
      expires_at: expiresAt,
      revoked_at: null,
    });
    if (error) throw new InternalServerErrorException(`Falha ao criar token: ${error.message}`);

    return {
      sessionToken: tokenClear,
      expiresAt,
      user: {
        email: profile.email,
        name: profile.name,
        phone: details.phone,
        language: details.language,
        genre: details.genre,
      },
      requiresPhone: false,
    };
  }

  private async loadProfileBasics(profileId: string) {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('email, name')
      .eq('id', profileId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(`Falha ao consultar perfil: ${error.message}`);
    if (!data) throw new InternalServerErrorException('Perfil não localizado.');

    return {
      email: data.email ?? null,
      name: data.name ?? null,
    };
  }

  private scheduleTokenDeletion(tokenId: string, delayMs: number) {
    const timer = setTimeout(async () => {
      try {
        const { error } = await this.supabase.from('tokens').delete().eq('id', tokenId);
        if (error) {
          console.error(`Falha ao apagar token ${tokenId}:`, error.message);
        }
      } catch (err) {
        console.error(`Erro inesperado ao apagar token ${tokenId}:`, err);
      }
    }, delayMs);

    if (typeof (timer as any)?.unref === 'function') {
      (timer as any).unref();
    }
  }
}
