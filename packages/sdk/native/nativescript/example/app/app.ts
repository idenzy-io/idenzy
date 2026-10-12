import { Application, Label, Page } from "@nativescript/core";
import { selfTest } from "./self-test";

// One page whose only job is the self-test: its outcome is logged and shown.
Application.run({
  create: () => {
    const page = new Page();
    const outcome = new Label();
    outcome.text = "IDENZY_SELF_TEST running";
    outcome.textWrap = true;
    outcome.margin = 48;
    page.content = outcome;
    void selfTest().then((result) => {
      console.log(`IDENZY_SELF_TEST ${result}`);
      outcome.text = `IDENZY_SELF_TEST ${result}`;
    });
    return page;
  },
});
