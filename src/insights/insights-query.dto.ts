import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

const SUPPORTED_LANGUAGES = ['pt-BR', 'en-US'] as const;
export type InsightsLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export class InsightsLanguageQueryDto {
  @IsEnum(SUPPORTED_LANGUAGES, {
    message: 'languageId deve ser "pt-BR" ou "en-US".',
  })
  languageId: InsightsLanguage = 'en-US';
}

export class InsightsTopBooksQueryDto extends InsightsLanguageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'days deve ser um número inteiro.' })
  @Min(1, { message: 'days deve ser pelo menos 1.' })
  days?: number;
}
