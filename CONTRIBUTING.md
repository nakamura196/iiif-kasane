# Contributing to IIIF Kasane

Thank you for your interest in IIIF Kasane! Bug reports, feature ideas, sample manifests and pull requests are all welcome.

Issues, pull requests and commit messages are written in English so that everyone can follow them. If English is difficult for you, you may write in Japanese (日本語でも構いません).

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs

Open an issue with the **Bug report** template. Please include:

- The URL you opened, including the `manifest=` (or `curation=`, `iiif-content=`) parameter
- What you expected and what happened instead
- Your browser and OS, and any errors shown in the browser console

If a manifest does not display correctly, a link to the manifest helps the most. Please check it with the [IIIF Presentation Validator](https://presentation-validator.iiif.io/) if you can.

## Suggesting features

Open an issue with the **Feature request** template. Describe the use case first (what material, what you want to do with it), then the feature you have in mind.

## Reporting security issues

Please do not open a public issue. See [SECURITY.md](SECURITY.md).

## Development

Requirements: Node.js 24 (the version used in CI) and npm.

```bash
git clone https://github.com/nakamura196/iiif-kasane.git
cd iiif-kasane
npm ci
npm run dev   # http://localhost:3838
```

Before opening a pull request, run:

```bash
npm run lint
npm test
npm run build
```

End-to-end tests use Playwright (`npm run test:e2e`). If you add a page or change a page's entry screen (what it shows without a manifest), run `e2e/entryPages.spec.ts` against a dev server:

```bash
E2E_BASE_URL=http://localhost:3838 npx playwright test e2e/entryPages.spec.ts
```

How to add a feature (where files go) is described in [packages/iiif-viewer/EXTENDING.md](packages/iiif-viewer/EXTENDING.md).

## Pull requests

1. Fork the repository and create a branch from `main` (for example `fix/caption-timing` or `feat/region-search`).
2. Keep each pull request focused on one change.
3. Write the title and description in English. Explain what changes for users, then how it is implemented.
4. Add or update tests where it makes sense.
5. For user-visible changes, add the text in both English and Japanese (`src/messages/` and the bilingual entries in `src/lib/`). If you cannot write Japanese, say so in the pull request and the maintainer will add it.
6. If you add a new feature, say in the description whether it should be added to the use cases (`src/lib/usecases.ts`), the news (one file in `content/news/`) or the samples (`src/lib/samples.ts`), and why.

## Commit messages

Use a short English summary in the imperative mood on the first line (for example `Fix caption timing for multi-video canvases`), followed by a blank line and details if needed. Reference issues as `#123`.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
