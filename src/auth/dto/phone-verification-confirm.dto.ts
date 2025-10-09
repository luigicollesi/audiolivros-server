import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class PhoneVerificationConfirmDto {
  @IsString()
  @IsNotEmpty()
  pendingToken!: string;

  @IsString()
  @IsNotEmpty()
  machineCode!: string;

  @IsString()
  @Matches(/^\d{5}$/, { message: 'Código deve conter exatamente 5 dígitos.' })
  code!: string;
}
