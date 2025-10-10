import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class EmailResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  resetToken!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsOptional()
  name?: string | null;
}
