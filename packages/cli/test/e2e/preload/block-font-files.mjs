import { chromium } from "playwright-core";

const launch = chromium.launch.bind(chromium);
chromium.launch = (options = {}) =>
  launch({
    ...options,
    args: [...(options.args ?? []), "--host-resolver-rules=MAP fonts.gstatic.com ~NOTFOUND"],
  });
