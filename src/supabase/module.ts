// src/supabase/module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';
export const SB_ADMIN  = 'SB_ADMIN';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [
    // Leitura pública (papel anon / com RLS)
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): SupabaseClient =>
        createClient(cfg.get('SUPABASE_URL')!, cfg.get('SUPABASE_ANON_KEY')!, {
          auth: { persistSession: false, detectSessionInUrl: false },
        }),
    },
    // Escrita/Admin (service_role) — NUNCA expor ao cliente
    {
      provide: SB_ADMIN,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): SupabaseClient =>
        createClient(cfg.get('SUPABASE_URL')!, cfg.get('SUPABASE_SERVICE_ROLE_KEY')!, {
          auth: { persistSession: false, detectSessionInUrl: false },
        }),
    },
  ],
  exports: [SUPABASE_CLIENT, SB_ADMIN],
})
export class SupabaseModule {}
