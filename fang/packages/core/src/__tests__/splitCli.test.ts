import { describe, it, expect } from "vitest";
import { splitCli } from "../splitCli.js";

describe("splitCli", () => {
  it("splits unquoted tokens", () => {
    expect(splitCli("pi --mode rpc")).toEqual(["pi", "--mode", "rpc"]);
  });

  it("respects double quotes", () => {
    expect(splitCli('cmd "/path/with space/bin" --flag')).toEqual([
      "cmd",
      "/path/with space/bin",
      "--flag",
    ]);
  });
});
