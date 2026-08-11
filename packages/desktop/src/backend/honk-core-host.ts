import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { makeNodeHost } from "@honk/core/node-host";
import { createNodeExecutionEnv } from "@honk/core/node";

import * as DesktopEnvironment from "../app/desktop-environment";

export { Rpcs } from "@honk/core";
export {
  HonkNodeHost as HonkCoreHost,
  makeNodeHost as make,
  type HonkNodeHostShape as HonkCoreHostShape,
} from "@honk/core/node-host";

/** The desktop lifecycle binding for Core's shared authenticated Node host. */
export const layer = Layer.unwrap(
  Effect.map(DesktopEnvironment.DesktopEnvironment, (environment) =>
    makeNodeHost({
      dataDirectory: join(environment.stateDir, "core"),
      createExecutionEnv: createNodeExecutionEnv,
    }),
  ),
);
