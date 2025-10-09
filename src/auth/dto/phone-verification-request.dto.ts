import { IsOptional, IsString, IsNotEmpty, Length } from 'class-validator';

export class PhoneVerificationRequestDto {
  @IsString()
  @IsNotEmpty()
  pendingToken!: string;

  @IsString()
  @IsNotEmpty()
  machineCode!: string;

  @IsString()
  @IsNotEmpty()
  @Length(8, 20, { message: 'Telefone deve ter entre 8 e 20 caracteres.' })
  phone!: string;

  @IsOptional()
  @IsString()
  language?: string;
}
