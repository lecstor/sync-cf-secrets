---
"sync-cf-secrets": patch
---

Publish via npm OIDC trusted publisher with provenance attestations. There is no longer a long-lived `NPM_TOKEN` anywhere — neither on a maintainer's laptop nor in GitHub Actions secrets. Releases now only happen from `.github/workflows/release.yml` (triggered by `vX.Y.Z` tag pushes), which exchanges a short-lived GitHub OIDC token for an npm publish token at the moment of publish. Published tarballs are stamped with an npm provenance attestation, and the npmjs.com page for this package shows the "Built and signed on GitHub Actions" badge linking back to the exact workflow run. No user-facing CLI or API changes.
