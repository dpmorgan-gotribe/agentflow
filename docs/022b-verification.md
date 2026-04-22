# Task 02/022b — UI Kit Consumption Contract: Verification Report

## factory templates (10/10)

- [x] exists: .claude/templates/ui-kit-contract.md
- [x] exists: .claude/templates/ui-kit-tsconfig-consumer.json
- [x] exists: .claude/templates/ui-kit-validate-consumer.ts
- [x] exists: .claude/templates/ui-kit-eslint-plugin/package.json
- [x] exists: .claude/templates/ui-kit-eslint-plugin/index.js
- [x] exists: .claude/templates/ui-kit-eslint-plugin/README.md
- [x] exists: .claude/templates/ui-kit-eslint-plugin/rules/no-deep-imports.js
- [x] exists: .claude/templates/ui-kit-eslint-plugin/rules/no-hex-in-className.js
- [x] exists: .claude/templates/ui-kit-eslint-plugin/rules/no-arbitrary-tailwind.js
- [x] exists: .claude/templates/ui-kit-eslint-plugin/rules/no-inline-style-tokens.js

## contract.md content (4/4)

- [x] has all 6 numbered rules
- [x] has allowed escape hatches
- [x] has enforcement block
- [x] escalation path via /plan-feature feature-area: ui-kit

## eslint-plugin (4/4)

- [x] package.json names @repo/eslint-plugin-ui-kit-contract
- [x] index.js exports 4 rules
- [x] index.js exports recommended config
- [x] rules/\*.js are syntactically loadable — all 4 load + valid meta/create

## tsconfig consumer (1/1)

- [x] exposes @repo/ui-kit only (no subpath wildcards) — keys: @repo/ui-kit

## validate-consumer (3/3)

- [x] script imports glob + fs + path
- [x] has 5 rule patterns — all 5 present
- [x] exits 0 on clean + non-zero on violations

## pattern smoke test (6/6)

- [x] deep-import pattern matches @repo/ui-kit/primitives/button — regex: /from\s+["']@repo\/ui-kit\/(primitives|patterns|layouts|lib|tokens|icons|illustrations)\/[^"']+["']/
- [x] deep-import-styles-ts matches .ts but NOT .css — ts-match:true css-match:false (expect ts=true css=false)
- [x] hex-in-className matches 'bg-[#f00]' in className — regex: /className\s*=\s*[{"'`][^{}"'`]\*#[0-9a-fA-F]{3,8}/
- [x] arbitrary-tailwind matches 'p-[13px]' but NOT 'grid-cols-[1fr,auto]' — bad-match:true good-match:false (expect bad=true good=false)
- [x] inline-style-hex matches hex in style prop — regex: /style\s*=\s*\{[^}]\*#[0-9a-fA-F]{3,8}/
- [x] deep-import pattern does NOT match barrel import — barrel correctly not flagged

## /new-project spec (3/3)

- [x] references all 4 ui-kit-contract templates in step 5b
- [x] wires ui-kit:validate-consumer script in package.json
- [x] notes tsx + glob devDep requirement

## mindapp backfill (13/13)

- [x] exists: projects/mindapp/packages/ui-kit/CONTRACT.md
- [x] exists: projects/mindapp/packages/ui-kit/tsconfig.consumer.json
- [x] exists: projects/mindapp/packages/ui-kit/scripts/validate-consumer.ts
- [x] exists: projects/mindapp/packages/ui-kit/eslint-plugin/package.json
- [x] exists: projects/mindapp/packages/ui-kit/eslint-plugin/index.js
- [x] exists: projects/mindapp/packages/ui-kit/eslint-plugin/README.md
- [x] exists: projects/mindapp/packages/ui-kit/eslint-plugin/rules/no-deep-imports.js
- [x] exists: projects/mindapp/packages/ui-kit/eslint-plugin/rules/no-hex-in-className.js
- [x] exists: projects/mindapp/packages/ui-kit/eslint-plugin/rules/no-arbitrary-tailwind.js
- [x] exists: projects/mindapp/packages/ui-kit/eslint-plugin/rules/no-inline-style-tokens.js
- [x] CONTRACT.md is real content (not placeholder)
- [x] root package.json has ui-kit:validate-consumer script — tsx packages/ui-kit/scripts/validate-consumer.ts 'apps/_/src/\*\*/_.{ts,tsx,js,jsx}'
- [x] root package.json has tsx + glob devDeps — tsx:true glob:true

## Total: 44/44
