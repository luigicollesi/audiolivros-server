// src/users/users.service.ts
import { randomUUID } from 'crypto';

import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';
import { User } from './user.types';

type ExternalProvider = 'google' | 'apple' | 'microsoft';

@Injectable()
export class UsersService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}
  // “banco” em memória
  private byKey = new Map<string, User>(); // key = `${provider}:${sub}`

  upsertFromGoogleClaims(claims: any): User {
    return this.upsertFromClaims('google', claims);
  }

  upsertFromAppleClaims(claims: any): User {
    return this.upsertFromClaims('apple', claims);
  }

  upsertFromMicrosoftClaims(claims: any): User {
    return this.upsertFromClaims('microsoft', claims);
  }

  getById(id: string): User | undefined {
    for (const u of this.byKey.values()) if (u.id === id) return u;
    return undefined;
  }

  async getByEmail(email: string) {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('email, name, provider')
      .eq('email', email)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    return data; // ou adapte ao DTO do seu domínio
  }

  private upsertFromClaims(provider: ExternalProvider, claims: any): User {
    const sub = String(claims?.sub ?? '');
    const email = String(claims?.email ?? '');
    const name =
      typeof claims?.name === 'string' ? String(claims.name) : undefined;
    const picture =
      typeof claims?.picture === 'string' ? String(claims.picture) : undefined;
    const emailVerified =
      typeof claims?.email_verified === 'boolean'
        ? claims.email_verified
        : claims?.email_verified == null
          ? undefined
          : Boolean(claims.email_verified);

    if (!sub || !email) {
      throw new Error('Claims insuficientes (sub/email ausentes).');
    }

    const key = `${provider}:${sub}`;
    const now = new Date().toISOString();

    const existing = this.byKey.get(key);
    if (existing) {
      const updated: User = {
        ...existing,
        email,
        emailVerified,
        name: name ?? existing.name,
        picture: picture ?? existing.picture,
        updatedAt: now,
      };
      this.byKey.set(key, updated);
      return updated;
    }

    const user: User = {
      id: randomUUID(),
      provider,
      providerSub: sub,
      email,
      emailVerified,
      name,
      picture,
      createdAt: now,
      updatedAt: now,
    };
    this.byKey.set(key, user);
    return user;
  }
}
