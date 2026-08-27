import { resolve } from "node:path";

import { loadAndVerifyNativeAutoFillInspection } from "./native-autofill-release-policy.mjs";

if (process.argv.length !== 3) {
  console.error("NATIVE_AUTOFILL_ARGUMENT_INVALID");
  process.exit(1);
}

try {
  console.log(loadAndVerifyNativeAutoFillInspection(resolve(process.argv[2])));
} catch (error) {
  console.error(error?.code ?? "NATIVE_AUTOFILL_INSPECTION_INVALID");
  process.exit(1);
}
