// tts.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { Readable, PassThrough } from 'stream';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export type StreamParams = {
  text: string;
  voice?: string;       // passe aqui o voice_id
  format?: string;
  language?: string;
  signal?: AbortSignal; // mantenha se quiser cancelamentos próprios (não do cliente)
  noCache?: boolean;
};

export interface TtsProvider {
  stream(params: { text: string; voice?: string; format?: string; language?: string; signal?: AbortSignal }): Promise<Readable>;
}

@Injectable()
export class TtsService {
  constructor(@Inject('TTS_PROVIDER') private provider: TtsProvider) {}

  private cacheDir = process.env.TTS_CACHE_DIR || path.join(process.cwd(), '.cache', 'tts');

  private ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  private cacheKey({ text, voice, format, language }: StreamParams) {
    const keyInput = [
      `t=${text}`,
      `v=${(voice || 'default').trim().toLowerCase()}`,
      `f=${format || 'audio/mpeg'}`,
      `l=${language || ''}`,
    ].join('|');
    return crypto.createHash('sha256').update(keyInput).digest('hex');
  }

  private cachePath(key: string, format?: string) {
    const ext = (format === 'audio/ogg') ? '.ogg'
            : (format === 'audio/aac') ? '.aac'
            : '.mp3';
    return path.join(this.cacheDir, `${key}${ext}`);
  }

  /**
   * Retorna stream para o cliente e grava cache em paralelo.
   * Não interrompe a gravação ao cliente abortar; assim o cache completa.
   */
  async streamOrCache(params: StreamParams): Promise<{ stream: Readable; cacheHit: boolean; filePath?: string }> {
    this.ensureCacheDir();

    const key = this.cacheKey(params);
    const filePath = this.cachePath(key, params.format);
    const tmpPath  = `${filePath}.part`;

    // HIT de cache
    if (!params.noCache && fs.existsSync(filePath)) {
      return { stream: fs.createReadStream(filePath), cacheHit: true, filePath };
    }

    // MISS: pedir upstream
    const upstream = await this.provider.stream(params);

    // tee para cliente
    const toClient = new PassThrough();

    // stream para arquivo temporário
    const fileStream = fs.createWriteStream(tmpPath, { flags: 'w' });

    const cleanupTmp = async () => {
      try { await fsp.unlink(tmpPath); } catch {}
    };

    // Encaminha para os dois destinos
    upstream.on('error', async (err) => {
      // erro no upstream: para cliente e apaga temp
      toClient.destroy(err);
      fileStream.destroy(err);
      await cleanupTmp();
    });

    fileStream.on('error', async () => {
      // erro de disco: não destrói o upstream (deixa cliente seguir), mas apaga temp
      await cleanupTmp();
    });

    fileStream.on('finish', async () => {
      // só aqui o arquivo virou válido
      try { await fsp.rename(tmpPath, filePath); } catch {}
    });

    // pipe duplo
    upstream.pipe(toClient);
    upstream.pipe(fileStream);

    return { stream: toClient, cacheHit: false, filePath };
  }
}
