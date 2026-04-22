# mobile-stack-codegens

**Deferred from**: investigate-002-build-tier-readiness-gap §Phase 3 Cross-cutting tooling gap + blueprint Appendix E §6.

## The concern

Non-Expo mobile stacks (Flutter, native-kotlin, native-swift) need the `@repo/ui-kit` tokens available in their native language/format:

- **Flutter** — Dart file at `packages/flutter-tokens/` with `const Color kAccent500 = Color(0xFFD97757);` equivalents
- **Native iOS (Swift)** — `Colors.xcassets` + `Assets.xcassets` bundle with color + image references
- **Native Android (Kotlin)** — `colors.xml` + `dimens.xml` in the resources tree

The blueprint Appendix E documents the pattern; no codegen exists.

## Why deferred

Shipped mobile stack skill is `expo-rn` only. Expo consumes kit tokens directly from TypeScript (same runtime as web). Until a project picks a non-Expo mobile stack, the codegens are unused.

## Rough shape when it's time

Each stack-skill authoring workflow (via `/skills-audit --scope=build --auto-author-stack-skills`) would also emit:

1. **The codegen script** at `scripts/emit-{stack}-tokens.mjs`
2. **A Turborepo task entry** in root `turbo.json` that runs pre-build
3. **A CI check** that emitted tokens match `packages/ui-kit/src/tokens/tokens.json` source
4. **Stack-skill §Canonical layout** updated to name the generated tokens' location

**Flutter specifics**:

- Dart file is a simple `sed`-style transformation (JSON → Dart `class Tokens { static const Color colorAccent500 = Color(0xFFD97757); ... }`)
- ~200 LOC codegen

**iOS native specifics**:

- `Assets.xcassets/Colors.xcassets/` is a directory tree with `Contents.json` per color
- Xcode handles asset catalog generation; the codegen writes the JSON structure
- ~300 LOC including `Contents.json` template + per-color dir creation

**Android native specifics**:

- `colors.xml` + `dimens.xml` — XML output
- NativeWind / Jetpack Compose integration varies by stack skill
- ~200 LOC

## When to revisit

When a project's `architecture.yaml.tooling.stack.mobile_framework` picks `flutter`, `native-kotlin`, `native-swift`, `bare-rn`, or `tauri-mobile`. Codegen lands with the corresponding stack-skill author.

## Related

See `python-stack-codegens.md` for the parallel concern on backend languages. Both should probably share a `packages/codegen-helpers/` module to keep patterns consistent (token enumeration, comment headers, "do not edit — generated" warnings, CI validation).
