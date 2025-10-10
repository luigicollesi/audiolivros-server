import { Transform } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';

export class RequestPhoneDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString({ message: 'phone deve ser uma string.' })
  @MinLength(5, { message: 'phone inválido.' })
  phone!: string;
}
