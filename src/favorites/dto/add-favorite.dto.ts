import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class AddFavoriteDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString({ message: 'title deve ser uma string.' })
  @MinLength(1, { message: 'title é obrigatório.' })
  title!: string;

  @Transform(({ value }) => String(value ?? '').trim())
  @IsString({ message: 'author deve ser uma string.' })
  @MinLength(1, { message: 'author é obrigatório.' })
  author!: string;

  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : String(value).trim(),
  )
  @IsOptional()
  @IsIn(['pt-BR', 'en-US'], {
    message: 'languageId deve ser "pt-BR" ou "en-US".',
  })
  languageId?: 'pt-BR' | 'en-US';
}
