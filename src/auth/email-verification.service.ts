import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  generateOpaqueToken,
  hashToken,
  utcTimestampPlusMinutes,
} from '../common/utils/token';

const EMAIL_PENDING_TTL_MINUTES = 10;
const EMAIL_CODE_TTL_MINUTES = 5;
const MAX_VERIFICATION_ATTEMPTS = 5;
const MIN_RESEND_INTERVAL_MS = 45_000;

type EmailVerificationStatus = 'pending' | 'verified';

interface EmailRecord {
  tokenHash: string;
  email: string;
  tokenExpiresAt: string;
  status: EmailVerificationStatus;
  codeHash: string | null;
  codeExpiresAt: string | null;
  attempts: number;
  lastCodeSentAt?: number;
  registerTokenHash?: string;
  registerTokenExpiresAt?: string;
  resetTokenHash?: string;
  resetTokenExpiresAt?: string;
  tokenTimer?: ReturnType<typeof setTimeout>;
  codeTimer?: ReturnType<typeof setTimeout>;
  registerTimer?: ReturnType<typeof setTimeout>;
  resetTimer?: ReturnType<typeof setTimeout>;
}

export interface EmailPending {
  token: string;
  expiresAt: string;
}

export interface EmailVerified {
  registerToken: string;
  expiresAt: string;
  email: string;
}

export interface EmailResetToken {
  resetToken: string;
  expiresAt: string;
  email: string;
}

export interface EmailRegistrationPayload {
  email: string;
}

export interface EmailResetPayload {
  email: string;
}

@Injectable()
export class EmailVerificationService {
  private readonly pendingByToken = new Map<string, EmailRecord>();
  private readonly emailIndex = new Map<string, string>();
  private readonly registerIndex = new Map<string, string>();
  private readonly resetIndex = new Map<string, string>();

  async request(emailRaw: string): Promise<EmailPending> {
    const email = this.normalizeEmail(emailRaw);
    if (!email) throw new BadRequestException('Email inválido.');

    const existingTokenHash = this.emailIndex.get(email);
    if (existingTokenHash) {
      const existing = this.pendingByToken.get(existingTokenHash);
      if (
        existing &&
        existing.status === 'verified' &&
        existing.registerTokenHash &&
        existing.registerTokenExpiresAt &&
        !this.isExpired(existing.registerTokenExpiresAt)
      ) {
        throw new BadRequestException(
          'Este email já foi verificado. Conclua o cadastro com o token recebido.',
        );
      }
      this.clearRecord(existingTokenHash);
    }

    const { clear: token, hash: tokenHash } = generateOpaqueToken(32);
    const tokenExpiresAt = await utcTimestampPlusMinutes(
      EMAIL_PENDING_TTL_MINUTES,
    );

    const record: EmailRecord = {
      tokenHash,
      email,
      tokenExpiresAt,
      status: 'pending',
      codeHash: null,
      codeExpiresAt: null,
      attempts: 0,
    };

    const msUntilExpiry = new Date(tokenExpiresAt).getTime() - Date.now();
    if (msUntilExpiry > 0) {
      record.tokenTimer = setTimeout(
        () => this.clearRecord(tokenHash),
        msUntilExpiry,
      );
      if (typeof (record.tokenTimer as any)?.unref === 'function') {
        (record.tokenTimer as any).unref();
      }
    }

    this.pendingByToken.set(tokenHash, record);
    this.emailIndex.set(email, tokenHash);

    const code = this.generateAndStoreCode(record);
    this.sendVerificationEmail(email, code);

    return { token, expiresAt: tokenExpiresAt };
  }

  async resendCode(tokenClear: string) {
    const record = await this.getRecordByToken(tokenClear);
    if (record.status !== 'pending') {
      throw new BadRequestException('Verificação já concluída.');
    }
    if (
      record.lastCodeSentAt &&
      Date.now() - record.lastCodeSentAt < MIN_RESEND_INTERVAL_MS
    ) {
      throw new BadRequestException(
        'Aguarde alguns segundos antes de solicitar um novo código.',
      );
    }
    const code = this.generateAndStoreCode(record);
    this.sendVerificationEmail(record.email, code);
    return { ok: true, codeExpiresAt: record.codeExpiresAt };
  }

