# Ravonics LLC — Corporate Website

[![SBA HUBZone Certified](https://img.shields.io/badge/SBA-HUBZone%20Certified-green)]()
[![SAM.gov](https://img.shields.io/badge/SAM-Active-blue)]()

Ravonics is a West Virginia-based SBA HUBZone Certified defense technology company delivering AI/ML, autonomous systems, computer vision, zero-trust architecture, and quantum-ready solutions to federal and Department of War customers.

This repository contains the public-facing corporate website at [ravonics.com](https://ravonics.com).

## About

Ravonics partners with Droid Ops Inc, Dream Limited, Viper Dynamics, and the INSTAR Lab to bring production-deployed partner technology to federal missions — from secure DevSecOps and sovereign AI inference to zero-trust networking and validated edge computer vision.

## Tech Stack

- **Hosting:** GitHub Pages (behind Cloudflare for DDoS protection + CDN)
- **Stack:** Static HTML / CSS / Vanilla JS
- **Template:** Designesia (licensed)
- **Media:** AVIF images, self-hosted cinematic MP4 hero
- **Forms:** Azure Functions → Logic Apps → Dynamics 365
- **Security:** Content-Security-Policy, Cloudflare Turnstile CSP verification

## Quick Start

```bash
# Serve locally
python3 -m http.server 8000

# Run QA gate
node scripts/qa-screenshots.mjs
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
└── src/                    # PDF source HTML
```

## Publishing

The live site is published via the `gh-pages` branch. See `public-site-publish.md` for the process.

## License

Proprietary — Ravonics LLC. All rights reserved.
