// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ProfileDetailsService } from './profile-details.service';
import { PhoneVerificationService } from './phone-verification.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordsService } from './passwords.service';
import { DuplicateRequestDetectorService } from './duplicate-request-detector.service';
import { DuplicateRequestStatsService } from './duplicate-request-stats.service';
import { TermsAcceptanceService } from './terms-acceptance.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    JwtModule.register({
      secret: process.env.APP_JWT_SECRET || 'dev-secret',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    ProfileDetailsService,
    PhoneVerificationService,
    EmailVerificationService,
    PasswordsService,
    DuplicateRequestDetectorService,
    DuplicateRequestStatsService,
    TermsAcceptanceService,
  ],
  exports: [
    ProfileDetailsService,
    EmailVerificationService,
    DuplicateRequestDetectorService,
    DuplicateRequestStatsService,
  ],
})
export class AuthModule {}
