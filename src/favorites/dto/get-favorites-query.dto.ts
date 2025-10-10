import { Transform } from 'class-transformer';
import { IsIn, IsInt, Min } from 'class-validator';

export class GetFavoritesQueryDto {
  @Transform(({ value }) =>
    value === undefined || value === '' ? 'en-US' : String(value).trim(),
  )
  @IsIn(['pt-BR', 'en-US'], {
    message: 'languageId deve ser "pt-BR" ou "en-US".',
  })
  languageId: 'pt-BR' | 'en-US' = 'en-US';

  @Transform(({ value }) =>
    value === undefined || value === '' ? 0 : Number(value),
  )
  @IsInt({ message: 'start deve ser inteiro.' })
  @Min(0, { message: 'start deve ser >= 0.' })
  start: number = 0;

  @Transform(({ value }) =>
    value === undefined || value === '' ? 9 : Number(value),
  )
  @IsInt({ message: 'end deve ser inteiro.' })
  @Min(0, { message: 'end deve ser >= 0.' })
  end: number = 9;
}
