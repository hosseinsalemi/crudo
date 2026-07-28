import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Kavo — Pet example")
      .setDescription(
        "Cats, dogs, and owners: full CRUD over HTTP with filtering, " +
          "sorting, pagination, layered config, and RFC 9457 problem-details " +
          "errors. Single-table inheritance (Cat/Dog) and an Owner relation " +
          "model the schema, with opt-in relation includes " +
          "(`?include=owner`, `?include=pets`) and soft delete on owners.",
      )
      .setVersion("0.0.0")
      .build(),
  );
  SwaggerModule.setup("docs", app, document);

  await app.listen(3000);
}

void bootstrap();