  async verifyCode(
    tokenClear: string,
    codeRaw: string,
  ): Promise<EmailVerified> {
    const record = await this.getRecordByToken(tokenClear);
    if (record.status !== 'pending') {
      throw new BadRequestException('Verificação já concluída.');
    }

    const code = this.normalizeCode(codeRaw);
    if (!code) throw new BadRequestException('Código obrigatório.');

    if (!record.codeHash || !record.codeExpiresAt) {
      throw new BadRequestException('Nenhum código foi solicitado.');
    }

    if (this.isExpired(record.codeExpiresAt)) {
      const newCode = this.generateAndStoreCode(record);
      this.sendVerificationEmail(record.email, newCode);
      throw new BadRequestException(
        'Código expirado. Um novo código foi enviado.',
      );
    }

    const providedHash = hashToken(code);
    if (providedHash !== record.codeHash) {
      this.handleInvalidAttempt(record);
      throw new BadRequestException('Código inválido.');
    }

    record.status = 'verified';
    record.codeHash = null;
    record.codeExpiresAt = null;
    if (record.codeTimer) {
      clearTimeout(record.codeTimer);
      record.codeTimer = undefined;
    }

    const { clear: registerToken, hash: registerHash } =
      generateOpaqueToken(32);
    const registerExpiresAt = await utcTimestampPlusMinutes(
      EMAIL_PENDING_TTL_MINUTES,
    );
    record.registerTokenHash = registerHash;
    record.registerTokenExpiresAt = registerExpiresAt;
    this.registerIndex.set(registerHash, record.tokenHash);

    const msUntilRegister = new Date(registerExpiresAt).getTime() - Date.now();
    if (msUntilRegister > 0) {
      record.registerTimer = setTimeout(
        () => this.clearRecord(record.tokenHash),
        msUntilRegister,
      );
      if (typeof (record.registerTimer as any)?.unref === 'function') {
        (record.registerTimer as any).unref();
      }
    }

    return { registerToken, expiresAt: registerExpiresAt, email: record.email };
  }

  async consumeRegisterToken(
    registerTokenClear: string,
  ): Promise<EmailRegistrationPayload> {
    const registerHash = hashToken(registerTokenClear);
    const tokenHash = this.registerIndex.get(registerHash);
    if (!tokenHash) {
      throw new UnauthorizedException(
        'Token de registro inválido ou expirado.',
      );
    }

    const record = this.pendingByToken.get(tokenHash);
    if (!record) {
      this.registerIndex.delete(registerHash);
      throw new UnauthorizedException(
        'Token de registro inválido ou expirado.',
      );
    }

    if (
      !record.registerTokenExpiresAt ||
      this.isExpired(record.registerTokenExpiresAt)
    ) {
      this.clearRecord(record.tokenHash);
      throw new UnauthorizedException('Token de registro expirado.');
    }

    if (record.registerTimer) {
      clearTimeout(record.registerTimer);
    }

    const email = record.email;
    this.clearRecord(record.tokenHash);
    return { email };
  }

  async requestReset(emailRaw: string): Promise<EmailPending> {
    const email = this.normalizeEmail(emailRaw);
    if (!email) throw new BadRequestException('Email inválido.');

    const existingTokenHash = this.emailIndex.get(email);
    if (existingTokenHash) {
      const existing = this.pendingByToken.get(existingTokenHash);
      if (existing) this.clearRecord(existingTokenHash);
    }

    const { clear: token, hash: tokenHash } = generateOpaqueToken(32);
    const tokenExpiresAt = await utcTimestampPlusMinutes(
      EMAIL_PENDING_TTL_MINUTES,
    );

    const record: EmailRecord = {
      tokenHash,
      email,
      tokenExpiresAt,
      status: 'pending',
      codeHash: null,
      codeExpiresAt: null,
      attempts: 0,
    };

    const msUntilExpiry = new Date(tokenExpiresAt).getTime() - Date.now();
    if (msUntilExpiry > 0) {
      record.tokenTimer = setTimeout(
        () => this.clearRecord(tokenHash),
        msUntilExpiry,
      );
      if (typeof (record.tokenTimer as any)?.unref === 'function') {
        (record.tokenTimer as any).unref();
      }
    }

    this.pendingByToken.set(tokenHash, record);
    this.emailIndex.set(email, tokenHash);

    const code = this.generateAndStoreCode(record);
    this.sendVerificationEmail(email, code);

    return { token, expiresAt: tokenExpiresAt };
  }

