import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class EmailLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;
}
