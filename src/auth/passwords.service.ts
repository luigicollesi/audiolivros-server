import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import * as argon2 from 'argon2';

import { SB_ADMIN } from '../supabase/module';

@Injectable()
export class PasswordsService {
  constructor(@Inject(SB_ADMIN) private readonly supabase: SupabaseClient) {}

  async setPassword(profileId: string, password: string) {
    try {
      const hash = await argon2.hash(password);
      const { error } = await this.supabase
        .from('passwords')
        .upsert({ profileId, password: hash }, { onConflict: 'profileId' });
      if (error) {
        throw new InternalServerErrorException(
          `Falha ao salvar senha: ${error.message}`,
        );
      }
    } catch (err: any) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException('Falha ao salvar senha.');
    }
  }

  async verifyPassword(profileId: string, password: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('passwords')
      .select('password')
      .eq('profileId', profileId)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(
        `Falha ao consultar senha: ${error.message}`,
      );
    }
    if (!data?.password) return false;
    try {
      return await argon2.verify(String(data.password), password);
    } catch {
      return false;
    }
  }
}
