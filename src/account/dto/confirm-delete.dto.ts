import { Transform } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';

export class ConfirmDeleteDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString({ message: 'code deve ser uma string.' })
  @MinLength(4, { message: 'code inválido.' })
  code!: string;
}
