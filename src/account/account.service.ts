import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SB_ADMIN } from '../supabase/module';
import { ProfileDetailsService } from '../auth/profile-details.service';
import { hashToken, utcTimestampPlusMinutes } from '../common/utils/token';

type PhoneChangeRequest = {
  phone: string;
  codeHash: string;
  expiresAt: string;
};

type DeleteAccountRequest = {
  email: string;
  codeHash: string;
  expiresAt: string;
};

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  private readonly phoneRequests = new Map<string, PhoneChangeRequest>();
  private readonly deleteRequests = new Map<string, DeleteAccountRequest>();

  constructor(
    @Inject(SB_ADMIN) private readonly supabase: SupabaseClient,
    private readonly profileDetails: ProfileDetailsService,
  ) {}

  async requestPhoneChange(profileId: string, phoneRaw: string) {
    const phone = this.profileDetails.normalizePhone(phoneRaw);
    if (!phone) {
      throw new BadRequestException('Telefone inválido.');
    }

    await this.profileDetails.ensurePhoneAvailable(phone, profileId);

    const code = this.generateNumericCode(5);
    const expiresAt = await utcTimestampPlusMinutes(5);

    this.phoneRequests.set(profileId, {
      phone,
      codeHash: hashToken(code),
      expiresAt,
    });

    this.logger.log(
      `Código ${code} gerado para troca de telefone do perfil ${profileId}.`,
    );

    return { expiresAt };
  }

  async confirmPhoneChange(profileId: string, code: string) {
    const entry = this.phoneRequests.get(profileId);
    if (!entry) {
      throw new NotFoundException('Nenhum pedido de troca de telefone ativo.');
    }

    if (this.isExpired(entry.expiresAt)) {
      this.phoneRequests.delete(profileId);
      throw new BadRequestException('Código expirado. Solicite um novo.');
    }

    if (hashToken(code) !== entry.codeHash) {
      throw new BadRequestException('Código inválido.');
    }

    const currentDetails = await this.profileDetails.getDetails(profileId);
    const language = currentDetails?.language ?? 'en-US';
    const genre = currentDetails?.genre ?? null;

    const { error } = await this.supabase
      .from('profile_details')
      .upsert(
        {
          profileId,
          phone: entry.phone,
          language,
          genre,
        },
        { onConflict: 'profileId' },
      );

    if (error) {
      throw new InternalServerErrorException(
        `Falha ao atualizar telefone: ${error.message}`,
      );
    }

    this.phoneRequests.delete(profileId);
    this.logger.log(`Telefone atualizado para o perfil ${profileId}.`);

    return { success: true };
  }

  async updateLanguage(profileId: string, languageId: 'pt-BR' | 'en-US') {
    const normalized = this.profileDetails.normalizeLanguage(languageId);
    const currentDetails = await this.profileDetails.getDetails(profileId);
    const phone = currentDetails?.phone ?? null;
    const genre = currentDetails?.genre ?? null;

    const { error } = await this.supabase
      .from('profile_details')
      .upsert(
        {
          profileId,
          phone,
          language: normalized,
          genre,
        },
        { onConflict: 'profileId' },
      );

    if (error) {
      throw new InternalServerErrorException(
        `Falha ao atualizar linguagem: ${error.message}`,
      );
    }

    this.logger.log(
      `Idioma atualizado para ${normalized} no perfil ${profileId}.`,
    );

    return { success: true };
  }

  async requestAccountDeletion(profileId: string) {
    const email = await this.getProfileEmail(profileId);
    if (!email) {
      throw new BadRequestException('Conta sem email associado.');
    }

    const code = this.generateNumericCode(6);
    const expiresAt = await utcTimestampPlusMinutes(10);

    this.deleteRequests.set(profileId, {
      email,
      codeHash: hashToken(code),
      expiresAt,
    });

    this.logger.log(
      `Código ${code} enviado para ${email} para confirmação de exclusão de conta.`,
    );

    return { expiresAt };
  }

  async confirmAccountDeletion(profileId: string, code: string) {
    const entry = this.deleteRequests.get(profileId);
    if (!entry) {
      throw new NotFoundException('Nenhum pedido de exclusão ativo.');
    }

    if (this.isExpired(entry.expiresAt)) {
      this.deleteRequests.delete(profileId);
      throw new BadRequestException('Código expirado. Solicite um novo.');
    }

    if (hashToken(code) !== entry.codeHash) {
      throw new BadRequestException('Código inválido.');
    }

    await this.performAccountDeletion(profileId);
    this.deleteRequests.delete(profileId);

    this.logger.log(`Conta do perfil ${profileId} deletada com sucesso.`);
    return { success: true };
  }

  private async performAccountDeletion(profileId: string) {
    const operations = [
      this.supabase.from('favorites').delete().eq('profileId', profileId),
      this.supabase.from('tokens').delete().eq('user_id', profileId),
      this.supabase.from('profiles').delete().eq('id', profileId),
    ];

    for (const op of operations) {
      const { error } = await op;
      if (error) {
        throw new InternalServerErrorException(
          `Falha ao deletar conta: ${error.message}`,
        );
      }
    }
  }

  private async getProfileEmail(profileId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('email')
      .eq('id', profileId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Falha ao consultar email: ${error.message}`,
      );
    }

    const email = data?.email ? String(data.email).trim() : null;
    return email && email.length > 0 ? email : null;
  }

  private generateNumericCode(length: number) {
    const min = 10 ** (length - 1);
    const max = 10 ** length - 1;
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
  }

  private isExpired(iso: string) {
    return new Date(iso) <= new Date();
  }
}
