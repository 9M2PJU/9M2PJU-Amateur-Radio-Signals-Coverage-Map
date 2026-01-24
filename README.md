# 9M2PJU Amateur Radio Signals Coverage Map

A professional web-based signal coverage analysis tool for amateur radio operators. Built with React, Leaflet, and the Okumura-Hata propagation model.

## 🚀 Features

- **Interactive Analysis**: Click anywhere on the map to instantly calculate signal coverage for that location.
- **Propagation Model**: Pure implementation of the Okumura-Hata model (Longley-Rice alternative for urban/suburban analysis).
- **Real-time Controls**: 
  - Adjust **Transmit Power** (1W - 100W)
  - Adjust **Frequency** (130MHz - 450MHz)
  - Adjust **Antenna Height** (2m - 100m)
- **Midnight Glass UI**: A sleek, modern interface with glassmorphism effects and dark mode as default.
- **Coverage Legend**: Distinguishes between Strong (S9+), Moderate (S5), and Marginal signals.

## 🛠️ Technology Stack

- **Frontend**: Vite + React
- **Mapping**: Leaflet.js / React-Leaflet
- **Icons**: Lucide-React
- **Propagation Logic**: JavaScript-based Hata Model

## 📦 Deployment

1. **Build Locally**: Run `npm run build` to generate the production site in the `/docs` folder.
2. **Push to GitHub**: Commit and push the `main` branch.
3. **GitHub Settings**: In your repository **Settings > Pages**, select **Deploy from a branch**, and choose the **main** branch with the **`/docs`** folder.
4. The app is available at `https://coverage.hamradio.my`.

## 📡 About 9M2PJU
This project is part of the amateur radio tools developed by **9M2PJU**. Visit my [GitHub Profile](https://github.com/9M2PJU) for more ham radio utilities.
