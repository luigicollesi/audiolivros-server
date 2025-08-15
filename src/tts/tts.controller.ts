// tts.controller.ts
import { Controller, Get, Query, BadRequestException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TtsService } from './tts.service';

const ACCEPTED = new Set(['audio/mpeg','audio/ogg','audio/aac']);

@Controller('tts')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  // ... session igual

  @Get('stream')
  async stream(
    @Query('title') title: string,
    @Query('voice') voice: string,
    @Query('format') format: string,
    @Query('nocache') nocache: string,
    @Res() res: Response,
  ) {
    if (!title) throw new BadRequestException('Query param "title" é obrigatório.');
    title = title.trim().slice(0, 200);
    const outFormat = ACCEPTED.has(format) ? format : 'audio/mpeg';
    const language = process.env.SPEECHIFY_LANGUAGE || undefined;
    const voiceId  = (voice || '').trim();
    const noCache  = nocache === '1';

    const text = `Lendo, realisticamente, o resumo do livro "${title}" para você.`;

    try {
      const { stream, cacheHit } = await this.tts.streamOrCache({
        text, voice: voiceId, format: outFormat, language, noCache,
      });

      // headers só agora
      res.setHeader('Content-Type', outFormat);
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-TTS-Voice-Requested', voiceId || 'default');
      res.setHeader('X-TTS-Cache', cacheHit ? 'HIT' : 'MISS');

      // se o cliente fechar, apenas pare de enviar para ele
      res.on('close', () => {
        try { stream.unpipe(res); } catch {}
        // NÃO destruímos o stream aqui; deixamos o cache terminar
      });

      stream.on('error', (err) => {
        console.error('[TTS stream] erro no readable:', err?.message || err);
        if (!res.headersSent) res.status(502);
        res.end();
      });

      stream.pipe(res);
    } catch (e: any) {
      console.error('[TTS stream] erro upstream:', e?.message || e);
      if (!res.headersSent) res.status(502).type('text/plain').send(`Erro TTS: ${e?.message || e}`);
      else res.end();
    }
  }
}
