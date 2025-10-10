import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class EmailRegisterDto {
  @IsString()
  @IsNotEmpty()
  registerToken!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsOptional()
  name?: string | null;
}
