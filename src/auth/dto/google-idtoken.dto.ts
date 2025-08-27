import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class DeviceDto {
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsString() app_version?: string;
}

export class GoogleIdTokenDto {
  @IsString()
  id_token!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}
