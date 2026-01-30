import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import iconv from 'iconv-lite';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SSL sertifika doğrulamasını atla (İBB API için gerekli)
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  timeout: 60000 // 60 saniye timeout
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ charset: 'utf-8' }));

// Production'da static dosyaları serve et
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
}

// CSV Parser
const parseCSV = (csv) => {
  try {
    // BOM karakterini kaldır
    let cleaned = csv.replace(/^\uFEFF/, '');
    
    const lines = cleaned.trim().split('\n');
    if (lines.length < 2) {
      console.log('CSV boş veya sadece header var. Lines:', lines.length);
      return [];
    }
    
    const headerLine = lines[0];
    const headers = headerLine.split(',').map(h => h.trim().toLowerCase());
    
    console.log('Headers:', headers.slice(0, 10));
    
    const latIndex = headers.findIndex(h => h.includes('stop_lat') || h.includes('lat'));
    const lonIndex = headers.findIndex(h => h.includes('stop_lon') || h.includes('lon'));
    const nameIndex = headers.findIndex(h => h.includes('stop_name') || h.includes('name'));
    const idIndex = headers.findIndex(h => h.includes('stop_id') || h.includes('id'));
    const descIndex = headers.findIndex(h => h.includes('stop_desc') || h.includes('desc'));
    
    console.log('Indeksler - ID:', idIndex, 'Name:', nameIndex, 'Lat:', latIndex, 'Lon:', lonIndex, 'Desc:', descIndex);
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      const values = lines[i].split(',').map(v => v.trim());
      
      // Yön bilgisini desc'den çıkar (örn: "direction: TUZLA" -> "TUZLA")
      let stopName = values[nameIndex] || 'Bilinmiyor';
      const stopDesc = values[descIndex] || '';
      
      // Yön bilgisini parantez içinde ekle
      if (stopDesc) {
        const directionMatch = stopDesc.match(/direction:\s*(.+)/i);
        if (directionMatch) {
          const direction = directionMatch[1].trim();
          stopName = `${stopName} (${direction})`;
        }
      }
      
      const stop = {
        stop_id: values[idIndex] || `stop_${i}`,
        stop_name: stopName,
        stop_lat: values[latIndex],
        stop_lon: values[lonIndex]
      };
      
      if (stop.stop_lat && stop.stop_lon) {
        data.push(stop);
      }
    }
    
    return data;
  } catch (error) {
    console.error('CSV Parse Error:', error);
    return [];
  }
};

// Haversine formülü ile iki koordinat arası mesafe hesaplama (metre)
const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Dünya yarıçapı (metre)
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Mesafe metre cinsinden
};

