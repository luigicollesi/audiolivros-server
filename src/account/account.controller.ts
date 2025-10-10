import {
  Body,
  Controller,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountService } from './account.service';
import { RequestPhoneDto } from './dto/request-phone.dto';
import { ConfirmPhoneDto } from './dto/confirm-phone.dto';
import { UpdateLanguageDto } from './dto/update-language.dto';
import { ConfirmDeleteDto } from './dto/confirm-delete.dto';

interface SessionizedRequest extends Request {
  session?: {
    userId: string;
  };
}

@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  private requireProfileId(req: SessionizedRequest): string {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }
    return profileId;
  }

  @Post('phone/request')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async requestPhone(
    @Req() req: SessionizedRequest,
    @Body() body: RequestPhoneDto,
  ) {
    const profileId = this.requireProfileId(req);
    return this.account.requestPhoneChange(profileId, body.phone);
  }

  @Post('phone/confirm')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async confirmPhone(
    @Req() req: SessionizedRequest,
    @Body() body: ConfirmPhoneDto,
  ) {
    const profileId = this.requireProfileId(req);
    return this.account.confirmPhoneChange(profileId, body.code);
  }

  @Patch('language')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async updateLanguage(
    @Req() req: SessionizedRequest,
    @Body() body: UpdateLanguageDto,
  ) {
    const profileId = this.requireProfileId(req);
    return this.account.updateLanguage(profileId, body.languageId);
  }

  @Post('delete/request')
  async requestDeletion(@Req() req: SessionizedRequest) {
    const profileId = this.requireProfileId(req);
    return this.account.requestAccountDeletion(profileId);
  }

  @Post('delete/confirm')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async confirmDeletion(
    @Req() req: SessionizedRequest,
    @Body() body: ConfirmDeleteDto,
  ) {
    const profileId = this.requireProfileId(req);
    return this.account.confirmAccountDeletion(profileId, body.code);
  }
}
