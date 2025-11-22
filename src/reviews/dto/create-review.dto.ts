import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  @IsNotEmpty()
  bookId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;
}
