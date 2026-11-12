import { bundledVersion, piMethods } from "./pi/status";
import { handsMethods } from "./probe";
import { mergeRegistries, resolveEnv, serve } from "./rpc";
import { storeMethods } from "./store";

const env = resolveEnv();

const registry = mergeRegistries(
  {
    "app.info": async () => ({
      protocol: 1,
      identity: process.env.PONPOKO_SURFACE_ID ?? "qa",
      host_version: process.env.PONPOKO_VERSION ?? null,
      bundled_pi_version: bundledVersion(),
      embedded_pi: true,
      data_dir: env.dataDir,
    }),
  },
  handsMethods(env),
  storeMethods(env),
  piMethods(env),
);

await serve(registry);
