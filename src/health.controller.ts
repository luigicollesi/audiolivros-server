// src/health.controller.ts
import { Controller, Get, Head } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('healthz')
  getHealth() {
    return {
      ok: true,
      status: 'up',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? 'unknown',
    };
  }

  // Opcional: alguns serviços fazem HEAD
  @Head('healthz')
  headHealth() {
    return;
  }
}
