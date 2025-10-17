// src/audio/asset-access-logger.service.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/module';

interface AssetAccessLog {
  userId: string;
  fileName: string;
  folder?: string;
  fileSize: number;
  userAgent?: string;
  ip?: string;
  timestamp: string;
  accessType: 'full' | 'range';
  rangeStart?: number;
  rangeEnd?: number;
  assetType: 'audio' | 'cover';
}

@Injectable()
export class AssetAccessLoggerService {
  private readonly logger = new Logger(AssetAccessLoggerService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Log asset access to console and optionally to database
   */
  async logAccess(accessLog: AssetAccessLog): Promise<void> {
    const logMessage = this.formatLogMessage(accessLog);
    this.logger.log(logMessage);

    // Optionally save to database for analytics
    // Uncomment if you want to store access logs in Supabase
    /*
    try {
      const { error } = await this.supabase
        .from('asset_access_logs')
        .insert({
          user_id: accessLog.userId,
          file_name: accessLog.fileName,
          folder: accessLog.folder,
          file_size: accessLog.fileSize,
          user_agent: accessLog.userAgent,
          ip_address: accessLog.ip,
          accessed_at: accessLog.timestamp,
          access_type: accessLog.accessType,
          range_start: accessLog.rangeStart,
          range_end: accessLog.rangeEnd,
          asset_type: accessLog.assetType,
        });

      if (error) {
        this.logger.error(`Erro ao salvar log de acesso: ${error.message}`);
      }
    } catch (e) {
      this.logger.error(`Erro inesperado ao salvar log: ${e}`);
    }
    */
  }

  /**
   * Log failed access attempt
   */
  logFailedAccess(
    fileName: string,
    folder: string | undefined,
    reason: string,
    userId?: string,
    ip?: string,
    assetType: 'audio' | 'cover' = 'audio',
  ): void {
    const fileIdentifier = folder ? `${folder}/${fileName}` : fileName;
    const userInfo = userId ? `User: ${userId}` : 'Usuário não autenticado';
    const ipInfo = ip ? ` - IP: ${ip}` : '';

    this.logger.warn(
      `Acesso negado ao ${assetType}: ${fileIdentifier} - ${reason} - ${userInfo}${ipInfo}`,
    );
  }

  /**
   * Format log message for console output
   */
  private formatLogMessage(accessLog: AssetAccessLog): string {
    const fileIdentifier = accessLog.folder
      ? `${accessLog.folder}/${accessLog.fileName}`
      : accessLog.fileName;

    const sizeInfo = `${Math.round(accessLog.fileSize / 1024)} KB`;
    const rangeInfo =
      accessLog.accessType === 'range'
        ? ` (Range: ${accessLog.rangeStart}-${accessLog.rangeEnd})`
        : '';

    return `${accessLog.assetType.toUpperCase()} acessado: ${fileIdentifier} - User: ${accessLog.userId} - Size: ${sizeInfo}${rangeInfo}`;
  }

  /**
   * Get access statistics for a specific user
   */
  getUserAccessStats(userId: string, hours: number = 24) {
    // This could query the database if logging is enabled
    // For now, just return a placeholder
    return {
      userId,
      periodHours: hours,
      message: 'Estatísticas de acesso não implementadas ainda',
    };
  }
}
