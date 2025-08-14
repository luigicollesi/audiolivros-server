import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): SupabaseClient => {
        return createClient(
          cfg.get<string>('SUPABASE_URL')!,
          cfg.get<string>('SUPABASE_ANON_KEY')!,
          { auth: { persistSession: false, detectSessionInUrl: false } }
        );
      },
    },
  ],
  exports: [SUPABASE_CLIENT],
})
export class SupabaseModule {}
