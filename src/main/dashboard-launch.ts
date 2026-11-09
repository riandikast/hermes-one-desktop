/** Grant the backend only the dev renderer this desktop actually serves. */
export function localDashboardEnvironment(env: NodeJS.ProcessEnv, development: boolean): NodeJS.ProcessEnv {
  const { HERMES_DESKTOP_DEV_SERVER: _inherited, ...result } = env;
  if (development && env.ELECTRON_RENDERER_URL) {
    result.HERMES_DESKTOP_DEV_SERVER = env.ELECTRON_RENDERER_URL;
  }
  return result;
}

export function dashboardCliArgs(
  profile: string | undefined,
  command: string[],
): string[] {
  return profile ? ["--profile", profile, ...command] : command;
}

export interface LocalDashboardCliOptions {
  skipBuild?: boolean;
}

export function buildLocalDashboardCliArgs(
  profile: string | undefined,
  port: number,
  options: LocalDashboardCliOptions = {},
): string[] {
  const args = dashboardCliArgs(profile, [
    "dashboard",
    "--isolated",
    "--no-open",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ]);

  if (options.skipBuild) {
    args.push("--skip-build");
  }

  return args;
}
