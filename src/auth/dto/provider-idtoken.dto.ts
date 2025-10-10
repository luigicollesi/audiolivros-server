// src/auth/dto/provider-idtoken.dto.ts
import {
  IsOptional,
  IsString,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

class DeviceDto {
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsString() app_version?: string;
}

export class ProviderIdTokenDto {
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @IsString()
  @IsNotEmpty()
  id_token!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}
