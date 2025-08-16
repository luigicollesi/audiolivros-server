// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validação global (antes de listen)
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,                 // remove campos não declarados no DTO
    transform: true,                 // ativa class-transformer nos DTOs
    transformOptions: { enableImplicitConversion: true }, // conversões básicas (string->number, etc.)
  }));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
bootstrap();
