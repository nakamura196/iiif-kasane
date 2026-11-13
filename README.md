# IIIF Kasane

[日本語](README.ja.md)

A web application for viewing and annotating IIIF resources — 3D models, images, audio and video — based on IIIF Manifest specifications.

Formerly **IIIF 3D Viewer**. The project started as a 3D viewer and now handles other media as well. *Kasane* (重ね) is the Japanese word for "layering", as in *kasane no irome*, the layered colours of Heian-period court dress: the viewer layers models, images, media and annotations in one view.

## Features

- **3D Models**: GLB/GLTF models and point clouds, initial views, and switching between models placed at the same position
- **Images**: Deep zoom via the IIIF Image API, rotation, and Canvases composed from multiple images
- **Audio and Video**: Playback with captions and time-aligned transcripts, including Canvases that combine multiple media
- **Annotations**: Points on 3D models, image regions and media times, with grouping, tags, search and filtering
- **Comparison and Maps**: Side-by-side, swipe and spyglass comparison of two models; a map view for georeferenced resources
- **Structure, Sharing and Embedding**: Tables of contents, paging, two-page spreads, Collections, IIIF Content State links, `/viewer?manifest=<URL>&canvas=<n>` to open a given frame (from 1, or a Canvas URI), and the `<iiif-viewer>` custom element
- **IIIF Curation API**: Curations (`cr:Curation`, [CODH Curation API 1.0](https://codh.rois.ac.jp/iiif/curation/)) gathered from several manifests open as one item, with each region in the table of contents. Open one with `/viewer?curation=<URL>&pos=<n>` (the same parameters as IIIF Curation Viewer) or `/viewer?iiif-content=<URL>`
- **Multi-language Support**: Available in English and Japanese
- **Static Export**: Deployable as a static site to any hosting service
- **Responsive Design**: Works on desktop and mobile devices

## Getting Started

### Prerequisites

- Node.js 18.0 or higher
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/nakamura196/iiif-kasane.git

# Navigate to project directory
cd iiif-kasane

# Install dependencies
npm install
# or
yarn install
```

### Development

Run the development server:

```bash
npm run dev
# or
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Build

Build for production:

```bash
npm run build
# or
yarn build
```

### Static Export

This project is configured for static export. After building, the static files will be in the `out` directory:

```bash
npm run build
# Files will be generated in the 'out' directory
```

## Usage

1. Access the application homepage
2. Enter a IIIF Manifest URL containing 3D model information
3. Click "View 3D Model" to open the viewer
4. Use mouse/touch controls to navigate the 3D model
5. Click on the model to add annotations

## Project Structure

```
src/
├── app/
│   └── [locale]/          # Internationalized pages
│       ├── page.tsx       # Homepage
│       ├── viewer/        # 3D viewer page
│       ├── editor/        # Annotation editor
│       ├── help/          # Help page
│       ├── terms/         # Terms of service
│       └── privacy/       # Privacy policy
├── components/            # React components
├── i18n/                  # Internationalization config
├── messages/              # Translation files
│   ├── en.json           # English translations
│   └── ja.json           # Japanese translations
└── lib/                   # Utility functions
```

## Technologies Used

- **Next.js 15**: React framework with App Router
- **React Three Fiber**: React renderer for Three.js
- **next-intl**: Internationalization
- **Tailwind CSS**: Styling
- **TypeScript**: Type safety

## Deployment

This application can be deployed to any static hosting service.

### GitHub Pages (automated via Actions)

The `.github/workflows/deploy-pages.yml` workflow builds the static export
with `GITHUB_PAGES=true` and uploads it to GitHub Pages on every push to `main`.
Enable it once by going to **Settings → Pages → Source: "GitHub Actions"**.

### Netlify / Vercel

1. Connect your repository
2. Set build command: `npm run build`
3. Set publish directory: `out`

### Optional: Google Analytics

This project does **not** ship with a baked-in Measurement ID — forks will not
report analytics to anyone by default. To enable GA4 for your own deployment:

1. Create a GA4 property and copy the Measurement ID (`G-XXXXXXXXXX`).
2. **For GitHub Pages**: Repository → **Settings → Secrets and variables →
   Actions → Variables** tab → New repository variable
   `NEXT_PUBLIC_GA_ID` = your `G-XXXXXXXXXX`. The next push triggers a rebuild
   with GA enabled.
3. **For Vercel**: Project → **Settings → Environment Variables** →
   `NEXT_PUBLIC_GA_ID` = your `G-XXXXXXXXXX` (Production scope).

The app reads `process.env.NEXT_PUBLIC_GA_ID` at build time and only injects
`@next/third-parties/google` when it is set.

## Development Team

Developed by The University of Tokyo

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Bug reports, feature ideas and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for how to report issues, set up the development environment and submit pull requests. Security issues should be reported privately as described in [SECURITY.md](SECURITY.md).

This project is released with a [Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.
