import { IsEmail } from 'class-validator';

export class EmailResetRequestDto {
  @IsEmail()
  email!: string;
}
