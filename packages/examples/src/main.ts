import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Crudo — Pet example")
      .setDescription(
        "Cats, dogs, and owners: full CRUD over HTTP with filtering, " +
          "sorting, pagination, layered config, and RFC 9457 problem-details " +
          "errors. Single-table inheritance (Cat/Dog) and an Owner relation " +
          "model the schema; relation includes remain a deferred feature.",
      )
      .setVersion("0.0.0")
      .build(),
  );
  SwaggerModule.setup("docs", app, document);

  await app.listen(3000);
  console.log("Crudo pet example: http://localhost:3000 — /cats /dogs /owners (docs at /docs)");
}

void bootstrap();
