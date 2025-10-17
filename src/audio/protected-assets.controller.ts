// src/audio/protected-assets.controller.ts
import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { join } from 'path';
import { createReadStream, existsSync, statSync } from 'fs';
import { AssetAccessLoggerService } from './asset-access-logger.service';
import { ListeningProgressService } from './listening-progress.service';

interface SessionizedRequest extends Request {
  session?: {
    userId: string;
    tokenId: string;
    provider: string;
    providerSub?: string;
    expiresAt: string;
  };
}

@Controller()
export class ProtectedAssetsController {
  private readonly logger = new Logger(ProtectedAssetsController.name);
  private readonly publicPath = join(__dirname, '..', '..', 'public');

  constructor(
    private readonly accessLogger: AssetAccessLoggerService,
    private readonly listeningProgress: ListeningProgressService,
  ) {}

  @Get('covers/:filename')
  async getCoverFile(
    @Param('filename') filename: string,
    @Req() req: SessionizedRequest,
    @Res() res: Response,
  ) {
    return this.serveProtectedFile('covers', filename, req, res);
  }

  @Get('audios/:folder/:filename')
  async getAudioFile(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Req() req: SessionizedRequest,
    @Res() res: Response,
  ) {
    return this.serveProtectedFile('audios', filename, req, res, folder);
  }

  @Get('audios/:filename')
  async getAudioFileRoot(
    @Param('filename') filename: string,
    @Req() req: SessionizedRequest,
    @Res() res: Response,
  ) {
    return this.serveProtectedFile('audios', filename, req, res);
  }

  private async serveProtectedFile(
    assetType: 'covers' | 'audios',
    filename: string,
    req: SessionizedRequest,
    res: Response,
    subfolder?: string,
  ) {
    // Verificar se o usuário está autenticado
    const userId = req.session?.userId;
    if (!userId) {
      this.accessLogger.logFailedAccess(
        filename,
        subfolder,
        'Usuário não autenticado',
        undefined,
        req.ip || req.connection?.remoteAddress,
        assetType === 'audios' ? 'audio' : 'cover',
      );
      throw new UnauthorizedException(
        `Acesso negado. Faça login para acessar ${assetType}.`,
      );
    }

    // Sanitizar parâmetros para evitar path traversal
    const sanitizedFilename = this.sanitizePath(filename);
    const sanitizedSubfolder = subfolder ? this.sanitizePath(subfolder) : null;

    if (!sanitizedFilename) {
      this.accessLogger.logFailedAccess(
        filename,
        subfolder,
        'Nome de arquivo inválido',
        userId,
        req.ip || req.connection?.remoteAddress,
        assetType === 'audios' ? 'audio' : 'cover',
      );
      throw new NotFoundException(`Arquivo ${assetType} não encontrado.`);
    }

    // Construir caminho do arquivo
    const pathSegments = [this.publicPath, assetType];
    if (sanitizedSubfolder) {
      pathSegments.push(sanitizedSubfolder);
    }
    pathSegments.push(sanitizedFilename);

    const filePath = join(...pathSegments);

    // Verificar se o arquivo existe
    if (!existsSync(filePath)) {
      this.accessLogger.logFailedAccess(
        sanitizedFilename,
        sanitizedSubfolder || undefined,
        'Arquivo não encontrado',
        userId,
        req.ip || req.connection?.remoteAddress,
        assetType === 'audios' ? 'audio' : 'cover',
      );
      throw new NotFoundException(`Arquivo ${assetType} não encontrado.`);
    }

    try {
      const stats = statSync(filePath);
      const fileSize = stats.size;

      // Log do acesso
      await this.accessLogger.logAccess({
        userId,
        fileName: sanitizedFilename,
        folder: sanitizedSubfolder || undefined,
        fileSize,
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection?.remoteAddress,
        timestamp: new Date().toISOString(),
        accessType: req.headers.range ? 'range' : 'full',
        rangeStart: req.headers.range
          ? this.parseRangeStart(req.headers.range)
          : undefined,
        rangeEnd: req.headers.range
          ? this.parseRangeEnd(req.headers.range, fileSize)
          : undefined,
        assetType: assetType === 'audios' ? 'audio' : 'cover',
      });

      // Configurar headers baseado no tipo de asset
      if (assetType === 'audios') {
        return this.serveAudioFile(filePath, filename, stats, req, res);
      } else {
        return this.serveImageFile(filePath, filename, stats, req, res);
      }
    } catch (error) {
      this.logger.error(
        `Erro ao servir ${assetType} ${sanitizedFilename} para user ${userId}: ${error}`,
      );
      throw new NotFoundException(`Erro ao carregar arquivo ${assetType}.`);
    }
  }

