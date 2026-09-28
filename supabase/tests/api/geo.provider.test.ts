import { GeoService } from '../../../src/app/core/services/geo.service';
let pass=0, fail=0; const ok=(n:string,c:unknown,d='')=>{ if(c){pass++;console.log('  PASS ',n)} else {fail++;console.log('  FAIL ',n,d)} };

// --- faux « google » (formes des objets selon la documentation Google Maps JS)
const ll=(lat:number,lng:number)=>({lat:()=>lat,lng:()=>lng});
(globalThis as any).google = { maps: { importLibrary: async (name:string) => {
  if (name==='places') return { Place: { searchByText: async (req:any) => {
    if (req.textQuery==='boom') throw new Error('quota');
    return { places: [
      { displayName:'Gare routière de Kaolack', formattedAddress:'Route de Dakar, Kaolack, Sénégal', location: ll(14.15,-16.07) },
      { displayName:'Kaolack', formattedAddress:'Kaolack, Sénégal', location: ll(14.152,-16.0726) },
      { displayName:'sans coordonnées', formattedAddress:'x', location: null },
    ] };
  } } };
  if (name==='geocoding') return { Geocoder: class { async geocode(){ return { results: [
    { types:['plus_code'], formatted_address:'8FJ5+2X Kaolack', address_components:[] },
    { types:['route'], formatted_address:'Avenue Valdiodio Ndiaye, Kaolack, Sénégal', address_components:[
      {long_name:'Avenue Valdiodio Ndiaye',types:['route']},{long_name:'Médina',types:['sublocality']},{long_name:'Kaolack',types:['locality']} ] },
  ] }; } } };
  throw new Error('lib inconnue '+name);
} } };

const loader:any = { key:'K', disponible:()=>true, load: async()=>{} };
const geo = new GeoService(loader);
const calls:string[]=[]; let routeMode:'ok'|'403'='ok';
(globalThis as any).fetch = async (url:string, init?:any) => {
  calls.push(String(url));
  if (String(url).includes('routes.googleapis.com')) {
    if (routeMode==='403') return { ok:false, status:403, json: async()=>({}) };
    ok('Routes API : clé et masque de champs envoyés', init.headers['X-Goog-Api-Key']==='K' && init.headers['X-Goog-FieldMask'].includes('encodedPolyline'));
    return { ok:true, json: async()=>({ routes:[{ distanceMeters: 12500, duration:'1500s', polyline:{ encodedPolyline:'_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }] }) };
  }
  if (String(url).includes('router.project-osrm.org'))
    return { ok:true, json: async()=>({ routes:[{ distance:9000, duration:600, geometry:{ coordinates:[[-17.4,14.6],[-17.5,14.7]] } }] }) };
  if (String(url).includes('nominatim') && String(url).includes('search')) return { ok:true, json: async()=>[{ lat:'14.1', lon:'-16.0', display_name:'OSM Kaolack', address:{city:'Kaolack'} }] };
  return { ok:false, status:500, json: async()=>({}) };
};

(async()=>{
  console.log('== Google disponible');
  ok('provider = google', geo.provider==='google');
  const s = await geo.searchPlaces('kaolack');
  ok('recherche : 2 résultats (celui sans coordonnées est écarté)', s.length===2, JSON.stringify(s));
  ok('libellé : nom + adresse sans « , Sénégal »', s[0].label==='Gare routière de Kaolack, Route de Dakar, Kaolack', s[0].label);
  ok('libellé : pas de doublon quand l’adresse commence par le nom', s[1].label==='Kaolack', s[1].label);
  ok('coordonnées lues via lat()/lng()', s[0].lat===14.15 && s[0].lng===-16.07);
  ok('géocodage inverse : ignore le plus code, libellé court', (await geo.reverse(14.15,-16.07))==='Avenue Valdiodio Ndiaye, Médina, Kaolack');
  const r = await geo.route({lat:14.6,lng:-17.4},{lat:14.7,lng:-17.5});
  ok('itinéraire Google : 12,5 km, 25 min, 3 points décodés', r.distanceKm===12.5 && r.durationMin===25 && r.geometry.length===3 && r.fiable, JSON.stringify(r).slice(0,120));
  ok('aucun appel OSM quand Google répond', !calls.some(u=>u.includes('nominatim')||u.includes('osrm')));

  console.log('== Google en panne (quota / clé refusée) → repli OpenStreetMap');
  routeMode='403';
  const r2 = await geo.route({lat:14.6,lng:-17.4},{lat:14.7,lng:-17.5});
  ok('itinéraire : repli OSRM (9 km)', r2.distanceKm===9 && r2.geometry.length===2, JSON.stringify(r2));
  const s2 = await geo.searchPlaces('boom');
  ok('recherche : repli Nominatim', s2.length===1 && s2[0].label==='Kaolack' , JSON.stringify(s2));

  console.log('== Sans clé');
  const geoNoKey = new GeoService({ key:'', disponible:()=>false, load: async()=>{ throw new Error('x'); } } as any);
  ok('provider = osm', geoNoKey.provider==='osm');
  ok('recherche directe Nominatim, sans appel Google', (await geoNoKey.searchPlaces('kaolack')).length===1);
  console.log(`\n===== ${pass} réussis, ${fail} échoués =====`); process.exit(fail?1:0);
})();
