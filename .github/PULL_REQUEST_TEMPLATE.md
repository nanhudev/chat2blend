## What does this change?

<!-- One or two sentences. Link the issue it closes: Closes #123 -->

## Why?

## How did you verify it?

<!-- Required. "I ran it" is not enough — say what you actually observed. -->

- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] Verified in Blender: <!-- object count / screenshot / command output -->

```text
paste the observed result here
```

## Checklist

- [ ] No new **runtime** npm dependencies (dev deps are fine)
- [ ] Loopback-only binding is preserved (`127.0.0.1`)
- [ ] No API keys or tokens are stored or forwarded
- [ ] `README.md` and `README.zh-CN.md` updated if behaviour changed
- [ ] `CHANGELOG.md` entry added under `[Unreleased]`
- [ ] Unit tests added for parser / protocol changes
