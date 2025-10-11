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
  private readonly cleanupInterval: NodeJS.Timeout;

  // Configuration
  private readonly maxAge = 30000; // 30 seconds
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
    return this.pendingRequests.has(signature);
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

    this.logger.debug(`Requisição registrada: ${req.method} ${req.url} - signature: ${signature.slice(0, 16)}...`);

    // Return cleanup function
    return () => {
      const pending = this.pendingRequests.get(signature);
      if (pending) {
        pending.resolve('completed');
        this.pendingRequests.delete(signature);
        this.logger.debug(`Requisição finalizada: ${signature.slice(0, 16)}...`);
      }
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

    if (cleanedCount > 0) {
      this.logger.debug(`Limpeza automática: ${cleanedCount} requisições expiradas removidas`);
    }
  }

  /**
   * Get current statistics about pending requests
   */
  getStats() {
    return {
      pendingRequests: this.pendingRequests.size,
      maxAge: this.maxAge,
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
    this.logger.log('DuplicateRequestDetectorService destroyed');
  }
}
