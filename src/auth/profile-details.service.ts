import {
  Inject,
  Injectable,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SB_ADMIN } from '../supabase/module';

export interface ProfileDetails {
  phone: string | null;
  language: string;
  genre: string | null;
}

type ProfileDetailsRow = {
  profileId?: string;
  phone?: string | null;
  language?: string | null;
  genre?: string | null;
};

@Injectable()
export class ProfileDetailsService {
  constructor(@Inject(SB_ADMIN) private readonly supabase: SupabaseClient) {}

  normalizePhone(phone: string) {
    return String(phone ?? '')
      .replace(/\s+/g, '')
      .trim();
  }

  normalizeLanguage(language?: string | null) {
    if (!language) return 'en-US';
    const trimmed = language.trim();
    return trimmed.length > 0 ? trimmed : 'en-US';
  }

  async ensurePhoneAvailable(phone: string, profileId: string) {
    const { data, error } = await this.supabase
      .from('profile_details')
      .select('profileId')
      .eq('phone', phone)
      .maybeSingle();

    if (error)
      throw new InternalServerErrorException(
        `Falha ao validar telefone: ${error.message}`,
      );

    if (data && String(data.profileId) !== profileId) {
      throw new BadRequestException('Telefone já vinculado a outra conta.');
    }
  }

  async getDetails(profileId: string): Promise<ProfileDetails | null> {
    const { data, error } = await this.supabase
      .from('profile_details')
      .select('phone, language, genre')
      .eq('profileId', profileId)
      .maybeSingle();

    if (error)
      throw new InternalServerErrorException(
        `Falha ao consultar detalhes do perfil: ${error.message}`,
      );
    if (!data) return null;

    return this.normalizeDetails(data);
  }

  async saveDetails(
    profileId: string,
    input: { phone: string; language?: string | null },
  ): Promise<ProfileDetails> {
    if (!profileId) throw new BadRequestException('Perfil inválido.');

    const phone = this.normalizePhone(input.phone);
    if (!phone) throw new BadRequestException('Telefone obrigatório.');

    const language = this.normalizeLanguage(input.language);

    const { data, error } = await this.supabase
      .from('profile_details')
      .upsert(
        {
          profileId,
          phone,
          language,
          genre: null,
        },
        { onConflict: 'profileId' },
      )
      .select('phone, language, genre')
      .single();

    if (error)
      throw new InternalServerErrorException(
        `Falha ao criar detalhes do perfil: ${error.message}`,
      );

    return this.requireNormalizeDetails(data);
  }

  private normalizeDetails(
    data: ProfileDetailsRow | null,
  ): ProfileDetails | null {
    if (!data) return null;
    return {
      phone: data.phone ?? null,
      language: this.normalizeLanguage(data.language),
      genre: data.genre ?? null,
    };
  }

  private requireNormalizeDetails(
    data: ProfileDetailsRow | null,
  ): ProfileDetails {
    const normalized = this.normalizeDetails(data);
    if (!normalized)
      throw new InternalServerErrorException(
        'Falha ao normalizar detalhes do perfil.',
      );
    return normalized;
  }
}
