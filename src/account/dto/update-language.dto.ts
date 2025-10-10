import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';

export class UpdateLanguageDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsIn(['pt-BR', 'en-US'], {
    message: 'languageId deve ser "pt-BR" ou "en-US".',
  })
  languageId!: 'pt-BR' | 'en-US';
}
