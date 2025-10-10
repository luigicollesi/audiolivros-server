import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import {
  ProfileDetails,
  ProfileDetailsService,
} from './profile-details.service';
import {
  generateOpaqueToken,
  hashToken,
  utcTimestampPlusMinutes,
} from '../common/utils/token';

const PHONE_PENDING_TTL_MINUTES = 10;
const PHONE_CODE_TTL_MINUTES = 5;
const MAX_VERIFICATION_ATTEMPTS = 5;

interface PendingRecord {
  tokenHash: string;
  profileId: string;
  provider: string;
  providerSub: string;
  tokenExpiresAt: string;
  phone: string | null;
  language: string | null;
  codeHash: string | null;
  codeExpiresAt: string | null;
  attempts: number;
  tokenTimer?: ReturnType<typeof setTimeout>;
  codeTimer?: ReturnType<typeof setTimeout>;
}

type CodeCacheEntry = {
  code: string;
  expiresAt: string;
  tokenHash: string;
  timeout?: ReturnType<typeof setTimeout>;
};

export interface PendingVerification {
  token: string;
  expiresAt: string;
}

export interface VerifiedPhoneResult {
  profileId: string;
  provider: string;
  providerSub: string;
  details: ProfileDetails;
}

@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  private readonly pendingByToken = new Map<string, PendingRecord>();
  private readonly profileIndex = new Map<string, string>();
  private readonly codeCache = new Map<string, CodeCacheEntry>();

  constructor(private readonly profileDetails: ProfileDetailsService) {}

  async createPending(
    profileId: string,
    provider: string,
    providerSub: string,
  ): Promise<PendingVerification> {
    const { clear: token, hash: tokenHash } = generateOpaqueToken(32);
    const tokenExpiresAt = await utcTimestampPlusMinutes(
      PHONE_PENDING_TTL_MINUTES,
    );

    const existingToken = this.profileIndex.get(profileId);
    if (existingToken) {
      this.clearRecord(existingToken);
    }

    const record: PendingRecord = {
      tokenHash,
      profileId,
      provider,
      providerSub,
      tokenExpiresAt,
      phone: null,
      language: null,
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
    this.profileIndex.set(profileId, tokenHash);

    return { token, expiresAt: tokenExpiresAt };
  }

  async requestCode(input: {
    pendingToken: string;
    phone: string;
    language?: string;
    machineCode: string;
  }) {
    const pendingToken = String(input?.pendingToken ?? '').trim();
    if (!pendingToken)
      throw new BadRequestException('Token de verificação ausente.');

    const phone = this.profileDetails.normalizePhone(input.phone);
    if (!phone) throw new BadRequestException('Telefone obrigatório.');

    const record = await this.getRecordByPendingToken(pendingToken);
    await this.profileDetails.ensurePhoneAvailable(phone, record.profileId);

    const language = this.profileDetails.normalizeLanguage(input.language);
    const machineCode = this.normalizeMachineCode(input.machineCode);
    if (!machineCode)
      throw new BadRequestException('Código da máquina obrigatório.');

    const verificationCode = this.generateVerificationCode();
    const codeHash = hashToken(verificationCode);
    const codeExpiresAt = await utcTimestampPlusMinutes(PHONE_CODE_TTL_MINUTES);

    record.phone = phone;
    record.language = language;
    record.codeHash = codeHash;
    record.codeExpiresAt = codeExpiresAt;
    record.attempts = 0;

    if (record.codeTimer) {
      clearTimeout(record.codeTimer);
      record.codeTimer = undefined;
    }
    const msUntilCodeExpiry = new Date(codeExpiresAt).getTime() - Date.now();
    if (msUntilCodeExpiry > 0) {
      record.codeTimer = setTimeout(
        () => this.clearRecord(record.tokenHash),
        msUntilCodeExpiry,
      );
      if (typeof (record.codeTimer as any)?.unref === 'function') {
        (record.codeTimer as any).unref();
      }
    }

    this.storeCodeForMachine(
      machineCode,
      record.tokenHash,
      verificationCode,
      codeExpiresAt,
    );

    this.dispatchWhatsappCode(phone, verificationCode, machineCode);

    return { ok: true, codeExpiresAt };
  }

  async verifyCode(input: {
    pendingToken: string;
    code: string;
    machineCode: string;
  }): Promise<VerifiedPhoneResult> {
    const pendingToken = String(input?.pendingToken ?? '').trim();
    const code = String(input?.code ?? '').trim();
    const machineCode = this.normalizeMachineCode(input.machineCode);

    if (!pendingToken)
      throw new BadRequestException('Token de verificação ausente.');
    if (!code) throw new BadRequestException('Código obrigatório.');
    if (!machineCode)
      throw new BadRequestException('Código da máquina obrigatório.');

    const record = await this.getRecordByPendingToken(pendingToken);

    const cached = this.codeCache.get(machineCode);
    if (!cached || cached.tokenHash !== record.tokenHash) {
      throw new BadRequestException('Código não solicitado para esta máquina.');
    }

    if (this.isExpired(cached.expiresAt)) {
      this.codeCache.delete(machineCode);
      this.clearRecord(record.tokenHash);
      throw new BadRequestException('Código expirado. Solicite um novo.');
    }

    if (!record.phone) {
      throw new BadRequestException('Telefone não informado.');
    }

    if (!record.codeHash || !record.codeExpiresAt) {
      throw new BadRequestException('Código não foi solicitado.');
    }

    if (this.isExpired(record.codeExpiresAt)) {
      this.codeCache.delete(machineCode);
      this.clearRecord(record.tokenHash);
      throw new BadRequestException('Código expirado. Solicite um novo.');
    }

    const codeHash = hashToken(code);
    if (codeHash !== record.codeHash) {
      this.handleInvalidAttempt(record);
      throw new BadRequestException('Código inválido.');
    }

    const details = await this.profileDetails.saveDetails(record.profileId, {
      phone: record.phone,
      language: record.language ?? 'en-US',
    });

    this.clearRecord(record.tokenHash);
    this.codeCache.delete(machineCode);

    return {
      profileId: record.profileId,
      provider: record.provider,
      providerSub: record.providerSub,
      details,
    };
  }

  private async getRecordByPendingToken(token: string): Promise<PendingRecord> {
    const tokenHash = hashToken(token);
    const record = this.pendingByToken.get(tokenHash);
    if (!record) {
      throw new UnauthorizedException('Token de verificação inválido.');
    }
    if (this.isExpired(record.tokenExpiresAt)) {
      this.clearRecord(tokenHash);
      throw new UnauthorizedException(
        'Token de verificação expirado. Refaça o login.',
      );
    }
    return record;
  }

  private handleInvalidAttempt(record: PendingRecord) {
    record.attempts += 1;
    if (record.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      this.clearRecord(record.tokenHash);
      throw new BadRequestException(
        'Número máximo de tentativas excedido. Refaça o login.',
      );
    }
  }

  private clearRecord(tokenHash: string) {
    const record = this.pendingByToken.get(tokenHash);
    if (!record) return;

    if (record.tokenTimer) {
      clearTimeout(record.tokenTimer);
    }
    if (record.codeTimer) {
      clearTimeout(record.codeTimer);
    }

    this.pendingByToken.delete(tokenHash);

    if (this.profileIndex.get(record.profileId) === tokenHash) {
      this.profileIndex.delete(record.profileId);
    }

    this.evictCachesByToken(tokenHash);
  }

  private isExpired(iso?: string | null) {
    if (!iso) return true;
    return new Date(iso) <= new Date();
  }

  private normalizeMachineCode(machineCode?: string | null) {
    return String(machineCode ?? '').trim();
  }

  private generateVerificationCode() {
    return String(Math.floor(10000 + Math.random() * 90000));
  }

  private dispatchWhatsappCode(
    phone: string,
    code: string,
    machineCode: string,
  ) {
    this.logger.log(
      `Código ${code} destinado a ${phone} (machine=${machineCode})`,
    );
  }

  private storeCodeForMachine(
    machineCode: string,
    tokenHash: string,
    code: string,
    expiresAt: string,
  ) {
    const existing = this.codeCache.get(machineCode);
    if (existing?.timeout) {
      clearTimeout(existing.timeout);
    }

    const entry: CodeCacheEntry = { code, expiresAt, tokenHash };
    const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
    if (msUntilExpiry > 0) {
      entry.timeout = setTimeout(() => {
        const current = this.codeCache.get(machineCode);
        if (current && current.tokenHash === tokenHash) {
          this.codeCache.delete(machineCode);
        }
      }, msUntilExpiry);
      if (typeof (entry.timeout as any)?.unref === 'function') {
        (entry.timeout as any).unref();
      }
    }
    this.codeCache.set(machineCode, entry);
  }

  private evictCachesByToken(tokenHash: string) {
    for (const [machine, entry] of this.codeCache.entries()) {
      if (entry.tokenHash === tokenHash) {
        if (entry.timeout) {
          clearTimeout(entry.timeout);
        }
        this.codeCache.delete(machine);
      }
    }
  }
}
