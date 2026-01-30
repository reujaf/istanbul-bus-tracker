import React, { useState, useEffect, useRef } from 'react';
import { Search, Mic, Home, Bell, Bookmark, Settings, MapPin, Bus, Navigation, Clock, X, Menu, Info, Sparkles, Activity } from 'lucide-react';

// --- Styles ---
const Styles = () => (
  <style>{`
    @import url('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    
    .leaflet-container {
      width: 100%;
      height: 100%;
      background: #f0f8ff; /* Light Blue Background */
      font-family: 'Inter', sans-serif;
      z-index: 1;
      touch-action: none; 
    }

    /* Custom Scrollbar */
    ::-webkit-scrollbar {
      width: 0px;
      background: transparent;
    }
    
    /* Remove Leaflet attribution */
    .leaflet-control-attribution {
      display: none;
    }

    /* Pulse Animation for User Location - Updated Color */
    .pulse-ring {
      display: block;
      border-radius: 50%;
      height: 20px;
      width: 20px;
      position: absolute;
      left: -2px;
      top: -2px;
      border: 3px solid #053e73;
      animation: pulsate 1.5s ease-out infinite;
      opacity: 0.0;
    }
    
    @keyframes pulsate {
      0% { transform: scale(0.5); opacity: 0.0; }
      50% { opacity: 0.8; }
      100% { transform: scale(1.5); opacity: 0.0; }
    }
    
    .custom-div-icon {
      background: transparent;
      border: none;
    }
    
    .bus-marker {
      z-index: 1000 !important;
    }
    
    .bus-marker:hover {
      z-index: 2000 !important;
    }
    
    .bus-marker .group:hover > div:first-child {
      transform: scale(1.15);
      box-shadow: 0 8px 25px rgba(0,0,0,0.3);
    }
    
    @keyframes bus-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }
  `}</style>
);

// --- CONFIGURATION ---
// Production'da relative URL kullan, development'ta localhost
const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';
const STOPS_API = `${API_BASE}/api/stops`;
const DIRECTIONS_API = `${API_BASE}/api/directions`;
const ARRIVALS_API = `${API_BASE}/api/arrivals`;
const ROUTE_SHAPE_API = `${API_BASE}/api/route-shape`;
const SEARCH_RADIUS = 500; // metre cinsinden arama yarıçapı

