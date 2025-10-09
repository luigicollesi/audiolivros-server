// src/auth/session.types.d.ts
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    session?: {
      userId: string;
      tokenId: string;
      expiresAt: string; // ISO
    };
  }
}
