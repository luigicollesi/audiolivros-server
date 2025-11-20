import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
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

const TERMS_PENDING_TTL_MINUTES = 5;

interface PendingTermsRecord {
  tokenHash: string;
  profileId: string;
  provider: string;
  providerSub: string;
  expiresAt: string;
  details: ProfileDetails;
  timer?: ReturnType<typeof setTimeout>;
}

export interface PendingTerms {
  token: string;
  expiresAt: string;
}

export interface TermsAcceptanceResult {
  profileId: string;
  provider: string;
  providerSub: string;
  details: ProfileDetails;
}

@Injectable()
export class TermsAcceptanceService {
  private readonly pending = new Map<string, PendingTermsRecord>();
  private readonly profileIndex = new Map<string, string>();

  constructor(private readonly profileDetails: ProfileDetailsService) {}

  async createPending(
    profileId: string,
    provider: string,
    providerSub: string,
    details: ProfileDetails,
  ): Promise<PendingTerms> {
    if (!details.phone) {
      throw new BadRequestException(
        'Telefone obrigatório para aceitar os termos.',
      );
    }

    const { clear, hash } = generateOpaqueToken(32);
    const expiresAt = await utcTimestampPlusMinutes(TERMS_PENDING_TTL_MINUTES);

    const record: PendingTermsRecord = {
      tokenHash: hash,
      profileId,
      provider,
      providerSub,
      expiresAt,
      details,
    };

    const existingTokenHash = this.profileIndex.get(profileId);
    if (existingTokenHash) {
      this.clearRecord(existingTokenHash);
    }

    const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
    if (msUntilExpiry > 0) {
      record.timer = setTimeout(() => this.clearRecord(hash), msUntilExpiry);
      if (typeof (record.timer as any)?.unref === 'function') {
        (record.timer as any).unref();
      }
    }

    this.pending.set(hash, record);
    this.profileIndex.set(profileId, hash);

    return { token: clear, expiresAt };
  }

  async acceptTerms(pendingToken: string): Promise<TermsAcceptanceResult> {
    const token = String(pendingToken ?? '').trim();
    if (!token) {
      throw new BadRequestException('Token de aceite ausente.');
    }

    const tokenHash = hashToken(token);
    const record = this.pending.get(tokenHash);
    if (!record) {
      throw new UnauthorizedException('Token de aceite inválido.');
    }

    if (this.isExpired(record.expiresAt)) {
      this.clearRecord(tokenHash);
      throw new UnauthorizedException('Token de aceite expirado.');
    }

    const updatedDetails = await this.profileDetails.markTermsAccepted(
      record.profileId,
      record.details,
    );
    this.clearRecord(tokenHash);

    return {
      profileId: record.profileId,
      provider: record.provider,
      providerSub: record.providerSub,
      details: updatedDetails,
    };
  }

  private isExpired(expiresAt: string) {
    if (!expiresAt) return true;
    return new Date(expiresAt).getTime() <= Date.now();
  }

  private clearRecord(tokenHash: string) {
    const record = this.pending.get(tokenHash);
    if (record?.timer) {
      clearTimeout(record.timer);
    }
    if (record) {
      const current = this.profileIndex.get(record.profileId);
      if (current === tokenHash) {
        this.profileIndex.delete(record.profileId);
      }
    }
    this.pending.delete(tokenHash);
  }
}
