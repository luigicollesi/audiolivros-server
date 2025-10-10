import { IsEmail } from 'class-validator';

export class EmailRequestCodeDto {
  @IsEmail()
  email!: string;
}
