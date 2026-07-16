# AEGIS Mobile

The ai native mobile wallet for the Qorechain ecosystem.

## Requirements

- Node.js 22
- npm
- Android Studio or Xcode for native development

## Setup

```bash
npm ci
cp .env.example .env
npm run check
npm start
```

Use `npm run android` or `npm run ios` to generate and run a native development build.

`EXPO_PUBLIC_API_BASE_URL` points the application to the AEGIS API. Variables prefixed with `EXPO_PUBLIC_` are embedded in the client and must never contain secrets.

Never commit wallet mnemonics, private keys, signing material, production credentials, or local environment files. See [SECURITY.md](SECURITY.md).

This repository is private and proprietary unless a license is added explicitly.