// Durakları getir (mesafe veya bbox filtrelemesi)
app.get('/api/stops', async (req, res) => {
  try {
    console.log('Duraklar isteniyor...', req.query);
    const url = 'https://data.ibb.gov.tr/en/dataset/8540e256-6df5-4719-85bc-e64e91508ede/resource/2299bc82-983b-4bdf-8520-5cef8c555e29/download/stops.csv';
    
    const response = await fetch(url, { 
      agent: httpsAgent,
      headers: { 'Accept': 'text/csv' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    // Buffer olarak oku
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Encoding detection - farklı encoding'leri dene ve en iyisini seç
    const encodings = ['utf-8', 'utf16le', 'utf16be', 'iso88599', 'win1252', 'cp1254'];
    let csvText = '';
    let detectedEncoding = 'utf-8';
    
    for (const enc of encodings) {
      try {
        const candidate = iconv.decode(buffer, enc);
        
        // Türkçe karakterler içeren bir test string bul
        const turkishCharCount = (candidate.match(/[şçğıüöŞÇĞİÜÖ]/g) || []).length;
        const questionMarkCount = (candidate.match(/\?/g) || []).length;
        
        // Eğer Türkçe karakterler var ve question mark az ise, bu iyi bir encoding
        if (turkishCharCount > 50 && questionMarkCount < 10) {
          csvText = candidate;
          detectedEncoding = enc;
          console.log(`Encoding detected: ${enc} (Türkçe char: ${turkishCharCount}, ?: ${questionMarkCount})`);
          break;
        }
      } catch (e) {
        // Bu encoding çalışmadı, sonrakini dene
      }
    }
    
    // Hiç biri işe yaramadıysa UTF-8'i kullan
    if (!csvText) {
      csvText = iconv.decode(buffer, 'utf-8');
      console.log('Encoding: UTF-8 (default)');
    }
    
    console.log('CSV alındı, uzunluk:', csvText.length);
    
    let parsedData = parseCSV(csvText);
    console.log('Toplam parse edilen durak:', parsedData.length);
    
    // Mesafe bazlı filtreleme (lat, lng, radius - metre cinsinden)
    const { lat, lng, radius, minLat, minLng, maxLat, maxLng } = req.query;
    
    if (lat && lng && radius) {
      const centerLat = parseFloat(lat);
      const centerLng = parseFloat(lng);
      const maxDistance = parseFloat(radius);
      
      console.log(`Mesafe filtresi uygulanıyor: merkez (${centerLat}, ${centerLng}), yarıçap ${maxDistance}m`);
      
      const beforeFilter = parsedData.length;
      parsedData = parsedData.filter(stop => {
        const stopLat = parseFloat(stop.stop_lat);
        const stopLng = parseFloat(stop.stop_lon);
        const distance = haversineDistance(centerLat, centerLng, stopLat, stopLng);
        return distance <= maxDistance;
      }).map(stop => {
        const stopLat = parseFloat(stop.stop_lat);
        const stopLng = parseFloat(stop.stop_lon);
        const distance = haversineDistance(centerLat, centerLng, stopLat, stopLng);
        return { ...stop, distance: Math.round(distance) };
      }).sort((a, b) => a.distance - b.distance);
      
      console.log(`${beforeFilter} -> ${parsedData.length} (${maxDistance}m yarıçap filtresi sonrası)`);
    }
    // Bbox filtrelemesi (minLat, minLng, maxLat, maxLng)
    else if (minLat && minLng && maxLat && maxLng) {
      const min = { lat: parseFloat(minLat), lng: parseFloat(minLng) };
      const max = { lat: parseFloat(maxLat), lng: parseFloat(maxLng) };
      
      console.log('Bbox filtresi uygulanıyor:', { min, max });
      
      const beforeFilter = parsedData.length;
      parsedData = parsedData.filter(stop => {
        const lat = parseFloat(stop.stop_lat);
        const lng = parseFloat(stop.stop_lon);
        const inBounds = lat >= min.lat && lat <= max.lat && lng >= min.lng && lng <= max.lng;
        return inBounds;
      });
      
      console.log(`${beforeFilter} -> ${parsedData.length} (bbox filtresi sonrası)`);
    }
    
    const stops = parsedData.map((stop, idx) => ({
      id: stop.stop_id || idx,
      name: stop.stop_name || "Bilinmiyor",
      lat: parseFloat(stop.stop_lat),
      lng: parseFloat(stop.stop_lon),
      distance: stop.distance || null,
      rating: 4.5,
      image: "https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?q=80&w=600&auto=format&fit=crop"
    })).filter(s => !isNaN(s.lat) && !isNaN(s.lng));
    
    console.log(`${stops.length} durak gönderiliyor`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ success: true, data: stops, count: stops.length });
  } catch (error) {
    console.error('API Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yol tarifi endpoint'i (OSRM API kullanarak)
app.get('/api/directions', async (req, res) => {
  try {
    const { startLat, startLng, endLat, endLng, mode = 'foot' } = req.query;
    
    if (!startLat || !startLng || !endLat || !endLng) {
      return res.status(400).json({ 
        success: false, 
        error: 'Başlangıç ve bitiş koordinatları gerekli (startLat, startLng, endLat, endLng)' 
      });
    }

    console.log(`Yol tarifi isteniyor: (${startLat}, ${startLng}) -> (${endLat}, ${endLng}) [${mode}]`);
    
    // OSRM profilleri: driving, walking, cycling
    const osrmProfile = mode === 'driving' ? 'driving' : mode === 'cycling' ? 'cycling' : 'foot';
    
    // OSRM API URL (ücretsiz demo server)
    const osrmUrl = `https://router.project-osrm.org/route/v1/${osrmProfile}/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true`;
    
    console.log('OSRM URL:', osrmUrl);
    
    const response = await fetch(osrmUrl, { agent: httpsAgent });
    if (!response.ok) throw new Error(`OSRM API Hatası: HTTP ${response.status}`);
    
    const data = await response.json();
    
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('Rota bulunamadı');
    }
    
    const route = data.routes[0];
    
    // Adımları Türkçeleştir ve basitleştir
    const steps = route.legs[0].steps.map(step => ({
      instruction: translateInstruction(step.maneuver.type, step.maneuver.modifier, step.name),
      distance: step.distance,
      duration: step.duration,
      name: step.name || 'Yol',
      maneuver: {
        type: step.maneuver.type,
        modifier: step.maneuver.modifier,
        location: step.maneuver.location
      }
    }));
    
    const result = {
      success: true,
      route: {
        distance: Math.round(route.distance), // metre
        duration: Math.round(route.duration), // saniye
        durationText: formatDuration(route.duration),
        distanceText: formatDistance(route.distance),
        geometry: route.geometry, // GeoJSON LineString
        steps: steps
      }
    };
    
    console.log(`Rota bulundu: ${result.route.distanceText}, ${result.route.durationText}`);
    res.json(result);
    
  } catch (error) {
    console.error('Directions API Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yardımcı fonksiyonlar
function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} sn`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} dk`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return `${hours} sa ${mins} dk`;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function translateInstruction(type, modifier, streetName) {
  const street = streetName ? ` (${streetName})` : '';
  
  const translations = {
    'depart': 'Yola çık',
    'arrive': 'Hedefe vardın',
    'turn': {
      'left': 'Sola dön',
      'right': 'Sağa dön',
      'slight left': 'Hafif sola dön',
      'slight right': 'Hafif sağa dön',
      'sharp left': 'Keskin sola dön',
      'sharp right': 'Keskin sağa dön',
      'uturn': 'U dönüşü yap'
    },
    'continue': 'Düz devam et',
    'merge': 'Yola katıl',
    'roundabout': 'Dönel kavşaktan geç',
    'rotary': 'Dönel kavşaktan geç',
    'fork': {
      'left': 'Soldan devam et',
      'right': 'Sağdan devam et'
    },
    'end of road': {
      'left': 'Yol sonunda sola dön',
      'right': 'Yol sonunda sağa dön'
    },
    'new name': 'Devam et',
    'straight': 'Düz git'
  };
  
  if (type === 'turn' || type === 'fork' || type === 'end of road') {
    const subTranslation = translations[type];
    if (typeof subTranslation === 'object' && modifier) {
      return (subTranslation[modifier] || 'Devam et') + street;
    }
  }
  
  return (translations[type] || 'Devam et') + street;
}

// GTFS verileri için cache (her istek için API'ye gitmemek için)
let gtfsCache = {
  routes: null,
  trips: null,
  stopRoutes: {}, // stop_id -> route_id[] eşleşmesi
  stopsData: {}, // stop_id -> { stop_name, stop_lat, stop_lon, stop_desc }
  tripStops: {}, // trip_id -> [{stop_id, stop_sequence}, ...] sıralı
  routeTrips: {}, // route_id -> [trip_id, ...]
  lastUpdate: null
};

// Gerçek zamanlı filo verisi cache
let filoCache = {
  vehicles: [],
  lastUpdate: null
};
const FILO_CACHE_TTL = 30 * 1000; // 30 saniye

// Kapı numarası -> Hat kodu eşleştirme cache
let hatMappingCache = {
  mapping: {}, // kapıNo -> { hatKodu, hatAdi, yon }
  lastUpdate: null
};
const HAT_MAPPING_CACHE_TTL = 5 * 60 * 1000; // 5 dakika

// Popüler hatları sorgulayıp kapıNo -> hatKodu mapping'i oluştur
async function updateHatMapping() {
  const now = Date.now();
  if (Object.keys(hatMappingCache.mapping).length > 0 && 
      hatMappingCache.lastUpdate && 
      (now - hatMappingCache.lastUpdate < HAT_MAPPING_CACHE_TTL)) {
    return hatMappingCache.mapping;
  }
  
  console.log('Hat mapping güncelleniyor...');
  
  // En yoğun 30 hat (rate limit aşmamak için)
  const popularHatlar = [
    '500T', '34', '34A', '34G', '34Z', '133F', '122', '145T',
    '59C', '59T', '59Y', '29C', '29D', '29T',
    '25A', '25G', '26', '27A', '27E', '28T',
    '46', '46C', '46T', '47', '47E', '48T', '40T', '41E', '42T'
  ];
  
  const newMapping = {};
  
  // Delay fonksiyonu
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  // Her hat için API çağrısı yap (rate limit için yavaşça)
  for (const hatKodu of popularHatlar) {
    await delay(200); // Her istek arasında 200ms bekle
    try {
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:GetHatOtoKonum_json>
      <tem:HatKodu>${hatKodu}</tem:HatKodu>
    </tem:GetHatOtoKonum_json>
  </soap:Body>
</soap:Envelope>`;

      const response = await fetch('https://api.ibb.gov.tr/iett/FiloDurum/SeferGerceklesme.asmx', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://tempuri.org/GetHatOtoKonum_json'
        },
        body: soapBody,
        agent: httpsAgent,
        timeout: 5000
      });
      
      if (!response.ok) continue;
      
      const xmlText = await response.text();
      const jsonMatch = xmlText.match(/<GetHatOtoKonum_jsonResult>([\s\S]*?)<\/GetHatOtoKonum_jsonResult>/);
      if (!jsonMatch) continue;
      
      let jsonStr = jsonMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      
      const vehicles = JSON.parse(jsonStr);
      
      // Her aracı mapping'e ekle
      for (const v of vehicles) {
        if (v.kapino) {
          newMapping[v.kapino] = {
            hatKodu: v.hatkodu,
            hatAdi: v.hatad,
            yon: v.yon
          };
        }
      }
    } catch (error) {
      // Hata olursa devam et
    }
  }
  
  hatMappingCache.mapping = { ...hatMappingCache.mapping, ...newMapping };
  hatMappingCache.lastUpdate = now;
  console.log(`Hat mapping güncellendi: ${Object.keys(hatMappingCache.mapping).length} araç eşleştirildi`);
  
  return hatMappingCache.mapping;
}

// Tek bir kapı numarası için hat bilgisi al (cache'de yoksa API'ye sor)
async function getHatByKapiNo(kapiNo) {
  // Önce cache'e bak
  if (hatMappingCache.mapping[kapiNo]) {
    return hatMappingCache.mapping[kapiNo];
  }
  
  // Cache'de yoksa null döndür
  return null;
}

// İBB FiloDurum API'den gerçek zamanlı araç konumlarını al
async function getRealtimeBusLocations() {
  const now = Date.now();
  if (filoCache.vehicles.length > 0 && filoCache.lastUpdate && (now - filoCache.lastUpdate < FILO_CACHE_TTL)) {
    return filoCache.vehicles;
  }
  
  console.log('İBB FiloDurum API çağrılıyor...');
  
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:GetFiloAracKonum_json />
  </soap:Body>
</soap:Envelope>`;

  try {
    const response = await fetch('https://api.ibb.gov.tr/iett/FiloDurum/SeferGerceklesme.asmx', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://tempuri.org/GetFiloAracKonum_json'
      },
      body: soapBody,
      agent: httpsAgent
    });
    
    if (!response.ok) throw new Error(`İBB API HTTP ${response.status}`);
    
    const xmlText = await response.text();
    
    // JSON verisini XML'den çıkar
    const jsonMatch = xmlText.match(/<GetFiloAracKonum_jsonResult>([\s\S]*?)<\/GetFiloAracKonum_jsonResult>/);
    if (!jsonMatch) throw new Error('JSON verisi bulunamadı');
    
    // XML encoding'i düzelt
    let jsonStr = jsonMatch[1]
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    
    const vehicles = JSON.parse(jsonStr);
    
    // Verileri normalize et
    filoCache.vehicles = vehicles.map(v => ({
      kapiNo: v.KapiNo,
      operator: v.Operator,
      garaj: v.Garaj,
      plaka: v.Plaka,
      lat: parseFloat((v.Enlem || '').replace(' ', '')),
      lng: parseFloat((v.Boylam || '').replace(' ', '')),
      speed: parseFloat(v.Hiz || 0),
      lastUpdate: v.Saat
    })).filter(v => !isNaN(v.lat) && !isNaN(v.lng));
    
    filoCache.lastUpdate = now;
    console.log(`${filoCache.vehicles.length} araç konumu alındı`);
    
    return filoCache.vehicles;
  } catch (error) {
    console.error('Filo API Error:', error.message);
    return filoCache.vehicles; // Eski cache'i döndür
  }
}

// Cache'i güncelle (10 dakikada bir)
const CACHE_TTL = 10 * 60 * 1000; // 10 dakika

async function loadGTFSData() {
  const now = Date.now();
  if (gtfsCache.routes && gtfsCache.lastUpdate && (now - gtfsCache.lastUpdate < CACHE_TTL)) {
    return true;
  }
  
  console.log('GTFS verileri yükleniyor...');
  
  const stopsUrl = 'https://data.ibb.gov.tr/en/dataset/8540e256-6df5-4719-85bc-e64e91508ede/resource/2299bc82-983b-4bdf-8520-5cef8c555e29/download/stops.csv';
  const routesUrl = 'https://data.ibb.gov.tr/en/dataset/8540e256-6df5-4719-85bc-e64e91508ede/resource/46dbe388-c8c2-45c4-ac72-c06953de56a2/download/routes.csv';
  const tripsUrl = 'https://data.ibb.gov.tr/en/dataset/8540e256-6df5-4719-85bc-e64e91508ede/resource/7ff49bdd-b0d2-4a6e-9392-b598f77f5070/download/trips.csv';
  const stopTimesUrl = 'https://data.ibb.gov.tr/en/dataset/8540e256-6df5-4719-85bc-e64e91508ede/resource/23778613-16fe-4d30-b8b8-8ca934ed2978/download/stop_times.csv';
  
  try {
    const fetchOptions = { agent: httpsAgent, headers: { 'Accept': 'text/csv' } };
    
    // Stops yükle (stop_code -> stop_id mapping ve koordinatlar)
    const stopsResponse = await fetch(stopsUrl, fetchOptions);
    if (!stopsResponse.ok) throw new Error(`Stops HTTP ${stopsResponse.status}`);
    const stopsBuffer = Buffer.from(await stopsResponse.arrayBuffer());
    const stopsText = iconv.decode(stopsBuffer, 'utf-8');
    const stopsParseResult = parseStopsForMappingAndData(stopsText);
    gtfsCache.stopCodeToId = stopsParseResult.mapping;
    gtfsCache.stopsData = stopsParseResult.stopsData;
    console.log(`${Object.keys(gtfsCache.stopCodeToId).length} durak mapping'i, ${Object.keys(gtfsCache.stopsData).length} durak verisi yüklendi`);
    
    // Routes yükle
    const routesResponse = await fetch(routesUrl, fetchOptions);
    if (!routesResponse.ok) throw new Error(`Routes HTTP ${routesResponse.status}`);
    const routesBuffer = Buffer.from(await routesResponse.arrayBuffer());
    const routesText = iconv.decode(routesBuffer, 'utf-8');
    gtfsCache.routes = parseRoutesCSV(routesText);
    console.log(`${gtfsCache.routes.length} hat yüklendi`);
    
    // Trips yükle (route_id <-> trip_id eşleşmesi için)
    const tripsResponse = await fetch(tripsUrl, fetchOptions);
    if (!tripsResponse.ok) throw new Error(`Trips HTTP ${tripsResponse.status}`);
    const tripsBuffer = Buffer.from(await tripsResponse.arrayBuffer());
    const tripsText = iconv.decode(tripsBuffer, 'utf-8');
    const tripsResult = parseTripsCSVWithRoutes(tripsText);
    gtfsCache.trips = tripsResult.trips;
    gtfsCache.routeTrips = tripsResult.routeTrips;
    console.log(`${Object.keys(gtfsCache.trips).length} trip, ${Object.keys(gtfsCache.routeTrips).length} route-trip eşleşmesi yüklendi`);
    
    // Stop times yükle ve stop_id -> route_id eşleşmesi oluştur
    const stopTimesResponse = await fetch(stopTimesUrl, fetchOptions);
    if (!stopTimesResponse.ok) throw new Error(`StopTimes HTTP ${stopTimesResponse.status}`);
    const stopTimesBuffer = Buffer.from(await stopTimesResponse.arrayBuffer());
    const stopTimesText = iconv.decode(stopTimesBuffer, 'utf-8');
    const stopTimesResult = parseStopTimesForRoutesAndTrips(stopTimesText, gtfsCache.trips);
    gtfsCache.stopRoutes = stopTimesResult.stopRoutes;
    gtfsCache.tripStops = stopTimesResult.tripStops;
    console.log(`${Object.keys(gtfsCache.stopRoutes).length} durak için hat eşleşmesi, ${Object.keys(gtfsCache.tripStops).length} trip-durak listesi oluşturuldu`);
    
    gtfsCache.lastUpdate = now;
    return true;
  } catch (error) {
    console.error('GTFS veri yükleme hatası:', error.message);
    return false;
  }
}

// Stops CSV parser - stop_code -> stop_id mapping ve koordinatlar
function parseStopsForMappingAndData(csv) {
  const mapping = {};
  const stopsData = {};
  try {
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\n');
    if (lines.length < 2) return { mapping, stopsData };
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const stopIdIdx = headers.indexOf('stop_id');
    const stopCodeIdx = headers.indexOf('stop_code');
    const stopNameIdx = headers.indexOf('stop_name');
    const stopLatIdx = headers.indexOf('stop_lat');
    const stopLonIdx = headers.indexOf('stop_lon');
    const stopDescIdx = headers.indexOf('stop_desc');
    
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const stopId = values[stopIdIdx];
      const stopCode = values[stopCodeIdx];
      const stopLat = parseFloat(values[stopLatIdx]);
      const stopLon = parseFloat(values[stopLonIdx]);
      let stopName = values[stopNameIdx] || 'Bilinmiyor';
      const stopDesc = values[stopDescIdx] || '';
      
      // Yön bilgisini ekle
      if (stopDesc) {
        const directionMatch = stopDesc.match(/direction:\s*(.+)/i);
        if (directionMatch) {
          const direction = directionMatch[1].trim();
          stopName = `${stopName} (${direction})`;
        }
      }
      
      if (stopCode && stopId) {
        mapping[stopCode] = stopId;
      }
      if (stopId && !isNaN(stopLat) && !isNaN(stopLon)) {
        stopsData[stopId] = {
          stop_name: stopName,
          stop_lat: stopLat,
          stop_lon: stopLon,
          stop_desc: stopDesc
        };
      }
    }
  } catch (error) {
    console.error('Stops CSV Parse Error:', error);
  }
  return { mapping, stopsData };
}

// Trips CSV parser - trip_id -> route_id eşleşmesi ve route_id -> trip_id[] listesi
function parseTripsCSVWithRoutes(csv) {
  const trips = {};
  const routeTrips = {};
  try {
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\n');
    if (lines.length < 2) return { trips, routeTrips };
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const tripIdIdx = headers.indexOf('trip_id');
    const routeIdIdx = headers.indexOf('route_id');
    const headSignIdx = headers.indexOf('trip_headsign');
    const directionIdx = headers.indexOf('direction_id');
    
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const tripId = values[tripIdIdx];
      const routeId = values[routeIdIdx];
      const directionId = values[directionIdx] || '0';
      if (tripId && routeId) {
        trips[tripId] = {
          route_id: routeId,
          headsign: values[headSignIdx] || '',
          direction_id: directionId
        };
        // Route'a ait trip'leri sakla
        if (!routeTrips[routeId]) {
          routeTrips[routeId] = [];
        }
        routeTrips[routeId].push(tripId);
      }
    }
  } catch (error) {
    console.error('Trips CSV Parse Error:', error);
  }
  return { trips, routeTrips };
}

// Stop times parser - stop_id -> unique route_id listesi ve trip_id -> [{stop_id, stop_sequence}]
function parseStopTimesForRoutesAndTrips(csv, trips) {
  const stopRoutes = {};
  const tripStops = {};
  try {
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\n');
    if (lines.length < 2) return { stopRoutes, tripStops };
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const tripIdIdx = headers.indexOf('trip_id');
    const stopIdIdx = headers.indexOf('stop_id');
    const arrivalIdx = headers.indexOf('arrival_time');
    const sequenceIdx = headers.indexOf('stop_sequence');
    
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const tripId = values[tripIdIdx];
      const stopId = values[stopIdIdx];
      const arrivalTime = values[arrivalIdx];
      const stopSequence = parseInt(values[sequenceIdx]) || 0;
      
      if (stopId && tripId && trips[tripId]) {
        if (!stopRoutes[stopId]) {
          stopRoutes[stopId] = new Set();
        }
        stopRoutes[stopId].add(trips[tripId].route_id);
        
        // Trip'e ait durakları kaydet
        if (!tripStops[tripId]) {
          tripStops[tripId] = [];
        }
        tripStops[tripId].push({
          stop_id: stopId,
          stop_sequence: stopSequence,
          arrival_time: arrivalTime
        });
      }
    }
    
    // Set'leri Array'e çevir
    for (const stopId in stopRoutes) {
      stopRoutes[stopId] = Array.from(stopRoutes[stopId]);
    }
    
    // Trip durak listelerini sırala
    for (const tripId in tripStops) {
      tripStops[tripId].sort((a, b) => a.stop_sequence - b.stop_sequence);
    }
  } catch (error) {
    console.error('StopTimes CSV Parse Error:', error);
  }
  return { stopRoutes, tripStops };
}

// Durağa yaklaşan otobüsler endpoint'i (GERÇEK ZAMANLI KONUM + HAT KODU)
app.get('/api/arrivals/:stopId', async (req, res) => {
  try {
    const { stopId } = req.params;
    const { stopLat, stopLng } = req.query;
    console.log(`Durağa yaklaşan otobüsler isteniyor: ${stopId} (${stopLat}, ${stopLng})`);
    
    const targetLat = parseFloat(stopLat) || 41.0082;
    const targetLng = parseFloat(stopLng) || 28.9784;
    
    // GTFS verilerini yükle (güzergah çizimi için gerekli) - paralel yükle
    const [gtfsLoaded, realtimeVehicles] = await Promise.all([
      loadGTFSData().catch(err => {
        console.error('GTFS yükleme hatası:', err.message);
        return false;
      }),
      getRealtimeBusLocations()
    ]);
    
    // Hat mapping geçici olarak devre dışı (rate limit sorunu çözülünce aktif et)
    // updateHatMapping().catch(err => console.error('Hat mapping hatası:', err.message));
    
    if (realtimeVehicles.length === 0) {
      return res.status(503).json({ 
        success: false, 
        error: 'Canlı veriye ulaşılamadı. Lütfen daha sonra tekrar deneyin.',
        code: 'LIVE_DATA_UNAVAILABLE'
      });
    }
    
    // Durağa yakın araçları bul (2000 metre yarıçap)
    const searchRadius = 2000;
    const allNearbyVehicles = realtimeVehicles.filter(v => {
      const distance = haversineDistance(targetLat, targetLng, v.lat, v.lng);
      v.distance = distance;
      return distance <= searchRadius;
    });
    
    // Durağı geçen araçları filtrele - sadece YAKLAŞANLARI göster
    const nearbyVehicles = allNearbyVehicles.filter(v => {
      // Çok yakın araçlar (< 50m) - durakta, göster
      if (v.distance < 50) return true;
      
      // Durmuş araçlar (hız = 0) ve uzakta - muhtemelen park, gösterme
      if (v.speed === 0 && v.distance > 100) return false;
      
      // Hareket halindeki araçlar için yön kontrolü yap
      // Aracın durağa doğru mu yoksa uzaklaşıyor mu kontrol et
      const headingToStop = calculateHeading(v.lat, v.lng, targetLat, targetLng);
      
      // Eğer aracın önceki konumunu bilmiyorsak, mesafeye göre karar ver
      // Sadece 1km'den yakın ve hareket halindeki araçları göster
      if (v.distance <= 1000 && v.speed > 0) return true;
      
      // Uzaktaki araçları gösterme
      return false;
    }).sort((a, b) => a.distance - b.distance);
    
    console.log(`${allNearbyVehicles.length} araç ${searchRadius}m yarıçapta, ${nearbyVehicles.length} tanesi yaklaşıyor`);
    
    if (nearbyVehicles.length === 0) {
      return res.json({ 
        success: true, 
        stopId, 
        arrivals: [], 
        count: 0,
        message: 'Yaklaşan otobüs bulunamadı'
      });
    }
    
    const now = new Date();
    
    // Araçları arrivals olarak döndür - hat kodu eşleştirmesiyle
    const arrivals = nearbyVehicles.slice(0, 10).map((vehicle, idx) => {
      // Tahmini varış süresi: mesafe / ortalama hız (20 km/h şehir içi)
      const avgSpeed = 20;
      const distanceKm = vehicle.distance / 1000;
      const estimatedMinutes = Math.max(1, Math.round((distanceKm / avgSpeed) * 60));
      
      const arrivalTime = new Date(now.getTime() + estimatedMinutes * 60000);
      
      // Yön açısını hesapla (araçtan durağa)
      const heading = calculateHeading(vehicle.lat, vehicle.lng, targetLat, targetLng);
      
      // Hat bilgisini mapping'den al
      const hatInfo = hatMappingCache.mapping[vehicle.kapiNo];
      
      // Operatör ve garaj bilgisinden isim oluştur
      const operatorName = formatOperatorName(vehicle.operator);
      const garajName = formatGarajName(vehicle.garaj);
      
      // Hat kodu varsa kullan, yoksa kapı numarasını göster
      const hatKodu = hatInfo?.hatKodu || vehicle.kapiNo;
      const hatAdi = hatInfo?.hatAdi || `${operatorName} - ${garajName}`;
      const yon = hatInfo?.yon || garajName;
      
      return {
        routeId: hatKodu,
        routeShortName: hatKodu, // Hat kodu: 500T, 133F vs
        routeLongName: hatAdi,
        kapiNo: vehicle.kapiNo, // Kapı numarası küçük yazıyla
        operator: operatorName,
        garaj: garajName,
        routeColor: getRouteColor(hatKodu),
        minutesUntilArrival: estimatedMinutes,
        arrivalTime: arrivalTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        destination: yon,
        isLive: true,
        hasHatKodu: !!hatInfo, // Hat kodu bulundu mu?
        vehicleId: vehicle.plaka || vehicle.kapiNo,
        location: { lat: vehicle.lat, lng: vehicle.lng },
        heading: heading,
        speed: vehicle.speed,
        distance: Math.round(vehicle.distance),
        lastUpdate: vehicle.lastUpdate
      };
    }).sort((a, b) => a.minutesUntilArrival - b.minutesUntilArrival);
    
    const hatBulunan = arrivals.filter(a => a.hasHatKodu).length;
    console.log(`${arrivals.length} otobüs gönderiliyor (${hatBulunan} hat kodlu)`);
    
    // Durağa ait GTFS route'larını da gönder (güzergah çizimi için)
    let stopRoutes = [];
    if (gtfsCache.routes && gtfsCache.stopRoutes) {
      const stopRouteIds = gtfsCache.stopRoutes[stopId] || [];
      stopRoutes = gtfsCache.routes
        .filter(r => stopRouteIds.includes(r.route_id))
        .slice(0, 10)
        .map(r => ({
          route_id: r.route_id,
          route_short_name: r.route_short_name,
          route_long_name: r.route_long_name,
          route_color: r.route_color || '053e73'
        }));
    }
    
    res.json({ success: true, stopId, arrivals, stopRoutes, count: arrivals.length, isRealtime: true });
    
  } catch (error) {
    console.error('Arrivals API Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Operatör adını formatla
function formatOperatorName(operator) {
  if (!operator) return 'İETT Otobüsü';
  
  const operatorMap = {
    'İETT': 'İETT Otobüsü',
    'IETT': 'İETT Otobüsü',
    'İstanbul Halk Ulaşım Tic.A.Ş': 'Halk Otobüsü',
    'Yeni İstanbul Özel Halk Otobüsleri Tic.A.Ş': 'Özel Halk Otobüsü',
    'ELİT KARAYOLU YOLCU TAŞIMA': 'Elit Otobüs',
    'MAVİ MARMARA ULAŞIM A.Ş': 'Mavi Marmara',
    'ÖZEL HALK': 'Özel Halk Otobüsü'
  };
  
  // Tam eşleşme
  if (operatorMap[operator]) return operatorMap[operator];
  
  // Kısmi eşleşme
  for (const [key, value] of Object.entries(operatorMap)) {
    if (operator.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }
  
  // Bilinmeyen operatör
  return operator.length > 20 ? operator.substring(0, 20) + '...' : operator;
}

// Garaj adını formatla
function formatGarajName(garaj) {
  if (!garaj) return 'Merkez';
  
  // "GARAJI" kelimesini kaldır ve düzelt
  let name = garaj
    .replace(/GARAJI$/i, '')
    .replace(/GARAJ$/i, '')
    .replace(/_/g, ' ')
    .trim();
  
  // İlk harfleri büyük yap
  name = name.split(' ').map(word => {
    if (word.length === 0) return '';
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
  
  return name || 'Merkez';
}

// Hat rengi için basit hash fonksiyonu
function getRouteColor(routeId) {
  const colors = ['053e73', 'e74c3c', '27ae60', 'f39c12', '9b59b6', '1abc9c', 'e67e22', '3498db'];
  let hash = 0;
  const str = String(routeId);
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// İki nokta arasındaki yön açısını hesapla (derece)
function calculateHeading(fromLat, fromLng, toLat, toLng) {
  const dLng = (toLng - fromLng) * Math.PI / 180;
  const lat1 = fromLat * Math.PI / 180;
  const lat2 = toLat * Math.PI / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  
  let heading = Math.atan2(y, x) * 180 / Math.PI;
  return (heading + 360) % 360;
}

// GTFS tabanlı tahmin (gerçek zamanlı veri yoksa)
async function sendGTFSEstimates(res, stopId, targetLat, targetLng, gtfsCache) {
  if (!gtfsCache.routes) {
    return res.json({ 
      success: true, 
      stopId, 
      arrivals: [], 
      count: 0,
      message: 'Canlı veri bulunamadı'
    });
  }
  
  // Bu durağa gelen hatları bul
  const routeIds = gtfsCache.stopRoutes[stopId] || [];
  
  if (routeIds.length === 0) {
    return res.json({ 
      success: true, 
      stopId, 
      arrivals: [], 
      count: 0,
      message: 'Bu durak için hat bilgisi bulunamadı'
    });
  }
  
  // Route bilgilerini al
  const stopRoutes = gtfsCache.routes.filter(r => routeIds.includes(r.route_id));
  
  // Aynı hat adı olanları birleştir
  const uniqueRoutes = [];
  const seenNames = new Set();
  for (const route of stopRoutes) {
    if (!seenNames.has(route.route_short_name)) {
      seenNames.add(route.route_short_name);
      uniqueRoutes.push(route);
    }
  }
  
  const now = new Date();
  
  // Her hat için tahmini varış oluştur (max 6 hat göster)
  const arrivals = uniqueRoutes.slice(0, 6).map((route, idx) => {
    const minutesUntilArrival = Math.floor(Math.random() * 5) + 1 + (idx * 4);
    const arrivalTime = new Date(now.getTime() + minutesUntilArrival * 60000);
    
    // Tahminli konum
    const distanceMeters = minutesUntilArrival * 80;
    const angle = (idx * 60 + Math.random() * 20) * (Math.PI / 180);
    
    const latOffset = (distanceMeters / 111320) * Math.cos(angle);
    const lngOffset = (distanceMeters / (111320 * Math.cos(targetLat * Math.PI / 180))) * Math.sin(angle);
    
    return {
      routeId: route.route_id,
      routeShortName: route.route_short_name,
      routeLongName: route.route_long_name,
      routeColor: route.route_color || '053e73',
      minutesUntilArrival,
      arrivalTime: arrivalTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      destination: route.route_long_name?.split('-').pop()?.trim() || 'Merkez',
      isLive: false, // Tahminli veri
      vehicleId: `34 ${route.route_short_name} ${Math.floor(Math.random() * 900) + 100}`,
      location: { lat: targetLat + latOffset, lng: targetLng + lngOffset },
      heading: (angle * 180 / Math.PI + 180) % 360
    };
  }).sort((a, b) => a.minutesUntilArrival - b.minutesUntilArrival);
  
  console.log(`${arrivals.length} TAHMİNİ otobüs gönderiliyor`);
  res.json({ success: true, stopId, arrivals, count: arrivals.length, isRealtime: false });
}

// Routes CSV parser - TÜM HATLARI YÜKLE
function parseRoutesCSV(csv) {
  try {
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    
    const data = [];
    for (let i = 1; i < lines.length; i++) { // TÜM hatları yükle
      if (!lines[i].trim()) continue;
      
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const route = {};
      headers.forEach((h, idx) => {
        route[h] = values[idx] || '';
      });
      
      if (route.route_id && route.route_short_name) {
        data.push(route);
      }
    }
    
    console.log(`Toplam ${data.length} hat yüklendi`);
    return data;
  } catch (error) {
    console.error('Routes CSV Parse Error:', error);
    return [];
  }
}

// Hat güzergahı endpoint'i - bir hattın tüm duraklarını sıralı döndürür
app.get('/api/route-shape/:routeId', async (req, res) => {
  const { routeId } = req.params;
  
  console.log(`Hat güzergahı isteniyor: ${routeId}`);
  
  try {
    // GTFS verilerinin yüklü olduğundan emin ol
    const loaded = await loadGTFSData();
    if (!loaded) {
      return res.status(503).json({ success: false, error: 'GTFS verileri yüklenemedi' });
    }
    
    // Önce doğrudan route_id ile dene
    let tripIds = gtfsCache.routeTrips[routeId];
    let actualRouteId = routeId;
    
    // Bulunamazsa route_short_name ile eşleşen route'u bul
    if (!tripIds || tripIds.length === 0) {
      const matchingRoute = gtfsCache.routes.find(r => 
        r.route_short_name === routeId || 
        r.route_short_name?.toLowerCase() === routeId.toLowerCase() ||
        r.route_id === routeId
      );
      
      if (matchingRoute) {
        actualRouteId = matchingRoute.route_id;
        tripIds = gtfsCache.routeTrips[actualRouteId];
        console.log(`Route eşleşmesi bulundu: ${routeId} -> ${actualRouteId}`);
      }
    }
    
    if (!tripIds || tripIds.length === 0) {
      console.log(`Hat bulunamadı: ${routeId} - Mevcut route sayısı: ${gtfsCache.routes?.length || 0}`);
      return res.status(404).json({ success: false, error: 'Hat bulunamadı' });
    }
    
    // En uzun trip'i seç (en çok durağı olan)
    let bestTrip = null;
    let maxStops = 0;
    for (const tripId of tripIds) {
      const stops = gtfsCache.tripStops[tripId];
      if (stops && stops.length > maxStops) {
        maxStops = stops.length;
        bestTrip = tripId;
      }
    }
    
    if (!bestTrip || !gtfsCache.tripStops[bestTrip]) {
      return res.status(404).json({ success: false, error: 'Hat durakları bulunamadı' });
    }
    
    // Durakları koordinatlarıyla birlikte döndür
    const routeStops = gtfsCache.tripStops[bestTrip].map(stop => {
      const stopData = gtfsCache.stopsData[stop.stop_id];
      if (stopData) {
        return {
          stop_id: stop.stop_id,
          stop_name: stopData.stop_name,
          stop_lat: stopData.stop_lat,
          stop_lon: stopData.stop_lon,
          stop_sequence: stop.stop_sequence
        };
      }
      return null;
    }).filter(Boolean);
    
    // Hat bilgisini bul
    const routeInfo = gtfsCache.routes.find(r => r.route_id === actualRouteId);
    
    // GeoJSON formatında çizgi oluştur
    const coordinates = routeStops.map(s => [s.stop_lon, s.stop_lat]);
    const lineGeoJSON = {
      type: 'Feature',
      properties: {
        route_id: routeId,
        route_short_name: routeInfo?.route_short_name || routeId,
        route_long_name: routeInfo?.route_long_name || ''
      },
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      }
    };
    
    console.log(`Hat ${routeId} için ${routeStops.length} durak döndürülüyor`);
    
    res.json({
      success: true,
      route: {
        route_id: routeId,
        route_short_name: routeInfo?.route_short_name || routeId,
        route_long_name: routeInfo?.route_long_name || '',
        route_color: routeInfo?.route_color || '053e73'
      },
      stops: routeStops,
      lineGeoJSON: lineGeoJSON
    });
    
  } catch (error) {
    console.error('Route shape error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Production'da SPA fallback - tüm diğer route'ları index.html'e yönlendir
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend çalışıyor: http://localhost:${PORT}`);
  console.log(`📍 Duraklar: http://localhost:${PORT}/api/stops`);
  console.log(`🗺️  Yol Tarifi: http://localhost:${PORT}/api/directions`);
  console.log(`🚌 Otobüsler: http://localhost:${PORT}/api/arrivals/:stopId`);
});
