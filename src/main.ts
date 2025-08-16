// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS (ajuste origins se necessário)
  app.enableCors();

  // Validação global (uma única vez)
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,                         // remove campos não declarados no DTO
    transform: true,                         // ativa class-transformer
    transformOptions: { enableImplicitConversion: true }, // string->number etc
    // forbidNonWhitelisted: true,           // opcional: 400 se enviar campos extras
  }));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}
bootstrap();
