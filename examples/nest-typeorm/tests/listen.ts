import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import type request from "supertest";

type SupertestTarget = Parameters<typeof request>[0];

/**
 * Bind `app` to an ephemeral port on the loopback, so supertest talks to a
 * server that is already listening on the address it connects to.
 *
 * Use this instead of `app.init()` in any suite that drives the app over
 * HTTP. `init()` leaves `getHttpServer()` unbound, so supertest binds it
 * per request — `listen(0)` on the *wildcard*, then a connect to a hardcoded
 * `127.0.0.1` — and that asymmetry lets the request land on an unrelated
 * local process that already holds the port (issue #91). The `await` is
 * load-bearing: `listen(0, host)` binds asynchronously, so the port exists
 * only once the promise settles.
 *
 * Deliberately duplicated from `@kavo/nest`'s copy rather than shared: a
 * test file may not reach into another package's `tests/`
 * (`.dependency-cruiser.cjs`, `tests-no-other-package-internals`).
 */
export async function listen(app: INestApplication): Promise<SupertestTarget> {
  await app.listen(0, "127.0.0.1");
  const server = app.getHttpServer() as Server;
  if (server.address() === null) {
    throw new Error("app.listen() resolved without a bound address — supertest would re-listen per request");
  }
  return server as SupertestTarget;
}
