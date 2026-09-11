# Security

Report suspected vulnerabilities privately through the repository's GitHub security reporting feature when available, or contact the repository owner through their GitHub profile to arrange a private report. Do not post exploit details, credentials, or application data in a public issue.

Include the affected version, a minimal reproduction, expected and observed behavior, and the likely impact. No response-time guarantee or security support window has been established yet. The first stable support line begins with the v1.0.0 release.

Inst's Unit declarations control access through its capability API; they do not sandbox JavaScript. Treat application code, build configuration, plugins, and deployment artifacts as trusted code. Build hashes detect accidental changes against the supplied manifests; they are not signatures and cannot authenticate an attacker-controlled bundle and manifest. Keep deployment directories read-only to untrusted users and do not change them during verification or serving.

HTML interpolations escape text. Use `raw()` only with trusted HTML, quote attribute values, and validate user-provided URLs for their intended use. Explicit asset mappings must point to files intended for public access. Configure a fixed Node adapter origin when absolute URLs must not depend on the incoming Host header.
