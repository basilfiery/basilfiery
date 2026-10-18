import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { BairroTaxa, FaixaRaio, Ponto } from '../lib/mapa';
import { brl } from '../lib/util';

const CORES = ['#ff5a1f', '#f59f00', '#37b24d', '#1c7ed6', '#7048e8', '#d6336c', '#0ca678', '#e8590c'];

/**
 * Mapa da entrega: pino da loja (arrastável), círculos das faixas de distância
 * e marcadores dos bairros. Clicar no mapa avisa o ponto (para pegar o bairro).
 */
export default function MapaEntrega({ loja, raios = [], bairros = [], aoMoverLoja, aoClicar, altura = 380 }: {
  loja: Ponto | null;
  raios?: FaixaRaio[];
  bairros?: BairroTaxa[];
  aoMoverLoja?: (p: Ponto) => void;
  aoClicar?: (p: Ponto) => void;
  altura?: number;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);
  const cb = useRef({ aoMoverLoja, aoClicar });
  cb.current = { aoMoverLoja, aoClicar };
  const enquadrado = useRef('');

  useEffect(() => {
    if (!caixa.current || mapa.current) return;
    const m = L.map(caixa.current, { zoomControl: true, attributionControl: true }).setView(loja ? [loja.lat, loja.lng] : [-14.2, -51.9], loja ? 14 : 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => cb.current.aoClicar?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    camada.current = L.layerGroup().addTo(m);
    mapa.current = m;
    const r = new ResizeObserver(() => m.invalidateSize());
    r.observe(caixa.current);
    return () => { r.disconnect(); m.remove(); mapa.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = mapa.current;
    const g = camada.current;
    if (!m || !g) return;
    g.clearLayers();
    if (loja) {
      // Faixas de distância: da maior para a menor (a menor fica por cima)
      const ordem = [...raios].filter((x) => x.ate_km > 0).sort((a, b) => b.ate_km - a.ate_km);
      ordem.forEach((f, i) => {
        const cor = CORES[(ordem.length - 1 - i) % CORES.length];
        L.circle([loja.lat, loja.lng], { radius: f.ate_km * 1000, color: cor, weight: 2, fillColor: cor, fillOpacity: 0.1 })
          .bindTooltip(`Até ${String(f.ate_km).replace('.', ',')} km · ${Number(f.taxa) > 0 ? brl(Number(f.taxa)) : 'grátis'}`, { sticky: true })
          .addTo(g);
      });
      const pino = L.marker([loja.lat, loja.lng], {
        draggable: !!cb.current.aoMoverLoja,
        icon: L.divIcon({ className: 'mapa-pino', html: '<span>Loja</span>', iconSize: [44, 44], iconAnchor: [22, 44] }),
        zIndexOffset: 1000,
      }).addTo(g);
      pino.on('dragend', () => { const p = pino.getLatLng(); cb.current.aoMoverLoja?.({ lat: p.lat, lng: p.lng }); });
      // Enquadra só quando a loja ou o maior raio mudam
      const chave = `${loja.lat.toFixed(4)},${loja.lng.toFixed(4)},${ordem[0]?.ate_km ?? 0}`;
      if (chave !== enquadrado.current) {
        enquadrado.current = chave;
        if (ordem[0]) m.fitBounds(L.latLng(loja.lat, loja.lng).toBounds(ordem[0].ate_km * 2000), { padding: [20, 20] });
        else m.setView([loja.lat, loja.lng], Math.max(m.getZoom(), 14));
      }
    }
    bairros.filter((b) => b.lat != null && b.lng != null).forEach((b, i) => {
      L.marker([b.lat!, b.lng!], {
        icon: L.divIcon({ className: 'mapa-bairro', html: `<b style="--c:${CORES[i % CORES.length]}">${b.nome.replace(/[<>&]/g, '')}<small>${Number(b.taxa) > 0 ? brl(Number(b.taxa)) : 'grátis'}</small></b>`, iconSize: [0, 0] }),
      }).addTo(g);
    });
  }, [loja, raios, bairros]);

  return <div ref={caixa} className="mapa-entrega" style={{ height: altura }} />;
}
