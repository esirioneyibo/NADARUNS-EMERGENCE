import * as Application from "expo-application";
import Constants from "expo-constants";

/**
 * Returns a human-readable app version string, e.g. "v1.0.0 (12)".
 *
 * - The version (1.0.0) comes from the native build / app.json `expo.version`.
 * - The build number (12) comes from the native build — iOS `buildNumber` /
 *   Android `versionCode`. With EAS `autoIncrement` enabled, this value is
 *   bumped automatically on every new production build, so the app always
 *   shows its current build without any manual edits.
 *
 * On web / Expo Go the native build number isn't available, so we fall back to
 * just the version string.
 */
export function getAppVersionDisplay(): string {
  const version =
    Application.nativeApplicationVersion ||
    Constants.expoConfig?.version ||
    "1.0.0";
  const build = Application.nativeBuildVersion;
  return build ? `v${version} (${build})` : `v${version}`;
}
