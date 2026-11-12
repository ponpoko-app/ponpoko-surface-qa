import { openBackend } from "./rpc.mjs";

const withNetwork = process.argv.includes("--check");

const backend = await openBackend();
try {
  const status = await backend.call("qa.pi.status");
  const bundled = status?.bundled ?? {};
  const extensions = Array.isArray(status?.extensions) ? status.extensions : [];

  console.log(JSON.stringify({ bundled, machine: status?.machine ?? null, extensions }, null, 2));

  if (bundled.embedded !== true) {
    console.error("pi: the bundle did not report an embedded pi, so this surface is not bundling it");
    process.exit(1);
  }
  if (typeof bundled.version !== "string" || bundled.version.trim().length === 0) {
    console.error("pi: an embedded pi without a version is not a bundle anyone can check");
    process.exit(1);
  }
  if (!Array.isArray(status?.extensions)) {
    console.error("pi: the backend answered no extension list");
    process.exit(1);
  }

  if (withNetwork) {
    const checked = await backend.call("qa.pi.check");
    console.log(JSON.stringify({ checked }, null, 2));
    if (!("latest_version" in (checked ?? {}))) {
      console.error("check: the registry answer carried no version field, so nothing is known");
      process.exit(1);
    }
  }
} finally {
  await backend.close();
}
