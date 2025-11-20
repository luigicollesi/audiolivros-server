import { IsNotEmpty, IsString } from 'class-validator';

export class AcceptTermsDto {
  @IsString()
  @IsNotEmpty()
  pendingToken!: string;
}
