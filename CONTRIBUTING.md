# Contributing to Cordoval Code

Thanks for helping. Cordoval Code is an open-source AI coding desktop app for Windows and Linux.

## Getting set up

1. Install Node.js 20 and Git.
2. Fork and clone the repo, then run `npm install`.
3. Run the app with `npm start`.
4. Run the tests with `npm test` (on Linux this uses `xvfb-run` and a scripted test provider, so no API key is needed).

## Making a change

- Open an issue first for anything larger than a small fix, so we can agree on the approach.
- Create a branch from `main`, keep changes focused, and add or update tests under `test/`.
- Make sure `npm test` passes before you open a pull request.
- Describe what changed and why, and include a screenshot for UI changes.

## Ground rules

- Never commit API keys or other secrets. Keys must only ever be sent to the provider's own host.
- Do not weaken the approval system: shell commands, web fetches and outside-project writes must keep asking.
- No telemetry.
- Check that changes work on both Windows and Linux.

## Reporting bugs and requesting features

Use the issue templates. For security problems, do not open a public issue; email management@cordoval.co.uk.

## License

By contributing you agree that your contributions are licensed under the MIT License.