export default function App() {
  const [selectedStop, setSelectedStop] = useState(null);
  const [viewMode, setViewMode] = useState('map');
  const [activeTab, setActiveTab] = useState('home');
  const [buses, setBuses] = useState([]);
  const [stops, setStops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [transportMode, setTransportMode] = useState('foot'); // 'foot', 'driving', 'cycling'
  const [arrivals, setArrivals] = useState([]);
  const [arrivalsLoading, setArrivalsLoading] = useState(false);
  const [arrivalsError, setArrivalsError] = useState(null);
  const [stopRoutes, setStopRoutes] = useState([]); // Durağa ait GTFS route'ları
  
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const busMarkersRef = useRef({});
  const routeLayerRef = useRef(null);
  const routeShapeLayerRef = useRef(null); // Hat güzergah çizgisi
  const routeStopMarkersRef = useRef({}); // Hat durak noktaları

  // Kullanıcı konumunun belirli yarıçapındaki durakları getir
  const fetchNearbyStops = async (lat, lng, radius = SEARCH_RADIUS) => {
    try {
      setLoading(true);
      const url = `${STOPS_API}?lat=${lat}&lng=${lng}&radius=${radius}`;
      console.log(`${radius}m yarıçapında duraklar aranıyor:`, { lat, lng });
      
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const jsonData = await response.json();
      
      if (jsonData.success && Array.isArray(jsonData.data)) {
        console.log(`${jsonData.data.length} durak bulundu (${radius}m yarıçapında)`);
        setStops(jsonData.data);
        return jsonData.data;
      } else {
        throw new Error('Geçersiz veri formatı');
      }
    } catch (error) {
      console.error("Durak verileri yüklenemedi:", error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  // 1. Welcome Notification Logic
  useEffect(() => {
    setTimeout(() => setShowWelcome(true), 500);
    const hideTimer = setTimeout(() => {
      setShowWelcome(false);
    }, 4500);
    return () => clearTimeout(hideTimer);
  }, []);

  // 2. Initialize Map + Geolocation
  useEffect(() => {
    let script = document.querySelector('script[src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"]');
    
    if (!script) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.onload = initMapWithGeolocation;
      document.body.appendChild(script);
    } else {
      if (window.L) {
        initMapWithGeolocation();
      } else {
        script.onload = initMapWithGeolocation;
      }
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersRef.current = {};
        busMarkersRef.current = {};
      }
    };
  }, []);

  const initMapWithGeolocation = () => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;
    if (!window.L) return;

    // Varsayılan konumu İstanbul olarak ayarla
    const defaultLat = 41.0082;
    const defaultLng = 28.9784;
    const defaultZoom = 11;

    const createMap = (lat, lng, zoom) => {
      const map = window.L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
        zoomAnimation: true,
        fadeAnimation: true,
        markerZoomAnimation: true,
        tap: true 
      }).setView([lat, lng], zoom);

      window.L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        subdomains: 'abcd'
      }).addTo(map);

      mapInstanceRef.current = map;
      
      // invalidateSize'ı map render edildikten sonra çağır
      map.invalidateSize();
      
      // Kullanıcı konumuna yaklaşmak için moveend fonksiyonunu tetikle
      setTimeout(() => {
        refreshStopMarkers(map, stops);
      }, 50);
    };

    // Geolocation isteği
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const userLat = position.coords.latitude;
          const userLng = position.coords.longitude;
          
          console.log(`Kullanıcı konumu bulundu: ${userLat.toFixed(4)}, ${userLng.toFixed(4)}`);
          setUserLocation({ lat: userLat, lng: userLng });
          
          // Harita oluştur ve kullanıcı konumuna yaklaş (zoom 19 - çok yakın)
          createMap(userLat, userLng, 19);
          
          // Kullanıcı konumunu harita oluşturulduktan sonra göster
          setTimeout(() => {
            if (mapInstanceRef.current) {
              // 50 metrelik arama alanını gösteren daire
              window.L.circle([userLat, userLng], {
                radius: SEARCH_RADIUS,
                fillColor: '#053e73',
                fillOpacity: 0.1,
                color: '#053e73',
                weight: 2,
                dashArray: '5, 5'
              }).addTo(mapInstanceRef.current);
              
              // Kullanıcı konumu marker'ı
              const userMarker = window.L.circleMarker([userLat, userLng], {
                radius: 10,
                fillColor: '#4CAF50',
                color: '#fff',
                weight: 3,
                opacity: 1,
                fillOpacity: 0.9
              }).addTo(mapInstanceRef.current);
              
              userMarker.bindPopup(`<b>Buradasınız</b><br/>${SEARCH_RADIUS}m yarıçapında arama yapılıyor`);
            }
          }, 300);
          
          // 50 metre yakınındaki durakları getir
          setTimeout(() => {
            fetchNearbyStops(userLat, userLng, SEARCH_RADIUS);
          }, 500);
        },
        (error) => {
          console.warn('Geolocation hatası, varsayılan konumu kullanılıyor:', error);
          // Hata durumunda varsayılan İstanbul konumunu kullan
          createMap(defaultLat, defaultLng, defaultZoom);
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    } else {
      console.warn('Geolocation desteklenmiyor, varsayılan konumu kullanılıyor');
      createMap(defaultLat, defaultLng, defaultZoom);
    }
  };

  const refreshStopMarkers = (map, stopsData) => {
    stopsData.forEach(stop => {
      if (markersRef.current[stop.id]) return; 

      // Mesafe badge'li marker
      const distanceBadge = stop.distance ? `<div class="absolute -top-2 -right-2 bg-white text-[#053e73] text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-md border border-[#053e73]/20">${stop.distance}m</div>` : '';
      
      const iconHtml = `
        <div class="relative flex items-center justify-center">
           ${distanceBadge}
           <div class="w-10 h-10 bg-[#053e73] rounded-full shadow-lg border-[3px] border-white flex items-center justify-center transform transition-transform hover:scale-110">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
           </div>
           <div class="absolute -bottom-1 w-2 h-2 bg-[#053e73] rounded-full opacity-20 filter blur-[2px]"></div>
        </div>
      `;
      
      const customIcon = window.L.divIcon({
        className: 'custom-div-icon',
        html: iconHtml,
        iconSize: [40, 40],
        iconAnchor: [20, 40]
      });

      const marker = window.L.marker([stop.lat, stop.lng], { icon: customIcon })
        .addTo(map)
        .on('click', () => handleStopClick(stop));
      
      markersRef.current[stop.id] = marker;
    });
  };

  // 3. Update stops markers when data changes (optimize - sadece yeni marker'lar ekle)
  useEffect(() => {
    if (mapInstanceRef.current && window.L && stops.length > 0) {
      // Sadece yeni marker'ları ekle, var olanları silme
      refreshStopMarkers(mapInstanceRef.current, stops);
    }
  }, [stops]);

  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;

    buses.forEach(bus => {
      if (busMarkersRef.current[bus.id]) {
        const marker = busMarkersRef.current[bus.id];
        const newLatLng = new window.L.LatLng(bus.lat, bus.lng);
        marker.setLatLng(newLatLng);
      } else {
        // UPDATED COLOR: Blue Bus Icon
        const busHtml = `
          <div class="relative group">
             <div class="w-8 h-8 bg-white rounded-lg shadow-md border-2 border-[#053e73] flex items-center justify-center transform rotate-45">
               <div class="transform -rotate-45">
                 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#053e73" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>
               </div>
             </div>
             <div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-[#053e73] text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
               ${bus.route} - ${bus.eta}
             </div>
          </div>
        `;

        const busIcon = window.L.divIcon({
          className: 'custom-div-icon',
          html: busHtml,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });

        const marker = window.L.marker([bus.lat, bus.lng], { icon: busIcon })
          .addTo(mapInstanceRef.current);
        
        busMarkersRef.current[bus.id] = marker;
      }
    });

  }, [buses]);


  const handleStopClick = async (stop) => {
    setSelectedStop(stop);
    setViewMode('map');
    setArrivals([]);
    
    if (mapInstanceRef.current) {
      // Panel arkasında kalmaması için haritayı biraz yukarı kaydır (lat offset)
      const latOffset = 0.002; // ~200m yukarı kaydır
      mapInstanceRef.current.flyTo([stop.lat - latOffset, stop.lng], 16, { duration: 1.5 });
    }
    
    // Yaklaşan otobüsleri çek (koordinatlarla birlikte)
    fetchArrivals(stop.id, stop.lat, stop.lng);
  };
  
  const fetchArrivals = async (stopId, stopLat, stopLng) => {
    try {
      setArrivalsLoading(true);
      setArrivalsError(null);
      
      const response = await fetch(`${ARRIVALS_API}/${stopId}?stopLat=${stopLat}&stopLng=${stopLng}`);
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Veri alınamadı');
      }
      
      if (Array.isArray(data.arrivals)) {
        setArrivals(data.arrivals);
        console.log(`${data.arrivals.length} otobüs tahmini alındı`);
      }
      
      // Durağa ait GTFS route'larını sakla (güzergah çizimi için)
      if (Array.isArray(data.stopRoutes) && data.stopRoutes.length > 0) {
        setStopRoutes(data.stopRoutes);
        console.log(`${data.stopRoutes.length} GTFS route bulundu`);
        
        // İlk route'un güzergahını otomatik çiz
        const firstRoute = data.stopRoutes[0];
        const routeId = firstRoute.route_short_name || firstRoute.route_id;
        showRouteShape(routeId, firstRoute.route_color);
      }
    } catch (error) {
      console.error('Otobüs verileri alınamadı:', error);
      setArrivals([]);
      setArrivalsError(error.message || 'Canlı veriye ulaşılamadı');
    } finally {
      setArrivalsLoading(false);
    }
  };
  
  // Otobüs hatları için canlı ve ayırt edilebilir renkler
  const BUS_COLORS = [
    { bg: '#E53935', name: 'Kırmızı' },      // Red
    { bg: '#1E88E5', name: 'Mavi' },          // Blue
    { bg: '#43A047', name: 'Yeşil' },         // Green
    { bg: '#FB8C00', name: 'Turuncu' },       // Orange
    { bg: '#8E24AA', name: 'Mor' },           // Purple
    { bg: '#00ACC1', name: 'Turkuaz' },       // Cyan
    { bg: '#F4511E', name: 'Mercan' },        // Deep Orange
    { bg: '#3949AB', name: 'İndigo' },        // Indigo
    { bg: '#D81B60', name: 'Pembe' },         // Pink
    { bg: '#00897B', name: 'Deniz Yeşili' },  // Teal
    { bg: '#7CB342', name: 'Açık Yeşil' },    // Light Green
    { bg: '#5E35B1', name: 'Koyu Mor' },      // Deep Purple
  ];
  
  // Hat adına göre tutarlı renk seç
  const getBusColor = (routeName) => {
    let hash = 0;
    for (let i = 0; i < routeName.length; i++) {
      hash = routeName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return BUS_COLORS[Math.abs(hash) % BUS_COLORS.length].bg;
  };

  // Hat güzergahını haritada göster
  const showRouteShape = async (routeId, routeColor) => {
    if (!mapInstanceRef.current || !window.L) return;
    
    // Önceki güzergahı temizle
    clearRouteShape();
    
    try {
      const response = await fetch(`${ROUTE_SHAPE_API}/${routeId}`);
      const data = await response.json();
      
      if (!data.success || !data.stops) {
        console.log('Hat güzergahı alınamadı');
        return;
      }
      
      const color = `#${routeColor || '053e73'}`;
      
      // Güzergah çizgisini çiz
      if (data.lineGeoJSON) {
        const routeLine = window.L.geoJSON(data.lineGeoJSON, {
          style: {
            color: color,
            weight: 4,
            opacity: 0.7,
            lineCap: 'round',
            lineJoin: 'round',
            dashArray: '10, 10'
          }
        }).addTo(mapInstanceRef.current);
        routeShapeLayerRef.current = routeLine;
      }
      
      // Durak noktalarını ekle
      data.stops.forEach((stop, idx) => {
        const isFirstOrLast = idx === 0 || idx === data.stops.length - 1;
        const dotSize = isFirstOrLast ? 12 : 8;
        
        const dotHtml = `
          <div class="relative group cursor-pointer">
            <div class="rounded-full border-2 border-white shadow-md" style="width: ${dotSize}px; height: ${dotSize}px; background: ${isFirstOrLast ? color : '#ffffff'}; ${!isFirstOrLast ? `border-color: ${color}` : ''}"></div>
            <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
              <div class="bg-slate-900/95 text-white text-xs py-2 px-3 rounded-xl shadow-xl backdrop-blur-sm border border-white/10 whitespace-nowrap">
                <div class="font-semibold">${stop.stop_name}</div>
                <div class="text-slate-400 text-[10px] mt-0.5">${idx + 1}. durak</div>
              </div>
            </div>
          </div>
        `;
        
        const dotIcon = window.L.divIcon({
          className: 'custom-div-icon route-stop-dot',
          html: dotHtml,
          iconSize: [dotSize, dotSize],
          iconAnchor: [dotSize/2, dotSize/2]
        });
        
        const marker = window.L.marker([stop.stop_lat, stop.stop_lon], { icon: dotIcon })
          .addTo(mapInstanceRef.current)
          .bindPopup(`
            <div class="p-2">
              <div class="font-bold text-slate-800">${stop.stop_name}</div>
              <div class="text-xs text-slate-500 mt-1">${idx + 1}. durak</div>
            </div>
          `, { className: 'custom-popup' });
        
        routeStopMarkersRef.current[`stop_${idx}`] = marker;
      });
      
      console.log(`Hat ${routeId} güzergahı ${data.stops.length} durakla çizildi`);
      
    } catch (error) {
      console.error('Hat güzergahı hatası:', error);
    }
  };
  
  // Güzergah çizgisini ve durak noktalarını temizle
  const clearRouteShape = () => {
    if (routeShapeLayerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(routeShapeLayerRef.current);
      routeShapeLayerRef.current = null;
    }
    
    Object.values(routeStopMarkersRef.current).forEach(marker => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.removeLayer(marker);
      }
    });
    routeStopMarkersRef.current = {};
  };

  // Tek bir otobüsü haritada göster (otobüs kartına tıklandığında)
  const showSingleBusOnMap = async (bus) => {
    if (!mapInstanceRef.current || !window.L || !bus.location) return;
    
    // Önceki otobüs marker'larını temizle
    Object.values(busMarkersRef.current).forEach(marker => {
      mapInstanceRef.current.removeLayer(marker);
    });
    busMarkersRef.current = {};
    
    const busColor = getBusColor(bus.kapiNo || bus.routeShortName);
    
    const busHtml = `
      <div class="relative group">
        <div class="w-14 h-14 rounded-xl flex flex-col items-center justify-center transform transition-transform border-2 border-white/90 shadow-xl" style="background: linear-gradient(135deg, ${busColor} 0%, ${busColor}dd 100%)">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>
        </div>
        <div class="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white text-xs font-bold py-1 px-2 rounded-lg whitespace-nowrap shadow-lg">
          ${bus.routeShortName}
        </div>
        ${bus.isLive ? '<div class="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white shadow-lg"><div class="w-full h-full bg-emerald-400 rounded-full animate-ping"></div></div>' : ''}
      </div>
    `;
    
    const busIcon = window.L.divIcon({
      className: 'custom-div-icon bus-marker',
      html: busHtml,
      iconSize: [56, 70],
      iconAnchor: [28, 35]
    });
    
    const marker = window.L.marker([bus.location.lat, bus.location.lng], { icon: busIcon })
      .addTo(mapInstanceRef.current);
    
    busMarkersRef.current['selected_bus'] = marker;
    
    // Hat güzergahını göster
    // Hat kodu varsa onu kullan, yoksa GTFS route'larından ilkini kullan
    let routeIdToFetch = null;
    let routeColor = bus.routeColor;
    
    if (bus.hasHatKodu && bus.routeShortName) {
      // Gerçek hat kodu var (133F, 500T gibi)
      routeIdToFetch = bus.routeShortName;
    } else if (stopRoutes.length > 0) {
      // Hat kodu yok, GTFS route'larından ilkini kullan
      const firstRoute = stopRoutes[0];
      routeIdToFetch = firstRoute.route_short_name || firstRoute.route_id;
      routeColor = firstRoute.route_color;
      console.log(`Hat kodu bulunamadı, GTFS route kullanılıyor: ${routeIdToFetch}`);
    }
    
    if (routeIdToFetch) {
      await showRouteShape(routeIdToFetch, routeColor);
    }
    
    // Haritayı otobüse zoom yap - panel arkasında kalmaması için offset ekle
    const latOffset = 0.003; // ~300m yukarı kaydır (zoom 15 için biraz daha fazla)
    mapInstanceRef.current.flyTo([bus.location.lat - latOffset, bus.location.lng], 15, { duration: 1.2 });
    
    console.log(`Otobüs haritada gösteriliyor: ${bus.routeShortName}`);
  };

  const handleGetDirections = async (mode = transportMode) => {
    if (!userLocation || !selectedStop) return;
    
    setRouteLoading(true);
    setViewMode('directions');
    setTransportMode(mode);
    
    try {
      const url = `${DIRECTIONS_API}?startLat=${userLocation.lat}&startLng=${userLocation.lng}&endLat=${selectedStop.lat}&endLng=${selectedStop.lng}&mode=${mode}`;
      console.log('Yol tarifi isteniyor:', url);
      
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      
      if (data.success && data.route) {
        setRouteInfo(data.route);
        
        // Haritada rotayı çiz
        if (mapInstanceRef.current && window.L && data.route.geometry) {
          // Önceki rotayı temizle
          if (routeLayerRef.current) {
            mapInstanceRef.current.removeLayer(routeLayerRef.current);
          }
          
          // Yeni rotayı çiz
          const routeLine = window.L.geoJSON(data.route.geometry, {
            style: {
              color: '#053e73',
              weight: 5,
              opacity: 0.8,
              lineCap: 'round',
              lineJoin: 'round'
            }
          }).addTo(mapInstanceRef.current);
          
          routeLayerRef.current = routeLine;
          
          // Haritayı rotaya sığdır
          mapInstanceRef.current.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
        }
        
        console.log('Rota bulundu:', data.route.distanceText, data.route.durationText);
      } else {
        throw new Error('Rota bulunamadı');
      }
    } catch (error) {
      console.error('Yol tarifi hatası:', error);
      setRouteInfo(null);
    } finally {
      setRouteLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedStop(null);
    setViewMode('map');
    setRouteInfo(null);
    setArrivals([]);
    setArrivalsError(null);
    setStopRoutes([]);
    
    // Haritadaki rotayı temizle
    if (routeLayerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }
    
    // Haritadaki hat güzergahını temizle
    clearRouteShape();
    
    // Haritadaki otobüs marker'larını temizle
    if (mapInstanceRef.current) {
      Object.values(busMarkersRef.current).forEach(marker => {
        mapInstanceRef.current.removeLayer(marker);
      });
      busMarkersRef.current = {};
    }
  };

  return (
    <div className="w-screen h-screen bg-gray-100 font-sans overflow-hidden flex justify-center items-center">
      <Styles />
      
      {/* Mobile Frame Container */}
      <div className="relative w-full h-full 2xl:w-[390px] 2xl:h-[844px] 2xl:rounded-[40px] 2xl:shadow-2xl 2xl:border-[8px] 2xl:border-slate-900 bg-slate-50 overflow-hidden flex flex-col">
        
        {/* --- Header / Search Bar --- */}
        <div className="absolute top-0 left-0 right-0 z-[500] p-4 sm:p-6 pt-8 sm:pt-12 bg-gradient-to-b from-white/90 to-transparent pointer-events-none">
          <div className="flex items-center gap-3 pointer-events-auto">
            <div className="flex-1 h-10 sm:h-12 bg-white rounded-2xl shadow-lg flex items-center px-4 border border-gray-100">
              <Search className="w-5 h-5 text-gray-400" />
              <input 
                type="text" 
                placeholder="Durağı veya hattı ara..." 
                className="flex-1 bg-transparent border-none outline-none text-slate-700 ml-3 placeholder-gray-400 text-sm"
              />
              <Mic className="w-5 h-5 text-[#053e73]" />
            </div>
          </div>
        </div>

        {/* --- TRAFFIC DENSITY PANEL (New Feature) --- */}
        <div className="hidden 2xl:block absolute top-24 sm:top-28 right-4 z-[500] pointer-events-auto">
          <div className="bg-white/80 backdrop-blur-md rounded-xl p-3 shadow-lg border border-white/50 w-36">
            <div className="flex items-center gap-2 mb-2 border-b border-gray-100 pb-1">
              <Activity className="w-4 h-4 text-[#053e73]" />
              <span className="text-[10px] font-bold text-[#053e73] uppercase tracking-wide">Trafik Durumu</span>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">Avrupa</span>
                <div className="flex items-center gap-1">
                   <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></div>
                   <span className="text-xs font-bold text-slate-800">%68</span>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1">
                 <div className="bg-orange-500 h-1 rounded-full" style={{width: '68%'}}></div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-medium text-slate-600">Anadolu</span>
                <div className="flex items-center gap-1">
                   <div className="w-2 h-2 rounded-full bg-green-500"></div>
                   <span className="text-xs font-bold text-slate-800">%45</span>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1">
                 <div className="bg-green-500 h-1 rounded-full" style={{width: '45%'}}></div>
              </div>
            </div>
          </div>
        </div>

        {/* --- WELCOME NOTIFICATION PANEL --- */}
        <div className={`hidden 2xl:block absolute top-24 sm:top-28 left-4 w-40 z-[2000] transition-all duration-700 cubic-bezier(0.34, 1.56, 0.64, 1) ${showWelcome ? 'translate-x-0 opacity-100' : '-translate-x-40 opacity-0 pointer-events-none'}`}>
           <div className="bg-white/60 backdrop-blur-xl p-3 rounded-2xl shadow-2xl border border-white/50 flex flex-col items-start gap-2">
              <div className="w-8 h-8 bg-blue-50/80 rounded-full flex items-center justify-center flex-shrink-0">
                 <Sparkles className="w-4 h-4 text-[#053e73]" />
              </div>
              <div>
                 <h4 className="font-bold text-slate-800 text-xs">Hoş Geldiniz! 👋</h4>
                 <p className="text-[10px] text-slate-600 mt-1 font-medium leading-tight">İyi yolculuklar!</p>
              </div>
           </div>
        </div>

        {/* --- MAP CONTAINER --- */}
        <div className="flex-1 relative z-0 bg-blue-50/30">
          <div ref={mapContainerRef} className="w-full h-full" />
          
          {loading && (
             <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[1000] bg-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-[#053e73] border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs font-bold text-[#053e73]">Veriler Çekiliyor...</span>
             </div>
          )}

          {/* Durak sayısı bilgisi - Glassmorphism */}
          {!loading && userLocation && (
            <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-[1000]">
              <div className="rounded-2xl px-6 py-3 shadow-2xl flex items-center gap-4 min-w-[280px]" style={{ background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.55) 100%)', backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', border: '1.5px solid rgba(255, 255, 255, 0.7)', boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.8)' }}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${stops.length > 0 ? 'bg-green-500/20' : 'bg-orange-500/20'}`}>
                  <MapPin className={`w-5 h-5 ${stops.length > 0 ? 'text-green-600' : 'text-orange-600'}`} />
                </div>
                <div className="flex flex-col flex-1">
                  <span className="text-sm font-bold text-slate-800">
                    {stops.length > 0 
                      ? `${stops.length} Durak Bulundu`
                      : `Durak Bulunamadı`
                    }
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    {SEARCH_RADIUS}m yarıçapında arama
                  </span>
                </div>
                {stops.length > 0 && (
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div>
                )}
              </div>
            </div>
          )}

          {/* Map Overlay Controls */}
          <div className="absolute right-4 bottom-32 z-[400]">
             <button 
                onClick={() => {
                  if(mapInstanceRef.current && userLocation) {
                    mapInstanceRef.current.flyTo([userLocation.lat, userLocation.lng], 19, { duration: 1.5 });
                  }
                }}
                className="w-12 h-12 bg-white/80 backdrop-blur-xl rounded-full shadow-xl border border-white/60 flex items-center justify-center active:scale-95 transition-all hover:bg-white text-[#053e73]">
               <Navigation className="w-5 h-5" />
             </button>
          </div>
        </div>

        {/* --- INTERACTIVE BOTTOM SHEETS --- */}

        {/* 1. Stop Detail View */}
        {selectedStop && viewMode === 'map' && (
          <div className="absolute bottom-6 left-4 right-4 rounded-[32px] p-5 shadow-2xl z-[600] animate-in slide-in-from-bottom duration-300" style={{ background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.55) 100%)', backdropFilter: 'blur(50px) saturate(200%)', WebkitBackdropFilter: 'blur(50px) saturate(200%)', border: '1.5px solid rgba(255, 255, 255, 0.7)', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.8)' }}>
            {/* Handle */}
            <div className="w-full flex justify-center mb-3">
              <div className="w-12 h-1.5 bg-gray-200 rounded-full"></div>
            </div>

            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-[#053e73]/10 rounded-2xl flex items-center justify-center">
                  <MapPin className="w-6 h-6 text-[#053e73]" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">{selectedStop.name}</h2>
                  <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500">
                    <span className="text-[#053e73] font-medium">{selectedStop.distance ? `${selectedStop.distance}m` : 'Mesafe bilinmiyor'}</span>
                    <span>•</span>
                    <span>İstanbul</span>
                  </div>
                </div>
              </div>
              <button 
                onClick={closeDetail}
                className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center text-gray-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Yaklaşan Otobüsler */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Bus className="w-4 h-4 text-[#053e73]" />
                  Yaklaşan Otobüsler
                </h3>
                {arrivalsLoading && (
                  <div className="w-4 h-4 border-2 border-[#053e73] border-t-transparent rounded-full animate-spin"></div>
                )}
              </div>
              
              {!arrivalsLoading && arrivalsError && (
                <div className="text-center py-4 bg-red-500/10 backdrop-blur-lg rounded-2xl border border-red-200/50">
                  <p className="text-xs text-red-600 font-medium">⚠️ {arrivalsError}</p>
                </div>
              )}
              
              {!arrivalsLoading && !arrivalsError && arrivals.length === 0 && (
                <div className="text-center py-4 bg-white/50 backdrop-blur-lg rounded-2xl border border-white/40">
                  <p className="text-xs text-slate-400">Şu an yaklaşan otobüs yok</p>
                </div>
              )}
              
              {arrivals.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {arrivals.slice(0, 4).map((bus, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-center gap-3 p-3 rounded-2xl transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]" 
                      style={{ background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0.5) 100%)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', border: '1px solid rgba(255, 255, 255, 0.6)', boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.7)' }}
                      onClick={() => showSingleBusOnMap(bus)}
                    >
                      <div 
                        className="w-12 h-12 rounded-xl flex flex-col items-center justify-center text-white"
                        style={{ background: `linear-gradient(135deg, #${bus.routeColor || '053e73'} 0%, #${bus.routeColor || '053e73'}cc 100%)` }}
                      >
                        <Bus className="w-5 h-5" />
                        {bus.kapiNo && <span className="text-[8px] opacity-80 mt-0.5">{bus.kapiNo}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-700 truncate">{bus.routeShortName}</p>
                        <p className="text-xs text-slate-400 truncate">{bus.routeLongName || bus.destination}</p>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${bus.minutesUntilArrival <= 3 ? 'text-green-600' : bus.minutesUntilArrival <= 7 ? 'text-orange-500' : 'text-slate-700'}`}>
                          {bus.minutesUntilArrival} dk
                        </div>
                        <div className="flex items-center gap-1 justify-end">
                          {bus.isLive && <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>}
                          <span className="text-[10px] text-slate-400">{bus.arrivalTime}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button 
              onClick={handleGetDirections}
              className="w-full py-4 bg-[#053e73] hover:bg-blue-900 text-white font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <Navigation className="w-5 h-5 fill-current" />
              Yol Tarifi Al
            </button>
          </div>
        )}

        {/* 2. Route View */}
        {selectedStop && viewMode === 'directions' && (
           <div className="absolute bottom-6 left-4 right-4 rounded-[32px] p-5 shadow-2xl z-[600] animate-in slide-in-from-bottom duration-300 max-h-[70vh] overflow-y-auto" style={{ background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.55) 100%)', backdropFilter: 'blur(50px) saturate(200%)', WebkitBackdropFilter: 'blur(50px) saturate(200%)', border: '1.5px solid rgba(255, 255, 255, 0.7)', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.8)' }}>
             <div className="w-full flex justify-center mb-2">
                <div className="w-12 h-1.5 bg-gray-200 rounded-full"></div>
             </div>
             
             <div className="flex justify-between items-center mb-4">
               <h3 className="font-bold text-slate-800 text-lg">Yol Tarifi</h3>
               <button onClick={closeDetail} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"><X className="w-4 h-4 text-gray-500"/></button>
             </div>

             {/* Transport Mode Selection */}
             <div className="flex gap-2 mb-4">
               <button 
                 onClick={() => handleGetDirections('foot')}
                 className={`flex-1 py-3 px-4 rounded-2xl flex items-center justify-center gap-2 transition-all border ${transportMode === 'foot' ? 'bg-[#053e73] text-white border-[#053e73] shadow-lg' : 'bg-white/50 backdrop-blur-lg text-slate-600 hover:bg-white/70 border-white/40'}`}
               >
                 <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2"/><path d="m10 22 4-12"/><path d="M8 22h8"/><path d="m7 10 2-2 2 2"/><path d="m15 10-2-2-2 2"/></svg>
                 <span className="text-sm font-semibold">Yaya</span>
               </button>
               <button 
                 onClick={() => handleGetDirections('driving')}
                 className={`flex-1 py-3 px-4 rounded-2xl flex items-center justify-center gap-2 transition-all border ${transportMode === 'driving' ? 'bg-[#053e73] text-white border-[#053e73] shadow-lg' : 'bg-white/50 backdrop-blur-lg text-slate-600 hover:bg-white/70 border-white/40'}`}
               >
                 <Bus className="w-[18px] h-[18px]" />
                 <span className="text-sm font-semibold">Araç</span>
               </button>
             </div>

             {/* Loading State */}
             {routeLoading && (
               <div className="flex items-center justify-center py-8">
                 <div className="w-6 h-6 border-2 border-[#053e73] border-t-transparent rounded-full animate-spin"></div>
                 <span className="ml-3 text-sm text-slate-600">Rota hesaplanıyor...</span>
               </div>
             )}

             {/* Route Info */}
             {!routeLoading && routeInfo && (
               <>
                 {/* Distance & Duration Cards */}
                 <div className="grid grid-cols-2 gap-3 mb-4">
                   <div className="bg-blue-500/10 backdrop-blur-lg rounded-2xl p-4 text-center border border-blue-200/50">
                     <div className="text-2xl font-bold text-[#053e73]">{routeInfo.distanceText}</div>
                     <div className="text-xs text-slate-500 mt-1">Mesafe</div>
                   </div>
                   <div className="bg-green-500/10 backdrop-blur-lg rounded-2xl p-4 text-center border border-green-200/50">
                     <div className="text-2xl font-bold text-green-600">{routeInfo.durationText}</div>
                     <div className="text-xs text-slate-500 mt-1">{transportMode === 'foot' ? 'Yürüyüş' : 'Araç'} Süresi</div>
                   </div>
                 </div>

                 {/* Route Points */}
                 <div className="relative pl-8 border-l-2 border-dashed border-[#053e73]/30 ml-4 mb-4 space-y-4">
                   <div className="relative">
                     <div className="absolute -left-[39px] top-1 w-5 h-5 rounded-full bg-green-500 ring-4 ring-white shadow"></div>
                     <p className="text-xs text-gray-400 font-medium">Başlangıç</p>
                     <p className="text-sm font-semibold text-slate-700">Konumunuz</p>
                   </div>
                   <div className="relative">
                     <div className="absolute -left-[39px] top-1 w-5 h-5 rounded-full bg-[#053e73] ring-4 ring-white shadow flex items-center justify-center">
                        <MapPin className="w-3 h-3 text-white" />
                     </div>
                     <p className="text-xs text-gray-400 font-medium">Varış</p>
                     <p className="text-sm font-semibold text-slate-700">{selectedStop.name}</p>
                   </div>
                 </div>

                 {/* Route Steps */}
                 {routeInfo.steps && routeInfo.steps.length > 0 && (
                   <div className="mb-4">
                     <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Adımlar</h4>
                     <div className="space-y-2 max-h-32 overflow-y-auto">
                       {routeInfo.steps.slice(0, 5).map((step, idx) => (
                         <div key={idx} className="flex items-center gap-3 p-3 bg-white/50 backdrop-blur-lg rounded-xl border border-white/40 hover:bg-white/70 transition-all">
                           <div className="w-7 h-7 bg-[#053e73]/15 backdrop-blur-sm rounded-full flex items-center justify-center text-xs font-bold text-[#053e73]">
                             {idx + 1}
                           </div>
                           <div className="flex-1">
                             <p className="text-xs text-slate-700 font-medium">{step.instruction}</p>
                             <p className="text-[10px] text-slate-400">{Math.round(step.distance)}m</p>
                           </div>
                         </div>
                       ))}
                     </div>
                   </div>
                 )}
               </>
             )}

             {/* No Route Found */}
             {!routeLoading && !routeInfo && (
               <div className="text-center py-8">
                 <p className="text-slate-500 text-sm">Rota bulunamadı</p>
               </div>
             )}

             <button 
               onClick={() => {
                 if (routeInfo && selectedStop) {
                   // Google Maps'te aç
                   const travelMode = transportMode === 'driving' ? 'driving' : 'walking';
                   const url = `https://www.google.com/maps/dir/?api=1&origin=${userLocation?.lat},${userLocation?.lng}&destination=${selectedStop.lat},${selectedStop.lng}&travelmode=${travelMode}`;
                   window.open(url, '_blank');
                 }
               }}
               disabled={!routeInfo}
               className={`w-full py-4 ${routeInfo ? 'bg-[#053e73] hover:bg-blue-900' : 'bg-gray-300 cursor-not-allowed'} text-white font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95`}
             >
                <Navigation className="w-5 h-5" />
                Google Maps'te Aç
             </button>
           </div>
        )}

        {/* --- BOTTOM NAVIGATION BAR - Glassmorphism --- */}
        {!selectedStop && (
          <div className="absolute bottom-6 left-4 right-4 z-[500]">
            <div className="rounded-[28px] h-[72px] shadow-2xl flex items-center justify-around px-6" style={{ background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0.5) 100%)', backdropFilter: 'blur(50px) saturate(200%)', WebkitBackdropFilter: 'blur(50px) saturate(200%)', border: '1.5px solid rgba(255, 255, 255, 0.7)', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.8)' }}>
              
              <NavButton icon={<Home />} label="Ana Sayfa" active={activeTab === 'home'} onClick={() => setActiveTab('home')} />
              <NavButton icon={<Bell />} label="Bildirim" active={activeTab === 'alerts'} onClick={() => setActiveTab('alerts')} />
              <NavButton icon={<Bookmark />} label="Kaydedilen" active={activeTab === 'saved'} onClick={() => setActiveTab('saved')} />
              <NavButton icon={<Settings />} label="Ayarlar" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
            
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// --- Sub Components ---

function TransportOption({ icon, time, active }) {
  return (
    <div className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all cursor-pointer ${active ? 'bg-blue-900 text-white border-blue-900 shadow-md transform scale-105' : 'bg-white text-slate-400 border-gray-100 hover:border-blue-200'}`}>
      <div className={`mb-1 ${active ? 'text-blue-200' : 'text-slate-400'}`}>
        {React.cloneElement(icon, { size: 20 })}
      </div>
      <span className="text-xs font-bold">{time}</span>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-2xl transition-all ${
        active 
          ? 'bg-[#053e73]/10 text-[#053e73]' 
          : 'text-slate-400 hover:text-[#053e73] hover:bg-slate-100/50'
      }`}
    >
      <div className={`transition-transform ${active ? 'scale-110' : ''}`}>
        {React.cloneElement(icon, { size: 22, strokeWidth: active ? 2.5 : 2 })}
      </div>
      <span className={`text-[10px] font-semibold ${active ? 'text-[#053e73]' : 'text-slate-400'}`}>
        {label}
      </span>
    </button>
  );
}
