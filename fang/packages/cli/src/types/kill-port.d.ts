declare module "kill-port" {
  function killPort(
    port: number | string | Array<number | string>
  ): Promise<string | string[] | void>;
  export default killPort;
}
