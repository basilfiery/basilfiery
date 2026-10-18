/* Endereços e distâncias (OpenStreetMap / Nominatim, gratuito). */

export interface Ponto { lat: number; lng: number }
export interface FaixaRaio { ate_km: number; taxa: number }
export interface BairroTaxa { nome: string; taxa: number; lat?: number; lng?: number }

const NOMINATIM = 'https://nominatim.openstreetmap.org';

/** Endereço → coordenadas (Brasil). */
export async function buscarEndereco(texto: string): Promise<Ponto | null> {
  const q = texto.replace(/\s+/g, ' ').trim();
  if (q.length < 4) return null;
  try {
    const r = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
    const j = (await r.json()) as { lat: string; lon: string }[];
    return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
  } catch {
    return null;
  }
}

/** Coordenadas → nome do bairro daquele ponto. */
export async function bairroDoPonto(p: Ponto): Promise<string | null> {
  try {
    const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=16&addressdetails=1&accept-language=pt-BR&lat=${p.lat}&lon=${p.lng}`);
    const j = (await r.json()) as { address?: Record<string, string> };
    const a = j.address ?? {};
    const cidade = (a.city || a.town || a.village || a.municipality || '').toLowerCase();
    // Só nome de bairro de verdade (cidade pequena muitas vezes não tem no mapa)
    const nome = a.suburb || a.neighbourhood || a.quarter || a.residential || a.city_district || '';
    return nome && nome.toLowerCase() !== cidade ? nome : null;
  } catch {
    return null;
  }
}

/** Distância em linha reta (km). */
export function distanciaKm(a: Ponto, b: Ponto) {
  const rad = (g: number) => (g * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 100) / 100;
}

/** Taxa para a distância (null = fora da área). */
export function taxaPorRaio(raios: FaixaRaio[], km: number) {
  const f = [...raios].sort((x, y) => x.ate_km - y.ate_km).find((x) => Number(x.ate_km) >= km);
  return f ? Number(f.taxa) : null;
}

/** Localização do celular (com permissão). */
export function minhaLocalizacao(): Promise<Ponto> {
  return new Promise((ok, falhou) => {
    if (!navigator.geolocation) return falhou(new Error('Este aparelho não informa a localização.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => ok({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => falhou(new Error('Não deu para pegar sua localização. Libere o acesso ou digite o endereço.')),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  });
}
