import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Delete,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { FavoritesService } from './favorites.service';
import { AddFavoriteDto } from './dto/add-favorite.dto';
import { GetFavoritesQueryDto } from './dto/get-favorites-query.dto';

interface SessionizedRequest extends Request {
  session?: {
    userId: string;
  };
}

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Post()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async addFavorite(
    @Req() req: SessionizedRequest,
    @Body() body: AddFavoriteDto,
  ) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const result = await this.favorites.addFavorite(
      profileId,
      body.title,
      body.author,
      body.languageId,
    );
    return result;
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async listFavorites(
    @Req() req: SessionizedRequest,
    @Query() q: GetFavoritesQueryDto,
  ) {
    if (q.end < q.start) {
      throw new BadRequestException(
        'Parâmetros inválidos: use start>=0 e end>=start.',
      );
    }

    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    return this.favorites.getFavorites(profileId, q.languageId, q.start, q.end);
  }

  @Delete()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async removeFavorite(
    @Req() req: SessionizedRequest,
    @Body() body: AddFavoriteDto,
  ) {
    const profileId = req.session?.userId;
    if (!profileId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    return this.favorites.removeFavorite(
      profileId,
      body.title,
      body.author,
      body.languageId,
    );
  }
}
