import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import type request from "supertest";

/** What `request(...)` accepts — the app under test, already bound. */
export type SupertestTarget = Parameters<typeof request>[0];

/** The host supertest connects to, hardcoded in its `Test` constructor. */
const LOOPBACK = "127.0.0.1";

/**
 * Assert `server` is bound to the loopback *right now*, and hand it back for
 * `request(...)`.
 *
 * Every `server()` accessor in the e2e suites goes through this, because
 * each of the three ways the binding can be wrong is silent on its own and
 * supertest recovers from all of them the same ruinous way — by calling
 * `listen(0)` itself:
 *
 * - **absent** (`undefined`) — the spec never reached its bootstrap;
 * - **unbound** (`address()` is `null`) — the app was only `init()`ed, or was
 *   closed earlier in the test;
 * - **bound to the wildcard** (`address().address` is `::`) — `listen(0)`
 *   without a host. This is the one a null-check misses: the address is
 *   non-null and looks healthy, while supertest still connects to
 *   `127.0.0.1` and can reach a foreign process holding that port.
 */
export function boundServer(server: SupertestTarget | undefined): SupertestTarget {
  const address = (server as Server | undefined)?.address();
  if (address === null || address === undefined || typeof address === "string" || address.address !== LOOPBACK) {
    throw new Error(
      `expected a server bound to ${LOOPBACK}, got ${JSON.stringify(address) ?? "undefined"} — ` +
        "bootstrap with listen(app) rather than app.init(), and do not close it mid-test",
    );
  }
  return server as SupertestTarget;
}

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
 * promise settles. `boundServer` is what pins that down — it cannot fail
 * while the `await` is there, and fires the moment someone drops it.
 *
 * `examples/nest-typeorm/tests/support/listen.ts` and
 * `examples/nest-mongoose/tests/support/listen.ts` hold copies of this file
 * whose function bodies are byte-identical: a test file may not import
 * another package's `tests/` (`.dependency-cruiser.cjs`,
 * `tests-no-other-package-internals`). Change all three together.
 */
export async function listen(app: INestApplication): Promise<SupertestTarget> {
  await app.listen(0, LOOPBACK);
  return boundServer(app.getHttpServer() as SupertestTarget);
}
