export default async function handler(req, res) {
    const apiKey = process.env.GMAPS_SERVER_KEY;
    if (!apiKey) {
        res.status(500).json({ error: 'GMAPS_SERVER_KEY manquant sur le serveur.' });
        return;
    }

    const { lat, lon, lng } = req.query || {};
    const latitude = lat ?? req.query?.latitude;
    const longitude = lon ?? lng ?? req.query?.longitude;

    if (!latitude || !longitude) {
        res.status(400).json({ error: 'Paramètres lat et lng obligatoires.' });
        return;
    }

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${latitude},${longitude}`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('language', req.query?.language || 'fr');

    try {
        const upstream = await fetch(url.toString());
        const payload = await upstream.json();
        if (!upstream.ok) {
            res.status(upstream.status).json(payload);
            return;
        }
        
        // Cache CDN Vercel : 5 min (s-maxage) + stale pendant revalidation
        // Les adresses géographiques sont stables, cache agressif OK
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=60');
        res.status(200).json(payload);
    } catch (error) {
        res.status(502).json({ error: 'Geocode proxy error', details: error.message });
    }
}
