// src/auth/duplicate-request-stats.service.ts
import { Injectable, Logger } from '@nestjs/common';

interface DuplicateRequestStat {
  method: string;
  url: string;
  userAgent?: string;
  ip?: string;
  userId?: string;
}

interface DuplicateRequestRecord extends DuplicateRequestStat {
  timestamp: number;
}

@Injectable()
export class DuplicateRequestStatsService {
  private readonly logger = new Logger(DuplicateRequestStatsService.name);
  private readonly duplicateRequests: DuplicateRequestRecord[] = [];
  private readonly maxHistorySize = 1000; // Keep last 1000 duplicate requests

  /**
   * Record a duplicate request for statistics
   */
  recordDuplicateRequest(stat: DuplicateRequestStat): void {
    const record: DuplicateRequestRecord = {
      ...stat,
      timestamp: Date.now(),
    };
    this.duplicateRequests.push(record);

    // Keep only the most recent entries
    if (this.duplicateRequests.length > this.maxHistorySize) {
      this.duplicateRequests.splice(0, this.duplicateRequests.length - this.maxHistorySize);
    }

    this.logger.warn(
      `Requisição duplicada detectada: ${stat.method} ${stat.url} - User: ${stat.userId || 'unknown'} - IP: ${stat.ip || 'unknown'}`
    );
  }

  /**
   * Get statistics about duplicate requests
   */
  getStats() {
    const now = Date.now();
    const last24h = now - (24 * 60 * 60 * 1000);
    const lastHour = now - (60 * 60 * 1000);

    const recentRequests = this.duplicateRequests.filter(r => r.timestamp > last24h);
    const lastHourRequests = this.duplicateRequests.filter(r => r.timestamp > lastHour);

    // Group by endpoint
    const endpointStats = recentRequests.reduce((acc, req) => {
      const key = `${req.method} ${req.url}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Group by user
    const userStats = recentRequests.reduce((acc, req) => {
      if (req.userId) {
        acc[req.userId] = (acc[req.userId] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    return {
      totalDuplicates: this.duplicateRequests.length,
      duplicatesLast24h: recentRequests.length,
      duplicatesLastHour: lastHourRequests.length,
      topEndpoints: Object.entries(endpointStats)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10),
      topUsers: Object.entries(userStats)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10),
      historySize: this.duplicateRequests.length,
      maxHistorySize: this.maxHistorySize,
    };
  }

  /**
   * Clear all statistics
   */
  clearStats(): void {
    this.duplicateRequests.length = 0;
    this.logger.log('Estatísticas de requisições duplicadas limpas');
  }
}