  private async serveAudioFile(
    filePath: string,
    filename: string,
    stats: any,
    req: SessionizedRequest,
    res: Response,
  ) {
    const fileSize = stats.size;
    const userId = req.session?.userId!;

    // Estimar duração do áudio baseado no tamanho (aproximação)
    // Para MP3: ~1MB por minuto em qualidade média
    const estimatedDurationSeconds = Math.round(
      fileSize / ((1024 * 1024) / 60),
    );

    // Variável para controlar se já iniciamos o rastreamento
    let sessionStarted = false;

    // Configurar headers para áudio
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', fileSize.toString());
    res.setHeader('Content-Type', this.getAudioContentType(filename));
    res.setHeader('Cache-Control', 'private, max-age=3600'); // 1 hora
    res.setHeader('ETag', `"${stats.mtime.getTime()}-${fileSize}"`);

    // Função para finalizar sessão (executada apenas uma vez)
    let sessionEnded = false;
    const endSession = async () => {
      if (!sessionEnded && sessionStarted) {
        sessionEnded = true;
        await this.listeningProgress.endListeningSession(userId, filename);
        this.logger.debug(`Sessão finalizada para ${userId}: ${filename}`);
      }
    };

    // Suporte para Range requests (importante para áudio)
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      // Calcular posição aproximada no áudio baseada no byte range
      const progressPercent = start / fileSize;
      const estimatedPosition = progressPercent * estimatedDurationSeconds;

      // Iniciar sessão apenas na primeira requisição (ou se posição significativa)
      if (!sessionStarted && (start === 0 || estimatedPosition > 5)) {
        sessionStarted = true;
        await this.listeningProgress.startListeningSession(
          userId,
          filename,
          estimatedDurationSeconds,
          estimatedPosition,
        );
        this.logger.debug(
          `Sessão iniciada para ${userId}: ${filename} na posição ${estimatedPosition}s`,
        );
      } else if (sessionStarted) {
        // Apenas atualizar posição se sessão já foi iniciada
        await this.listeningProgress.updateListeningPosition(
          userId,
          filename,
          estimatedPosition,
        );
      }

      res.status(206); // Partial Content
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunkSize.toString());

      const stream = createReadStream(filePath, { start, end });

      // Detectar quando a conexão é fechada
      req.on('close', endSession);
      req.on('aborted', endSession);
      res.on('close', endSession);
      res.on('finish', endSession);

      stream.on('error', (err) => {
        this.logger.error(`Erro no stream de áudio: ${err.message}`);
        endSession();
      });

      stream.pipe(res);
    } else {
      // Servir arquivo completo (menos comum para áudio)
      if (!sessionStarted) {
        sessionStarted = true;
        await this.listeningProgress.startListeningSession(
          userId,
          filename,
          estimatedDurationSeconds,
          0,
        );
        this.logger.debug(
          `Sessão iniciada (arquivo completo) para ${userId}: ${filename}`,
        );
      }

      const stream = createReadStream(filePath);

      // Detectar quando a conexão é fechada
      req.on('close', endSession);
      req.on('aborted', endSession);
      res.on('close', endSession);
      res.on('finish', endSession);

      stream.on('error', (err) => {
        this.logger.error(`Erro no stream de áudio: ${err.message}`);
        endSession();
      });

      stream.pipe(res);
    }
  }

  private serveImageFile(
    filePath: string,
    filename: string,
    stats: any,
    req: SessionizedRequest,
    res: Response,
  ) {
    const fileSize = stats.size;

    // Configurar headers para imagem
    res.setHeader('Content-Length', fileSize.toString());
    res.setHeader('Content-Type', this.getImageContentType(filename));
    res.setHeader('Cache-Control', 'private, max-age=86400'); // 24 horas
    res.setHeader('ETag', `"${stats.mtime.getTime()}-${fileSize}"`);

    // Verificar If-None-Match para cache
    const ifNoneMatch = req.headers['if-none-match'];
    const etag = `"${stats.mtime.getTime()}-${fileSize}"`;

    if (ifNoneMatch === etag) {
      res.status(304).end(); // Not Modified
      return;
    }

    // Servir arquivo completo
    const stream = createReadStream(filePath);
    stream.pipe(res);
  }

  /**
   * Sanitiza o caminho para prevenir path traversal attacks
   */
  private sanitizePath(path: string): string | null {
    if (!path || typeof path !== 'string') {
      return null;
    }

    // Remove caracteres perigosos
    const sanitized = path
      .replace(/\.\./g, '') // Remove ..
      .replace(/[\/\\]/g, '') // Remove / e \
      .replace(/[<>:"|?*]/g, '') // Remove caracteres especiais
      .trim();

    // Verificar se ainda é um nome válido
    if (!sanitized || sanitized.length === 0 || sanitized.length > 255) {
      return null;
    }

    return sanitized;
  }

  /**
   * Determina o Content-Type baseado na extensão do arquivo de áudio
   */
  private getAudioContentType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();

    switch (ext) {
      case 'mp3':
        return 'audio/mpeg';
      case 'ogg':
        return 'audio/ogg';
      case 'aac':
        return 'audio/aac';
      case 'wav':
        return 'audio/wav';
      case 'm4a':
        return 'audio/mp4';
      case 'flac':
        return 'audio/flac';
      default:
        return 'audio/mpeg'; // fallback
    }
  }

  /**
   * Determina o Content-Type baseado na extensão do arquivo de imagem
   */
  private getImageContentType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();

    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'svg':
        return 'image/svg+xml';
      case 'bmp':
        return 'image/bmp';
      default:
        return 'image/jpeg'; // fallback
    }
  }

  private parseRangeStart(range: string): number | undefined {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    return isNaN(start) ? undefined : start;
  }

  private parseRangeEnd(range: string, fileSize: number): number | undefined {
    const parts = range.replace(/bytes=/, '').split('-');
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    return isNaN(end) ? undefined : end;
  }
}
