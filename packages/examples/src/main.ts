import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Crudo — Milestone B checkpoint")
      .setDescription(
        "One entity, full CRUD over HTTP with filtering, sorting, " +
          "pagination, layered config, and RFC 9457 problem-details errors.",
      )
      .setVersion("0.0.0")
      .build(),
  );
  SwaggerModule.setup("docs", app, document);

  await app.listen(3000);
  console.log("Crudo checkpoint app: http://localhost:3000/users (docs at /docs)");
}

void bootstrap();
