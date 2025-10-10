import { Transform } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';

export class ConfirmPhoneDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString({ message: 'code deve ser uma string.' })
  @MinLength(4, { message: 'code inválido.' })
  code!: string;
}
