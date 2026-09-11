const number = "(?:0|[1-9][0-9]*)";
const identifier = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const semver = new RegExp(`^${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);

export function isVersion(value) {
  return typeof value === "string" && semver.test(value);
}

export function validateReleaseTag(tag, version, packages) {
  if (!isVersion(version) || version === "0.0.0") throw new Error("Release version must be set to a valid semantic version");
  if (tag !== `v${version}`) throw new Error(`Release tag ${tag} does not match package version ${version}`);
  for (const manifest of packages) {
    if (manifest.version !== version) throw new Error(`${manifest.name} is ${manifest.version}; expected ${version}`);
  }
}
