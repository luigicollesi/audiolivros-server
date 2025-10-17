// src/auth/duplicate-request-detector.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request } from 'express';

interface PendingRequest {
  timestamp: number;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

@Injectable()
export class DuplicateRequestDetectorService implements OnModuleDestroy {
  private readonly logger = new Logger(DuplicateRequestDetectorService.name);
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly recentRequests = new Map<string, number>();
  private readonly cleanupInterval: NodeJS.Timeout;

  // Configuration
  private readonly maxAge = 30000; // 30 seconds
  private readonly duplicateMemoryMs = 45000; // Keep signatures for 45s after completion
  private readonly cleanupFrequency = 5000; // 5 seconds

  constructor() {
    // Cleanup interval - remove requests older than maxAge
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldRequests();
    }, this.cleanupFrequency);
  }

  /**
   * Check if a request is a duplicate and should be blocked
   * Returns null if not duplicate, or the pending promise if duplicate
   */
  checkDuplicateRequest(req: Request, token: string): boolean {
    const signature = this.generateRequestSignature(req, token);
    if (this.pendingRequests.has(signature)) {
      this.logger.debug(
        `Requisição duplicada detectada (pendente): ${signature.slice(0, 16)}...`,
      );
      return true;
    }

    const lastSeen = this.recentRequests.get(signature);
    if (lastSeen && Date.now() - lastSeen < this.duplicateMemoryMs) {
      this.logger.debug(
        `Requisição duplicada detectada (janela recente): ${signature.slice(0, 16)}...`,
      );
      return true;
    }

    return false;
  }

  /**
   * Register a new request as pending
   * Returns a cleanup function that should be called when the request completes
   */
  registerRequest(req: Request, token: string): () => void {
    const signature = this.generateRequestSignature(req, token);

    let requestResolver: (value: any) => void;
    let requestRejecter: (error: any) => void;

    const requestPromise = new Promise((resolve, reject) => {
      requestResolver = resolve;
      requestRejecter = reject;
    });

    this.pendingRequests.set(signature, {
      timestamp: Date.now(),
      resolve: requestResolver!,
      reject: requestRejecter!,
    });

    this.logger.debug(
      `Requisição registrada: ${req.method} ${req.url} - signature: ${signature.slice(0, 16)}...`,
    );

    // Return cleanup function
    return () => {
      const pending = this.pendingRequests.get(signature);
      if (pending) {
        pending.resolve('completed');
        this.pendingRequests.delete(signature);
        this.logger.debug(
          `Requisição finalizada: ${signature.slice(0, 16)}...`,
        );
      }
      this.recentRequests.set(signature, Date.now());
    };
  }

  /**
   * Generate a unique signature for a request based on its characteristics
   */
  private generateRequestSignature(req: Request, token: string): string {
    const method = req.method;
    const url = req.url;
    const body = req.body ? JSON.stringify(req.body) : '';
    const query = req.query ? JSON.stringify(req.query) : '';

    // Include user agent and IP for additional uniqueness (optional, can be removed if too strict)
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || req.connection?.remoteAddress || '';

    // Create a hash from request characteristics + token
    const signatureData = `${method}:${url}:${body}:${query}:${token}:${userAgent}:${ip}`;
    return createHash('sha256').update(signatureData).digest('hex');
  }

  /**
   * Clean up old requests that have been pending too long
   */
  private cleanupOldRequests(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [signature, request] of this.pendingRequests.entries()) {
      if (now - request.timestamp > this.maxAge) {
        request.resolve('timeout');
        this.pendingRequests.delete(signature);
        cleanedCount++;
      }
    }

    let recentCleaned = 0;
    for (const [signature, timestamp] of this.recentRequests.entries()) {
      if (now - timestamp > this.duplicateMemoryMs) {
        this.recentRequests.delete(signature);
        recentCleaned++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(
        `Limpeza automática: ${cleanedCount} requisições expiradas removidas`,
      );
    }

    if (recentCleaned > 0) {
      this.logger.debug(
        `Limpeza automática: ${recentCleaned} assinaturas recentes expurgadas`,
      );
    }
  }

  /**
   * Get current statistics about pending requests
   */
  getStats() {
    return {
      pendingRequests: this.pendingRequests.size,
      recentRequests: this.recentRequests.size,
      maxAge: this.maxAge,
      duplicateMemoryMs: this.duplicateMemoryMs,
      cleanupFrequency: this.cleanupFrequency,
    };
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Resolve all pending requests
    for (const [signature, request] of this.pendingRequests.entries()) {
      request.resolve('shutdown');
    }

    this.pendingRequests.clear();
    this.recentRequests.clear();
    this.logger.log('DuplicateRequestDetectorService destroyed');
  }
}
