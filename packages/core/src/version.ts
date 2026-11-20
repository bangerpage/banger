declare const __BANGER_VERSION__: string | undefined;

/** The version of this runtime. The build replaces the constant; unbundled test runs see `0.0.0-dev`. */
export const version: string = typeof __BANGER_VERSION__ === "string" ? __BANGER_VERSION__ : "0.0.0-dev";
