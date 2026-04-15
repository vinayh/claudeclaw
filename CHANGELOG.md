# Changelog

## [1.1.0](https://github.com/vinayh/claudeclaw/compare/claudeclaw-v1.0.2...claudeclaw-v1.1.0) (2026-04-15)


### Features

* add /compact, /status, /context slash commands for Telegram & Discord ([e6420bf](https://github.com/vinayh/claudeclaw/commit/e6420bf639c1a61704e45a3065a18dd7961fbfc2))
* add /compact, /status, /context slash commands for Telegram and Discord ([1e7e282](https://github.com/vinayh/claudeclaw/commit/1e7e2821ae9050efc5fb8f205f958c1e80124946))
* add interactive chat tab to web UI ([2c6d38d](https://github.com/vinayh/claudeclaw/commit/2c6d38d412c79ab02a295380ff779747a2e14a93))
* add interactive chat tab to web UI ([bdd9017](https://github.com/vinayh/claudeclaw/commit/bdd9017cbfcdfe99fed726e7060bbeb5b9dc7535))
* add listenChannels for Discord channel-wide responses ([b7a5623](https://github.com/vinayh/claudeclaw/commit/b7a562374db235bf7fc39b1cdc85ce8290e2ac82))
* add preflight plugin installer, web dashboard, and cleanup skills ([48f53fa](https://github.com/vinayh/claudeclaw/commit/48f53fab521e1569e88af2555154f6d9397ebfd2))
* add session lifecycle controls and hardened runner security ([cf894a9](https://github.com/vinayh/claudeclaw/commit/cf894a99de0290b200853929eaa86ea434823b46))
* add skill routing for Telegram and Discord slash commands ([fe86bc0](https://github.com/vinayh/claudeclaw/commit/fe86bc0c2f258d92f8384dca042ea88aff2a3a0a))
* **discord:** add Discord bot integration with gateway, slash commands, and voice ([060c204](https://github.com/vinayh/claudeclaw/commit/060c204dc7bc09283b2a0c6a2906825fafaa0a23))
* **discord:** add Discord setup to start wizard alongside Telegram ([fbee812](https://github.com/vinayh/claudeclaw/commit/fbee812f313c4dffbb6e67e3975bde3e75eb3ff5))
* multi-session thread support for Discord ([#3](https://github.com/vinayh/claudeclaw/issues/3)) ([08799ae](https://github.com/vinayh/claudeclaw/commit/08799ae5e893dd01de8315bb55cf9b4ed47a09cf))
* project-level prompt overrides (.claude/claudeclaw/prompts/) ([dce0b74](https://github.com/vinayh/claudeclaw/commit/dce0b745bafe9a3c2bb1a46d906092f12cc87281))
* project-level prompt overrides for heartbeat and future prompts ([2a6e1e8](https://github.com/vinayh/claudeclaw/commit/2a6e1e8b335a517b54c5537f4fe03f74527381ef))
* register skill commands in Telegram bot menu ([a2bede0](https://github.com/vinayh/claudeclaw/commit/a2bede0f52141eae4bef282d731f69ba63a28bcc))
* **stt:** add configurable external STT API support ([e994541](https://github.com/vinayh/claudeclaw/commit/e994541acc035bc2c0f48787a7795c247d218260))
* **stt:** add configurable external STT API support ([b974390](https://github.com/vinayh/claudeclaw/commit/b9743905b4eed23ef0f77046cc7278a01c974c6d))
* Telegram topic/thread support + suppress HEARTBEAT_OK ([463d582](https://github.com/vinayh/claudeclaw/commit/463d5827911a786e9a0a5652d681653b5f21edf7))
* Telegram topic/thread support + suppress HEARTBEAT_OK noise ([7bc55e3](https://github.com/vinayh/claudeclaw/commit/7bc55e32f944501efde6dc0b052805f0e4d82b99))
* **telegram:** add callback_query support for inline button handling ([d062345](https://github.com/vinayh/claudeclaw/commit/d062345807d886ce2c9000aab743ff582af0d65f)), closes [#10](https://github.com/vinayh/claudeclaw/issues/10)
* **telegram:** add document attachment support ([fd85e41](https://github.com/vinayh/claudeclaw/commit/fd85e41accd25da3709e9f43f60e72d701185bf7))
* **telegram:** detect reply-to-bot for secretary custom reply flow ([048460a](https://github.com/vinayh/claudeclaw/commit/048460a25d529cda8dd5f60e9d174b043abdc485))


### Bug Fixes

* broaden rate limit pattern to catch all known messages ([4ed1d7e](https://github.com/vinayh/claudeclaw/commit/4ed1d7ea2d36e424bbeec3a3b43e8cbda3f2eb53))
* don't pre-create thread session with fake ID ([75caea7](https://github.com/vinayh/claudeclaw/commit/75caea76a9e5f7347eac984434adb6d95f983240))
* ReferenceError for undeclared variables in config and runner ([#2](https://github.com/vinayh/claudeclaw/issues/2)) ([1b42526](https://github.com/vinayh/claudeclaw/commit/1b4252677b7edff2da56256abeae2e463b8f34ef))
* rejoin threads on gateway RESUMED (not just GUILD_CREATE) ([392959b](https://github.com/vinayh/claudeclaw/commit/392959be7124966740708303b812dcfe21c9354a))
* rejoin threads on startup so gateway delivers MESSAGE_CREATE ([572ce5c](https://github.com/vinayh/claudeclaw/commit/572ce5cedef770a8ce9a6eb47ce1af2df033e53f))
* skip heartbeat when cron jobs are configured ([a7a7103](https://github.com/vinayh/claudeclaw/commit/a7a71036244bd654a9da0a3aa5aee1ec08b02d61))
