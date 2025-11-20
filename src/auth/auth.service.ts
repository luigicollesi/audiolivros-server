// src/auth/auth.service.ts
import {
  Inject,
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SB_ADMIN } from '../supabase/module';
import { UsersService } from '../users/users.service';
import { base64UrlDecode } from '../common/utils/base64url';
import {
  generateOpaqueToken,
  hashToken,
  utcTimestampPlusMinutes,
} from '../common/utils/token';
import {
  ProfileDetails,
  ProfileDetailsService,
} from './profile-details.service';
import { PhoneVerificationService } from './phone-verification.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordsService } from './passwords.service';
import { TermsAcceptanceService } from './terms-acceptance.service';

const SESSION_TTL_MINUTES = 60;
const AUTH_FLOW_TTL_MINUTES = 5;
type ExternalProvider = 'google' | 'apple' | 'microsoft';
const PROVIDER_NAME_FIELDS: Record<ExternalProvider, string[]> = {
  google: ['name', 'given_name'],
  apple: ['name'],
  microsoft: ['name'],
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(SB_ADMIN) private readonly supabase: SupabaseClient,
    private readonly users: UsersService,
    private readonly profileDetails: ProfileDetailsService,
    private readonly phoneVerification: PhoneVerificationService,
    private readonly emailVerification: EmailVerificationService,
    private readonly passwords: PasswordsService,
    private readonly termsAcceptance: TermsAcceptanceService,
  ) {}

  // === helpers ===
  private decodeIdTokenUnsafe(idToken: string, provider?: string): any {
    const parts = idToken.split('.');
    if (parts.length < 2)
      throw new BadRequestException('Formato de id_token inválido.');
    const payloadJson = base64UrlDecode(parts[1]);
    try {
      return JSON.parse(payloadJson);
    } catch (err) {
      const trimmed = payloadJson.trim();
      const lastBrace = trimmed.lastIndexOf('}');
      if (lastBrace >= 0) {
        const candidate = trimmed.slice(0, lastBrace + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          // segue para erro padrão
        }
      }
      const label = provider ? ` do ${provider}` : '';
      throw new BadRequestException(
        `Claims inválidas${label}: formato JSON inesperado.`,
      );
    }
  }

  async loginWithProvider(provider: string, idToken: string) {
    const normalizedProvider = String(provider).trim().toLowerCase();
    if (!normalizedProvider) {
      throw new BadRequestException('Provider ausente.');
    }
    switch (normalizedProvider) {
      case 'google':
        return this.googleLogin(idToken);
      case 'apple':
        return this.appleLogin(idToken);
      case 'microsoft':
        return this.microsoftLogin(idToken);
      default:
        throw new BadRequestException(`Provider ${provider} não suportado.`);
    }
  }

  async loginWithEmail(emailRaw: string, password: string) {
    const email = this.normalizeEmail(emailRaw);
    if (!email) throw new BadRequestException('Email inválido.');

    const { data: profile, error } = await this.supabase
      .from('profiles')
      .select('id, provider, name')
      .eq('email', email)
      .maybeSingle();

    if (error)
      throw new InternalServerErrorException(
        `Falha ao consultar perfil: ${error.message}`,
      );
    if (!profile || !profile.id)
      throw new UnauthorizedException('Email ou senha inválidos.');
    if (profile.provider && profile.provider !== 'local') {
      throw new UnauthorizedException(
        'Este email está vinculado a outro método de login.',
      );
    }

    const passwordOk = await this.passwords.verifyPassword(
      String(profile.id),
      password,
    );
    if (!passwordOk)
      throw new UnauthorizedException('Email ou senha inválidos.');

    const details = await this.profileDetails.getDetails(String(profile.id));
    const provider = 'local';
    const providerSub = String(profile.id);

    if (!details || !details.phone) {
      const pending = await this.phoneVerification.createPending(
        String(profile.id),
        provider,
        providerSub,
      );
      await this.registerAuthFlowToken(
        pending.token,
        String(profile.id),
        provider,
        providerSub,
        pending.expiresAt,
      );
      return {
        user: null,
        requiresPhone: true,
        pendingToken: pending.token,
        pendingTokenExpiresAt: pending.expiresAt,
      };
    }

    return this.issueSession(
      String(profile.id),
      provider,
      providerSub,
      details,
    );
  }

  async requestEmailRegistration(emailRaw: string) {
    const email = this.normalizeEmail(emailRaw);
    if (!email) throw new BadRequestException('Email inválido.');

    const { data: existing, error } = await this.supabase
      .from('profiles')
      .select('id, provider')
      .eq('email', email)
      .maybeSingle();

    if (error)
      throw new InternalServerErrorException(
        `Falha ao consultar perfis: ${error.message}`,
      );
    if (existing) {
      throw new BadRequestException('Email já cadastrado.');
    }

    return this.emailVerification.request(email);
  }

  async verifyEmailRegistration(pendingToken: string, code: string) {
    return this.emailVerification.verifyCode(pendingToken, code);
  }

  async completeEmailRegistration(input: {
    registerToken: string;
    password: string;
    name?: string | null;
  }) {
    const payload = await this.emailVerification.consumeRegisterToken(
      input.registerToken,
    );
    const email = payload.email;

    const { data: existing, error: checkErr } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (checkErr)
      throw new InternalServerErrorException(
        `Falha ao validar email: ${checkErr.message}`,
      );
    if (existing) throw new BadRequestException('Email já cadastrado.');

    const { data: profile, error } = await this.supabase
      .from('profiles')
      .insert({
        email,
        name: input.name ?? null,
        provider: 'local',
      })
      .select('id')
      .single();

    if (error)
      throw new InternalServerErrorException(
        `Falha ao criar perfil: ${error.message}`,
      );
    if (!profile?.id)
      throw new InternalServerErrorException('Perfil não criado.');

    await this.passwords.setPassword(String(profile.id), input.password);

    const pending = await this.phoneVerification.createPending(
      String(profile.id),
      'local',
      String(profile.id),
    );
    await this.registerAuthFlowToken(
      pending.token,
      String(profile.id),
      'local',
      String(profile.id),
      pending.expiresAt,
    );
    return {
      user: null,
      requiresPhone: true,
      pendingToken: pending.token,
      pendingTokenExpiresAt: pending.expiresAt,
    };
  }

  async requestPasswordReset(emailRaw: string) {
    const email = this.normalizeEmail(emailRaw);
    if (!email) throw new BadRequestException('Email inválido.');

    const { data: profile, error } = await this.supabase
      .from('profiles')
      .select('id, provider')
      .eq('email', email)
      .maybeSingle();

    if (error)
      throw new InternalServerErrorException(
        `Falha ao consultar perfil: ${error.message}`,
      );
    if (!profile?.id)
      throw new BadRequestException(
        'Nenhuma conta encontrada para este email.',
      );
    if (profile.provider && profile.provider !== 'local') {
      throw new BadRequestException(
        'Este email está vinculado a outro método de login.',
      );
    }

    return this.emailVerification.requestReset(email);
  }

  async verifyPasswordReset(pendingToken: string, code: string) {
    return this.emailVerification.verifyResetCode(pendingToken, code);
  }

  async completePasswordReset(input: {
    resetToken: string;
    password: string;
    name?: string | null;
  }) {
    const payload = await this.emailVerification.consumeResetToken(
      input.resetToken,
    );
    const email = payload.email;

    const { data: profile, error } = await this.supabase
      .from('profiles')
      .select('id, provider')
      .eq('email', email)
      .maybeSingle();

    if (error)
      throw new InternalServerErrorException(
        `Falha ao consultar perfil: ${error.message}`,
      );
    if (!profile?.id) throw new BadRequestException('Conta não localizada.');
    if (profile.provider && profile.provider !== 'local') {
      throw new BadRequestException(
        'Este email está vinculado a outro método de login.',
      );
    }

    if (input.name && input.name.trim()) {
      await this.supabase
        .from('profiles')
        .update({ name: input.name.trim() })
        .eq('id', profile.id);
    }

    await this.passwords.setPassword(String(profile.id), input.password);

    const details = await this.profileDetails.getDetails(String(profile.id));
    if (!details || !details.phone) {
      const pending = await this.phoneVerification.createPending(
        String(profile.id),
        'local',
        String(profile.id),
      );
      await this.registerAuthFlowToken(
        pending.token,
        String(profile.id),
        'local',
        String(profile.id),
        pending.expiresAt,
      );
      return {
        user: null,
        requiresPhone: true,
        pendingToken: pending.token,
        pendingTokenExpiresAt: pending.expiresAt,
      };
    }

    return this.issueSession(
      String(profile.id),
      'local',
      String(profile.id),
      details,
    );
  }

  async googleLogin(idToken: string) {
    return this.externalProviderLogin('google', idToken);
  }

  async appleLogin(idToken: string) {
    return this.externalProviderLogin('apple', idToken);
  }

  async microsoftLogin(idToken: string) {
    return this.externalProviderLogin('microsoft', idToken);
  }

  private async externalProviderLogin(
    provider: ExternalProvider,
    idToken: string,
  ) {
    // 1) claims (aqui simulado; no real, use this.users.verifyGoogleIdToken)
    const claims = this.decodeIdTokenUnsafe(idToken, provider);
    if (!claims?.email || !claims?.sub) {
      throw new BadRequestException(`Claims inválidas do ${provider}.`);
    }

    const user = await Promise.resolve(
      this.upsertUserByProvider(provider, claims),
    );
    const email = String(user.email).toLowerCase();
    const providerLabel = user.provider ?? provider;
    const providerSub = user.providerSub ?? String(claims.sub ?? '');
    const nameClaim =
      this.pickName(claims, PROVIDER_NAME_FIELDS[provider]) ?? null;
    const profileName =
      (typeof user.name === 'string' && user.name.trim()) || nameClaim;
    if (!providerSub) {
      throw new InternalServerErrorException(
        'Identificador do provider ausente.',
      );
    }
    // 2) Checar se já existe um perfil com outro provider
    const { data: existingProfile, error: selectErr } = await this.supabase
      .from('profiles')
      .select('email, provider')
      .eq('email', email)
      .maybeSingle();

    if (selectErr)
      throw new InternalServerErrorException(
        `Falha ao consultar profiles: ${selectErr.message}`,
      );

    if (existingProfile && existingProfile.provider !== providerLabel) {
      throw new UnauthorizedException(
        'esse email está registrad com outro provider.',
      );
    }

    // 3) Upsert do profile (idempotente)
    const { data: profile, error: upsertErr } = await this.supabase
      .from('profiles')
      .upsert(
        { email, name: profileName ?? null, provider: providerLabel },
        { onConflict: 'email' },
      )
      .select('id') // <- Aqui pedimos explicitamente o id
      .single();

    if (upsertErr)
      throw new InternalServerErrorException(
        `Falha ao salvar profile: ${upsertErr.message}`,
      );

    const details = await this.profileDetails.getDetails(profile.id);

    if (!details || !details.phone) {
      const pending = await this.phoneVerification.createPending(
        profile.id,
        providerLabel,
        providerSub,
      );
      await this.registerAuthFlowToken(
        pending.token,
        String(profile.id),
        providerLabel,
        providerSub,
        pending.expiresAt,
      );
      return {
        user: null,
        requiresPhone: true,
        pendingToken: pending.token,
        pendingTokenExpiresAt: pending.expiresAt,
      };
    }

    return this.issueSession(profile.id, providerLabel, providerSub, details);
  }

  async verifySessionToken(tokenClear: string) {
    if (!tokenClear) throw new UnauthorizedException('Token ausente.');
    const tokenHash = hashToken(tokenClear);

    const { data: row, error } = await this.supabase
      .from('tokens')
      .select(
        'provider, provider_sub, expires_at, revoked_at, profiles!inner(email)',
      )
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error)
      throw new InternalServerErrorException(
        `Falha ao consultar token: ${error.message}`,
      );
    if (!row) throw new UnauthorizedException('Token inválido.');
    if (row.revoked_at) throw new UnauthorizedException('Token revogado.');
    if (!row.expires_at || new Date(row.expires_at) <= new Date()) {
      throw new UnauthorizedException('Token expirado.');
    }

    const related = (row as any).profiles;
    const email = Array.isArray(related)
      ? (related[0]?.email ?? null)
      : (related?.email ?? null);

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

    if (error)
      throw new InternalServerErrorException(
        `Falha ao consultar token: ${error.message}`,
      );
    if (!current) throw new UnauthorizedException('Token inválido.');
    if (current.revoked_at) throw new UnauthorizedException('Token revogado.');
    if (!current.expires_at || new Date(current.expires_at) <= new Date()) {
      throw new UnauthorizedException('Token expirado.');
    }

    const details = await this.profileDetails.getDetails(
      String(current.user_id),
    );
    if (!details || !details.phone) {
      throw new UnauthorizedException('Perfil incompleto.');
    }

    const provider = String(current.provider ?? 'local');
    const providerSub =
      typeof current.provider_sub === 'string'
        ? current.provider_sub
        : current.provider_sub != null
          ? String(current.provider_sub)
          : '';

    const pendingTerms = await this.maybeRequireTermsAcceptance(
      String(current.user_id),
      provider,
      providerSub,
      details,
    );
    if (pendingTerms) {
      return pendingTerms;
    }

    const { clear: newTokenClear, hash: newTokenHash } =
      generateOpaqueToken(32);
    const expiresAt = await this.persistTokenRecord({
      tokenHash: newTokenHash,
      userId: String(current.user_id),
      provider: current.provider,
      providerSub: current.provider_sub,
      permission: true,
      consumeTokenHash: tokenHash,
    });

    this.scheduleTokenDeletion(String(current.id), 60_000);

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

  async requestPhoneVerification(input: {
    pendingToken: string;
    phone: string;
    machineCode: string;
    language?: string;
  }) {
    return this.phoneVerification.requestCode(input);
  }

  async verifyPhoneCode(input: {
    pendingToken: string;
    machineCode: string;
    code: string;
  }) {
    const result = await this.phoneVerification.verifyCode(input);
    await this.revokeToken(input.pendingToken);
    return this.issueSession(
      result.profileId,
      result.provider,
      result.providerSub,
      result.details,
    );
  }

  async acceptTerms(pendingToken: string) {
    const result = await this.termsAcceptance.acceptTerms(pendingToken);
    await this.revokeToken(pendingToken);
    return this.issueSession(
      result.profileId,
      result.provider,
      result.providerSub,
      result.details,
    );
  }

  private async issueSession(
    profileId: string,
    provider: string,
    providerSub: string,
    details: ProfileDetails,
  ) {
    if (!details.phone) {
      throw new InternalServerErrorException(
        'Telefone ausente nos detalhes do perfil.',
      );
    }

    const pendingTerms = await this.maybeRequireTermsAcceptance(
      profileId,
      provider,
      providerSub,
      details,
    );
    if (pendingTerms) {
      return pendingTerms;
    }

    const profile = await this.loadProfileBasics(profileId);

    const { clear: tokenClear, hash: tokenHash } = generateOpaqueToken(32);
    const expiresAt = await this.persistTokenRecord({
      tokenHash,
      userId: profileId,
      provider,
      providerSub,
      permission: true,
      clearUserTokens: true,
    });

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

    if (error)
      throw new InternalServerErrorException(
        `Falha ao consultar perfil: ${error.message}`,
      );
    if (!data) throw new InternalServerErrorException('Perfil não localizado.');

    return {
      email: data.email ?? null,
      name: data.name ?? null,
    };
  }

  private scheduleTokenDeletion(tokenId: string, delayMs: number) {
    const timer = setTimeout(async () => {
      try {
        const { error } = await this.supabase
          .from('tokens')
          .delete()
          .eq('id', tokenId);
        if (error) {
          this.logger.error(
            `Falha ao apagar token ${tokenId}: ${error.message ?? error}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Erro inesperado ao apagar token ${tokenId}: ${String(err)}`,
        );
      }
    }, delayMs);

    if (typeof (timer as any)?.unref === 'function') {
      (timer as any).unref();
    }
  }

  private async persistTokenRecord(input: {
    tokenHash: string;
    userId: string;
    provider: string;
    providerSub: string;
    permission: boolean;
    expiresAt?: string;
    consumeTokenHash?: string | null;
    clearUserTokens?: boolean;
  }) {
    const issuedAt = new Date().toISOString();
    const expiresAt =
      input.expiresAt ??
      (await utcTimestampPlusMinutes(
        input.permission ? SESSION_TTL_MINUTES : AUTH_FLOW_TTL_MINUTES,
      ));

    if (input.consumeTokenHash) {
      await this.deleteTokenByHash(input.consumeTokenHash);
    }

    if (input.clearUserTokens) {
      await this.deleteTokensByUser(input.userId);
    }

    const { error } = await this.supabase.from('tokens').insert({
      user_id: input.userId,
      token_hash: input.tokenHash,
      provider: input.provider,
      provider_sub:
        input.providerSub !== undefined ? input.providerSub : null,
      issued_at: issuedAt,
      expires_at: expiresAt,
      revoked_at: null,
      permission: input.permission,
    });
    if (error)
      throw new InternalServerErrorException(
        `Falha ao criar token: ${error.message}`,
      );

    return expiresAt;
  }

  private async registerAuthFlowToken(
    tokenClear: string,
    userId: string,
    provider: string,
    providerSub: string,
    expiresAt?: string,
  ) {
    if (!tokenClear) return;
    const tokenHash = hashToken(tokenClear);
    await this.persistTokenRecord({
      tokenHash,
      userId,
      provider,
      providerSub,
      permission: false,
      expiresAt,
      clearUserTokens: true,
    });
  }

  private async revokeToken(tokenClear?: string) {
    if (!tokenClear) return;
    const tokenHash = hashToken(tokenClear);
    await this.supabase.from('tokens').delete().eq('token_hash', tokenHash);
  }

  private async maybeRequireTermsAcceptance(
    profileId: string,
    provider: string,
    providerSub: string,
    details: ProfileDetails,
  ) {
    if (details.acceptedTerms) {
      return null;
    }

    const pending = await this.termsAcceptance.createPending(
      profileId,
      provider,
      providerSub,
      details,
    );
    await this.registerAuthFlowToken(
      pending.token,
      profileId,
      provider,
      providerSub,
      pending.expiresAt,
    );

    return {
      user: null,
      requiresPhone: false,
      requiresTermsAcceptance: true,
      termsPendingToken: pending.token,
      termsPendingTokenExpiresAt: pending.expiresAt,
    };
  }

  private async deleteTokensByUser(userId: string) {
    const { error } = await this.supabase
      .from('tokens')
      .delete()
      .eq('user_id', userId);
    if (error) {
      this.logger.error(
        `Falha ao remover tokens do usuário ${userId}: ${error.message}`,
      );
    }
  }

  private async deleteTokenByHash(tokenHash: string) {
    const { error } = await this.supabase
      .from('tokens')
      .delete()
      .eq('token_hash', tokenHash);
    if (error) {
      this.logger.error(
        `Falha ao remover token ${tokenHash.slice(0, 8)}...: ${error.message}`,
      );
    }
  }

  private normalizeEmail(email?: string) {
    const normalized = String(email ?? '')
      .trim()
      .toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private upsertUserByProvider(provider: ExternalProvider, claims: any) {
    switch (provider) {
      case 'google':
        return this.users.upsertFromGoogleClaims(claims);
      case 'apple':
        return this.users.upsertFromAppleClaims(claims);
      case 'microsoft':
        return this.users.upsertFromMicrosoftClaims(claims);
      default:
        throw new BadRequestException(`Provider ${provider} não suportado.`);
    }
  }

  private pickName(claims: any, fields: string[]): string | null {
    for (const field of fields) {
      const value = claims?.[field];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }
}
