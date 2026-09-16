# Security Policy

## Supported Versions

Chat2Blend is pre-1.0 software. Only the latest released version receives
security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a Vulnerability

**Please do not open a public issue for security problems.**

Report privately through either channel:

* GitHub private security advisory:
  <https://github.com/nanhudev/chat2blend/security/advisories/new>
* Email: `y13077816460@gmail.com` (subject: `Chat2Blend security`)

Please include:

* affected version / commit,
* OS and Blender version,
* steps to reproduce,
* impact as you see it.

We aim to acknowledge reports within 72 hours and to ship a fix or a documented
decision within 14 days. We will credit you in the fix notes unless you ask us
not to.

## Threat Model

Chat2Blend deliberately keeps a very small attack surface. The security model is
described in detail in [`docs/SECURITY.md`](./docs/SECURITY.md). Summary:

* **Loopback only.** The bridge binds to `127.0.0.1` exclusively. Binding to
  `0.0.0.0` is not supported and is rejected by design.
* **Token auth.** Each bridge start generates a random token (192 bits of
  entropy) stored in the local state directory. Every HTTP request and every
  Blender TCP frame must carry it.
* **No API keys.** Chat2Blend never stores or forwards an OpenAI API key. The
  brain is your own logged-in ChatGPT desktop app, driven over CDP.
* **No code is executed without an explicit local action.** Chunks are only run
  when the local Blender add-on dequeues them.
* **Blender main thread.** All `bpy` calls run on the main thread through
  `bpy.app.timers`, so background threads never touch Blender state.

## Out of Scope

The following are known and accepted, and are **not** treated as
vulnerabilities:

* Anything that already has arbitrary code execution as the local user — for
  example a malicious Blender script you chose to run, or a prompt that tells
  the model to emit destructive `bpy` calls. **Modelling tasks are executed as
  your own user; treat LLM output like any other untrusted code you run.**
* The CDP debugging port (`127.0.0.1:9333`) opened on the ChatGPT desktop app at
  your request. It is loopback-bound by Chromium; closing the app closes it.
* Local state files (`.state/`, `%APPDATA%\chat2blend`) readable by the current
  user.

If you believe one of these is actually exploitable by a remote attacker, report
it anyway — we would rather look and be wrong.