  async verifyResetCode(
    tokenClear: string,
    codeRaw: string,
  ): Promise<EmailResetToken> {
    const record = await this.getRecordByToken(tokenClear);

    const code = this.normalizeCode(codeRaw);
    if (!code) throw new BadRequestException('Código obrigatório.');

    if (!record.codeHash || !record.codeExpiresAt) {
      throw new BadRequestException('Nenhum código foi solicitado.');
    }

    if (this.isExpired(record.codeExpiresAt)) {
      const newCode = this.generateAndStoreCode(record);
      this.sendVerificationEmail(record.email, newCode);
      throw new BadRequestException(
        'Código expirado. Um novo código foi enviado.',
      );
    }

    const providedHash = hashToken(code);
    if (providedHash !== record.codeHash) {
      this.handleInvalidAttempt(record);
      throw new BadRequestException('Código inválido.');
    }

    record.codeHash = null;
    record.codeExpiresAt = null;
    if (record.codeTimer) {
      clearTimeout(record.codeTimer);
      record.codeTimer = undefined;
    }

    const { clear: resetToken, hash: resetHash } = generateOpaqueToken(32);
    const resetExpiresAt = await utcTimestampPlusMinutes(
      EMAIL_PENDING_TTL_MINUTES,
    );
    record.resetTokenHash = resetHash;
    record.resetTokenExpiresAt = resetExpiresAt;
    this.resetIndex.set(resetHash, record.tokenHash);

    const msUntilReset = new Date(resetExpiresAt).getTime() - Date.now();
    if (msUntilReset > 0) {
      record.resetTimer = setTimeout(
        () => this.clearRecord(record.tokenHash),
        msUntilReset,
      );
      if (typeof (record.resetTimer as any)?.unref === 'function') {
        (record.resetTimer as any).unref();
      }
    }

    return { resetToken, expiresAt: resetExpiresAt, email: record.email };
  }

  async consumeResetToken(resetTokenClear: string): Promise<EmailResetPayload> {
    const resetHash = hashToken(resetTokenClear);
    const tokenHash = this.resetIndex.get(resetHash);
    if (!tokenHash) {
      throw new UnauthorizedException(
        'Token de redefinição inválido ou expirado.',
      );
    }

    const record = this.pendingByToken.get(tokenHash);
    if (!record) {
      this.resetIndex.delete(resetHash);
      throw new UnauthorizedException(
        'Token de redefinição inválido ou expirado.',
      );
    }

    if (
      !record.resetTokenExpiresAt ||
      this.isExpired(record.resetTokenExpiresAt)
    ) {
      this.clearRecord(record.tokenHash);
      throw new UnauthorizedException('Token de redefinição expirado.');
    }

    if (record.resetTimer) {
      clearTimeout(record.resetTimer);
    }

    const email = record.email;
    this.clearRecord(record.tokenHash);
    return { email };
  }

  private async getRecordByToken(tokenClear: string): Promise<EmailRecord> {
    const tokenHash = hashToken(tokenClear);
    const record = this.pendingByToken.get(tokenHash);
    if (!record) {
      throw new UnauthorizedException('Token inválido.');
    }
    if (this.isExpired(record.tokenExpiresAt)) {
      this.clearRecord(tokenHash);
      throw new UnauthorizedException('Token expirado. Solicite novamente.');
    }
    return record;
  }

  private generateAndStoreCode(record: EmailRecord) {
    const code = this.generateCode();
    record.codeHash = hashToken(code);
    record.codeExpiresAt = new Date(
      Date.now() + EMAIL_CODE_TTL_MINUTES * 60_000,
    ).toISOString();
    record.attempts = 0;
    record.lastCodeSentAt = Date.now();
    if (record.codeTimer) {
      clearTimeout(record.codeTimer);
    }
    const msUntilExpiry = new Date(record.codeExpiresAt).getTime() - Date.now();
    if (msUntilExpiry > 0) {
      record.codeTimer = setTimeout(() => {
        record.codeHash = null;
        record.codeExpiresAt = null;
      }, msUntilExpiry);
      if (typeof (record.codeTimer as any)?.unref === 'function') {
        (record.codeTimer as any).unref();
      }
    }
    return code;
  }

  private handleInvalidAttempt(record: EmailRecord) {
    record.attempts += 1;
    if (record.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      this.clearRecord(record.tokenHash);
      throw new BadRequestException('Número máximo de tentativas excedido.');
    }
  }

  private clearRecord(tokenHash: string) {
    const record = this.pendingByToken.get(tokenHash);
    if (!record) return;

    if (record.tokenTimer) clearTimeout(record.tokenTimer);
    if (record.codeTimer) clearTimeout(record.codeTimer);
    if (record.registerTimer) clearTimeout(record.registerTimer);
    if (record.resetTimer) clearTimeout(record.resetTimer);

    this.pendingByToken.delete(tokenHash);
    if (this.emailIndex.get(record.email) === tokenHash) {
      this.emailIndex.delete(record.email);
    }
    if (record.registerTokenHash) {
      this.registerIndex.delete(record.registerTokenHash);
    }
    if (record.resetTokenHash) {
      this.resetIndex.delete(record.resetTokenHash);
    }
  }

  private sendVerificationEmail(email: string, code: string) {
    console.log(`[auth] Código ${code} enviado para o email ${email}`);
  }

  private generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  private normalizeEmail(email: string) {
    return String(email ?? '')
      .trim()
      .toLowerCase();
  }

  private normalizeCode(code: string) {
    return String(code ?? '').trim();
  }

  private isExpired(iso?: string | null) {
    if (!iso) return true;
    return new Date(iso) <= new Date();
  }
}
