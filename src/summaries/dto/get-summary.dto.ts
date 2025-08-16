// src/summaries/dto/get-summary.dto.ts
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetSummaryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title!: string;

  @IsString()
  @IsIn(['pt-BR', 'en-US'])
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  language!: 'pt-BR' | 'en-US';
}
