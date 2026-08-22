# Ravonics LLC — Corporate Website

[![SBA HUBZone Certified](https://img.shields.io/badge/SBA-HUBZone%20Certified-green)](<>)
[![SAM.gov](https://img.shields.io/badge/SAM-Active-blue)](<>)

Ravonics is a West Virginia-based SBA HUBZone Certified defense technology company delivering AI/ML, autonomous systems, computer vision, zero-trust architecture, and quantum-ready solutions to federal and Department of War customers.

This repository contains the public-facing corporate website at [ravonics.com](https://ravonics.com).

## About

Ravonics partners with Droid Ops Inc, Dream Limited, Viper Dynamics, and the INSTAR Lab to bring production-deployed partner technology to federal missions — from secure DevSecOps and sovereign AI inference to zero-trust networking and validated edge computer vision.

## Tech Stack

- **Hosting:** GitHub Pages (behind Cloudflare for DDoS protection + CDN)
- **Stack:** Astro 7 static build bridge, Tailwind CSS 4 foundation, legacy HTML/CSS/vanilla JS shell
- **Template:** Designesia (licensed)
- **Media:** AVIF images, self-hosted cinematic MP4 hero
- **Forms:** Azure Functions → Logic Apps → Dynamics 365
- **Security:** Content-Security-Policy, Cloudflare Turnstile CSP verification

## Quick Start

```bash
# Install dependencies (the proxy has its own lockfile)
npm ci
npm ci --prefix proxy

# Build and serve the tested static artifact
npm run build
python3 -m http.server 8000 --directory build/site

# Run the complete quality gate
npm run test:all

# Verify the deployed proxy without submitting a lead
npm run proxy:smoke
```

## Structure

```
├── booking.html            # RFP/RFI intake form
├── contact.html            # General contact form
├── company/                # About, team, certifications, doing business
├── capabilities/           # 10 capability pages
├── solutions/              # 7 solution pages
├── industries/             # 4 industry pages
├── insights/               # Blog/articles
├── images/                 # AVIF + PNG assets
├── css/                    # Styling
├── js/                     # JavaScript
├── proxy/                  # Azure Functions lead-capture proxy source
├── scripts/                # QA, build, deploy tooling
└── src/                    # Astro routes and migration foundation
```

## Publishing

The live site is published via the `gh-pages` branch. Build `build/site` first,
then follow [the scrubbed artifact publish guard](scripts/PUBLISH-GUARD.md).

The site build supports Node 24 and Node 26. Node 24 is the production baseline
because it is the current LTS and the Azure Functions target supports it. Node
26 is exercised by CI as a compatibility lane while it remains Current and
until Azure Functions adds it to the supported runtime list.

## License

Proprietary — Ravonics LLC. All rights reserved.
