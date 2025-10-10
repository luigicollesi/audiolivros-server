import { IsNotEmpty, IsString, Length } from 'class-validator';

export class EmailVerifyCodeDto {
  @IsString()
  @IsNotEmpty()
  pendingToken!: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 8)
  code!: string;
}
