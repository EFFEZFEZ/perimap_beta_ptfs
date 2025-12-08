// Copyright © 2025 Périmap - Tous droits réservés
/**
 * api/routes.js
 * Route planner proxy vers OpenTripPlanner (OTP)
 */

import { Router } from 'express';

const router = Router();

// Configuration OTP
const OTP_BASE_URL = process.env.OTP_BASE_URL || 'http://localhost:8080/otp/routers/default';
const OTP_MAX_ITINERARIES = parseInt(process.env.OTP_MAX_ITINERARIES || '5', 10);

// Modes supportés côté client (alignés sur l'ancien Google Routes)
const SUPPORTED_MODES = ['TRANSIT', 'WALK', 'BICYCLE'];

router.post('/', async (req, res) => {
  try {
    const {
      origin,
      destination,
      time,
      timeType = 'departure',
      mode = 'TRANSIT',
      maxWalkDistance = 1000,
      maxTransfers = 3,
    } = req.body || {};

    // Validation basique
    if (!isValidCoord(origin) || !isValidCoord(destination)) {
      return res.status(400).json({ error: 'origin et destination (lat, lon) requis' });
    }

    if (!SUPPORTED_MODES.includes(mode)) {
      return res.status(400).json({ error: `mode invalide. Valeurs: ${SUPPORTED_MODES.join(', ')}` });
    }

    const travelDate = time ? new Date(time) : new Date();
    if (Number.isNaN(travelDate.getTime())) {
      return res.status(400).json({ error: 'time doit être une date ISO valide' });
    }

    const { dateStr, timeStr } = formatForOtp(travelDate);
    const arriveBy = timeType === 'arrival';
    const otpMode = buildOtpMode(mode);

    const searchParams = new URLSearchParams({
      fromPlace: `${origin.lat},${origin.lon}`,
      toPlace: `${destination.lat},${destination.lon}`,
      mode: otpMode,
      date: dateStr,
      time: timeStr,
      arriveBy: arriveBy ? 'true' : 'false',
      maxWalkDistance: String(Math.max(0, maxWalkDistance)),
      numItineraries: String(Math.max(1, OTP_MAX_ITINERARIES)),
      maxTransfers: String(Math.max(0, maxTransfers)),
      wheelchair: req.body?.options?.wheelchairAccessible ? 'true' : 'false',
      optimize: req.body?.options?.preferLessWalking ? 'WALKING' : 'QUICK',
    });

    const otpUrl = `${OTP_BASE_URL}/plan?${searchParams.toString()}`;

    console.log('[routes] Fetching OTP:', otpUrl);
    
    const otpResponse = await fetch(otpUrl, { method: 'GET' });
    const otpJson = await otpResponse.json();

    if (!otpResponse.ok) {
      console.error('[routes] OTP error response:', { status: otpResponse.status, body: otpJson });
      return res.status(502).json({
        error: 'OTP plan error',
        status: otpResponse.status,
        details: otpJson?.error || otpJson,
      });
    }

    if (!otpJson?.plan?.itineraries || !Array.isArray(otpJson.plan.itineraries)) {
      console.error('[routes] OTP invalid response - no itineraries:', otpJson);
      return res.status(502).json({ error: 'Réponse OTP invalide (plan manquant)' });
    }

    const routes = otpJson.plan.itineraries.map(mapItineraryToClient);

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ routes });
  } catch (error) {
    console.error('[routes] OTP proxy error - URL:', `${OTP_BASE_URL}/plan`);
    console.error('[routes] Full error:', {
      message: error.message,
      code: error.code,
      cause: error.cause,
      stack: error.stack?.split('\n').slice(0, 3).join('\n')
    });
    return res.status(502).json({ 
      error: 'Routes proxy error', 
      details: error.message,
      code: error.code,
      otpUrl: OTP_BASE_URL
    });
  }
});

// Helpers
function isValidCoord(obj) {
  if (!obj || typeof obj.lat !== 'number' || typeof obj.lon !== 'number') return false;
  return obj.lat >= -90 && obj.lat <= 90 && obj.lon >= -180 && obj.lon <= 180;
}

function formatForOtp(dateObj) {
  // OTP attend date=YYYY-MM-DD et time=HH:MM au fuseau local
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = dateObj.getFullYear();
  const mm = pad(dateObj.getMonth() + 1);
  const dd = pad(dateObj.getDate());
  const hh = pad(dateObj.getHours());
  const mi = pad(dateObj.getMinutes());
  return { dateStr: `${yyyy}-${mm}-${dd}`, timeStr: `${hh}:${mi}` };
}

function buildOtpMode(mode) {
  if (mode === 'WALK') return 'WALK';
  if (mode === 'BICYCLE') return 'BICYCLE';
  // Transit par défaut: ajouter WALK pour accès/egress
  return 'TRANSIT,WALK';
}

function mapItineraryToClient(itinerary) {
  const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];

  const mappedLegs = legs.map((leg) => {
    const isTransit = leg.mode === 'BUS' || leg.mode === 'TRAM' || leg.mode === 'SUBWAY' || leg.transitLeg;

    return {
      mode: leg.mode,
      duration: toSeconds(leg.duration),
      distanceMeters: Math.round(leg.distance || 0),
      polyline: leg.legGeometry?.points || null,
      from: {
        name: leg.from?.name,
        lat: leg.from?.lat,
        lon: leg.from?.lon,
      },
      to: {
        name: leg.to?.name,
        lat: leg.to?.lat,
        lon: leg.to?.lon,
      },
      transitDetails: isTransit
        ? {
            headsign: leg.headsign,
            routeShortName: leg.routeShortName,
            routeLongName: leg.routeLongName,
            agencyName: leg.agencyName,
            tripId: leg.tripId,
          }
        : undefined,
      steps: [], // Compat avec l'ancien frontend (liste attendue)
    };
  });

  const totalDistance = mappedLegs.reduce((acc, l) => acc + (l.distanceMeters || 0), 0);
  const totalDuration = toSeconds(itinerary.duration);

  return {
    duration: totalDuration,
    distanceMeters: Math.round(totalDistance),
    polyline: itinerary.legs?.[0]?.legGeometry?.points || null,
    legs: mappedLegs,
    fare: itinerary.fare?.fare?.regular?.cents
      ? { currency: itinerary.fare.fare.regular.currency, amountCents: itinerary.fare.fare.regular.cents }
      : undefined,
  };
}

function toSeconds(value) {
  if (typeof value === 'number') return Math.round(value);
  return 0;
}

export default router;
