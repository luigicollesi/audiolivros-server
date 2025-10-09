// src/users/users.service.ts
import { User } from './user.types';
import { randomUUID } from 'crypto';

import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';

@Injectable()
export class UsersService {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}
  // “banco” em memória
  private byKey = new Map<string, User>(); // key = `${provider}:${sub}`

  upsertFromGoogleClaims(claims: any): User {
    const provider = 'google' as const;
    const sub = String(claims?.sub ?? '');
    const email = String(claims?.email ?? '');
    const name = claims?.name ? String(claims.name) : undefined;
    const picture = claims?.picture ? String(claims.picture) : undefined;
    const emailVerified = Boolean(claims?.email_verified);

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
}
