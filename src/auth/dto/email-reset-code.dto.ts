import { IsNotEmpty, IsString, Length } from 'class-validator';

export class EmailResetVerifyDto {
  @IsString()
  @IsNotEmpty()
  pendingToken!: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 8)
  code!: string;
}
