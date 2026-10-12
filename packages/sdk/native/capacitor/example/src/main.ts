import { selfTest } from "./self-test.js";

// One page whose only job is the self-test: its outcome is logged and shown.
const outcome = document.getElementById("outcome");
void selfTest().then((result) => {
  console.log(`IDENZY_SELF_TEST ${result}`);
  if (outcome !== null) outcome.textContent = `IDENZY_SELF_TEST ${result}`;
});
