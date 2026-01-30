# 🚌 İstanbul Otobüs Takip Uygulaması

Gerçek zamanlı İstanbul otobüs ve durak takip uygulaması. Konumunuza yakın durakları görün, yaklaşan otobüsleri takip edin ve hat güzergahlarını keşfedin.

![İstanbul Bus Tracker](https://img.shields.io/badge/React-18-blue) ![Express](https://img.shields.io/badge/Express-4-green) ![Leaflet](https://img.shields.io/badge/Leaflet-1.9-brightgreen)

## ✨ Özellikler

- 📍 **Konum Tabanlı Arama**: 500m yarıçapında yakın durakları otomatik bulma
- 🚌 **Gerçek Zamanlı Otobüs Takibi**: İBB FiloDurum API ile canlı otobüs konumları
- 🗺️ **Hat Güzergahları**: Durağa veya otobüse tıklayınca güzergah çizimi
- 🧭 **Yol Tarifi**: OSRM ile yaya ve araç yol tarifi
- 📱 **Mobil Uyumlu**: Touch-friendly glassmorphism UI tasarımı

## 🚀 Hızlı Başlangıç

### Gereksinimler
- Node.js 18+
- npm veya yarn

### Kurulum

```bash
# Repoyu klonla
git clone https://github.com/KULLANICI_ADI/istanbul-bus-tracker.git
cd istanbul-bus-tracker

# Bağımlılıkları yükle
npm install

# Development modunda çalıştır
npm run dev:all
```

Uygulama açılacak:
- Frontend: http://localhost:5173
- Backend: http://localhost:3001

## 🌐 Deploy (Railway)

### 1. Railway'e Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

1. [Railway](https://railway.app) hesabı oluştur
2. "New Project" → "Deploy from GitHub repo"
3. Bu repoyu seç
4. Environment variables ekle:
   ```
   NODE_ENV=production
   ```
5. Deploy!

### 2. Manuel Deploy

```bash
# Production build oluştur
npm run build

# Production'da çalıştır
NODE_ENV=production npm start
```

## 📁 Proje Yapısı

```
├── App.jsx           # Ana React komponenti
├── index.html        # HTML template
├── index.css         # Global stiller
├── main.jsx          # React entry point
├── server.js         # Express backend
├── vite.config.js    # Vite konfigürasyonu
├── tailwind.config.js
└── package.json
```

## 🔌 API Endpoints

| Endpoint | Açıklama |
|----------|----------|
| `GET /api/stops` | Yakın durakları getir |
| `GET /api/arrivals/:stopId` | Durağa yaklaşan otobüsler |
| `GET /api/directions` | Yol tarifi al |
| `GET /api/route-shape/:routeId` | Hat güzergahı |

## 🛠️ Kullanılan Teknolojiler

- **Frontend**: React 18, Vite, TailwindCSS 4, Leaflet.js
- **Backend**: Express.js, Node.js
- **API**: İBB Açık Veri, OSRM, GTFS
- **UI**: Glassmorphism, Lucide Icons

## 📱 Mobil Kullanım

Deploy edildikten sonra HTTPS üzerinden mobil cihazınızda açın. Konum izni verin ve yakın durakları görmeye başlayın!

## 📄 Lisans

MIT License

## 🙏 Teşekkürler

- [İBB Açık Veri Portalı](https://data.ibb.gov.tr)
- [OpenStreetMap](https://www.openstreetmap.org)
- [OSRM](http://project-osrm.org)
