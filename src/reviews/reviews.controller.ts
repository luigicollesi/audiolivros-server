import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

interface SessionizedRequest extends Request {
  session?: {
    userId: string;
  };
}

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':bookId')
  async getMyReview(
    @Req() req: SessionizedRequest,
    @Param('bookId') bookId: string,
  ) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const rating = await this.reviews.getUserReview(profileId, bookId);
    return {
      bookId,
      rating,
      timestamp: new Date().toISOString(),
    };
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async upsertReview(
    @Req() req: SessionizedRequest,
    @Body() body: CreateReviewDto,
  ) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const result = await this.reviews.upsertReview(
      profileId,
      body.bookId,
      body.rating,
    );

    return {
      bookId: body.bookId,
      rating: result.rating,
      message: 'Avaliação registrada com sucesso.',
      timestamp: new Date().toISOString(),
    };
  }
}
