import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import type request from "supertest";

type SupertestTarget = Parameters<typeof request>[0];

/**
 * Bind `app` to an ephemeral port on the loopback, and hand back the
 * listening server for `request(...)`.
 *
 * Use this instead of `app.init()` in any suite that drives the app over
 * HTTP. `init()` leaves `getHttpServer()` unbound, so supertest binds it
 * itself, once per request: `listen(0)` on the **wildcard**, then a connect
 * to a hardcoded `127.0.0.1` (supertest 7, `lib/test.js`). That asymmetry is
 * a lottery over the ephemeral range — a wildcard `bind(0)` can be handed a
 * port an unrelated local process already holds on the loopback, and the
 * request is then delivered to that process, which is what made these suites
 * ~10% flaky (issue #91). Binding once, on the address supertest connects
 * to, removes the lottery.
 *
 * The `await` is load-bearing: `listen(0, host)` resolves the host
 * asynchronously, unlike the no-host path, so the port exists only once the
 * promise settles. The assertion pins that down — an unbound server here
 * would silently send supertest back to binding per request, and the fix
 * would do nothing.
 */
export async function listen(app: INestApplication): Promise<SupertestTarget> {
  await app.listen(0, "127.0.0.1");
  const server = app.getHttpServer() as Server;
  if (server.address() === null) {
    throw new Error("app.listen() resolved without a bound address — supertest would re-listen per request");
  }
  return server as SupertestTarget;
}
