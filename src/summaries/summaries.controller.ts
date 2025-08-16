// src/summaries/summaries.controller.ts
import { Controller, Get, Query, NotFoundException, ConflictException } from '@nestjs/common';
import { SummariesService } from './summaries.service';
import { GetSummaryDto } from './dto/get-summary.dto';

@Controller('summaries')
export class SummariesController {
  constructor(private readonly summaries: SummariesService) {}

  // GET /summaries?title=O%20Pr%C3%ADncipe&language=pt-BR
  @Get()
  async getByTitleAndLanguage(@Query() q: GetSummaryDto) {
    const items = await this.summaries.findByTitleAndLanguage(q.title, q.language);

    if (items.length === 0) {
      throw new NotFoundException(`Nenhum summary encontrado para "${q.title}" em ${q.language}.`);
    }
    if (items.length > 1) {
      throw new ConflictException(
        `Foram encontrados ${items.length} summaries para "${q.title}" em ${q.language}. Era esperado apenas 1.`
      );
    }

    return items[0];
  }
}
