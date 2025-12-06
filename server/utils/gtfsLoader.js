/**
 * utils/gtfsLoader.js
 * Chargement et parsing des fichiers GTFS
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 */

import { createReadStream, existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Parse un fichier CSV
 * @param {string} filePath - Chemin du fichier
 * @returns {Promise<Array>} Données parsées
 */
export async function parseCSV(filePath) {
  // NOTE: En production, utiliser csv-parse
  /*
  const { parse } = await import('csv-parse');
  
  return new Promise((resolve, reject) => {
    const records = [];
    
    createReadStream(filePath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
      }))
      .on('data', (record) => records.push(record))
      .on('end', () => resolve(records))
      .on('error', reject);
  });
  */
  
  // Placeholder: lire le fichier comme texte simple
  return [];
}

/**
 * Charge tous les fichiers GTFS d'un répertoire
 * 
 * @param {string} gtfsDir - Chemin vers le répertoire GTFS
 * @returns {Promise<Object>} Données GTFS
 */
export async function loadGtfsData(gtfsDir) {
  console.log(`📂 Chargement GTFS depuis ${gtfsDir}...`);

  if (!existsSync(gtfsDir)) {
    throw new Error(`Répertoire GTFS non trouvé: ${gtfsDir}`);
  }

  const files = readdirSync(gtfsDir);
  console.log(`   Fichiers trouvés: ${files.join(', ')}`);

  const data = {
    stops: [],
    routes: [],
    trips: [],
    stopTimes: [],
    calendar: [],
    calendarDates: [],
    shapes: [],
    agency: [],
  };

  // Mapping fichier -> propriété
  const fileMapping = {
    'stops.txt': 'stops',
    'routes.txt': 'routes',
    'trips.txt': 'trips',
    'stop_times.txt': 'stopTimes',
    'calendar.txt': 'calendar',
    'calendar_dates.txt': 'calendarDates',
    'shapes.txt': 'shapes',
    'agency.txt': 'agency',
  };

  // Charger chaque fichier
  for (const [filename, prop] of Object.entries(fileMapping)) {
    const filePath = join(gtfsDir, filename);
    
    if (existsSync(filePath)) {
      console.log(`   Chargement ${filename}...`);
      data[prop] = await parseCSV(filePath);
      console.log(`   -> ${data[prop].length} entrées`);
    } else {
      console.log(`   ⚠️ ${filename} non trouvé`);
    }
  }

  // Post-traitement
  data.stops = processStops(data.stops);
  data.stopTimes = processStopTimes(data.stopTimes);
  data.calendar = processCalendar(data.calendar);

  console.log('✅ GTFS chargé');
  
  return data;
}

/**
 * Traite les arrêts
 */
function processStops(stops) {
  return stops.map(stop => ({
    ...stop,
    stop_lat: parseFloat(stop.stop_lat),
    stop_lon: parseFloat(stop.stop_lon),
    location_type: stop.location_type || '0',
    wheelchair_boarding: stop.wheelchair_boarding || '0',
  }));
}

/**
 * Traite les horaires
 */
function processStopTimes(stopTimes) {
  return stopTimes.map(st => ({
    ...st,
    stop_sequence: parseInt(st.stop_sequence, 10),
    arrival_time: parseGtfsTime(st.arrival_time),
    departure_time: parseGtfsTime(st.departure_time),
    pickup_type: st.pickup_type || '0',
    drop_off_type: st.drop_off_type || '0',
  }));
}

/**
 * Traite le calendrier
 */
function processCalendar(calendar) {
  return calendar.map(cal => ({
    ...cal,
    monday: cal.monday === '1',
    tuesday: cal.tuesday === '1',
    wednesday: cal.wednesday === '1',
    thursday: cal.thursday === '1',
    friday: cal.friday === '1',
    saturday: cal.saturday === '1',
    sunday: cal.sunday === '1',
  }));
}

/**
 * Parse une heure GTFS (HH:MM:SS) en secondes depuis minuit
 * Gère les heures > 24h (services de nuit)
 * 
 * @param {string} timeStr - Heure au format HH:MM:SS
 * @returns {number} Secondes depuis minuit
 */
export function parseGtfsTime(timeStr) {
  if (!timeStr) return 0;
  
  const parts = timeStr.split(':');
  if (parts.length !== 3) return 0;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Formate des secondes en heure GTFS
 * 
 * @param {number} seconds - Secondes depuis minuit
 * @returns {string} Heure au format HH:MM:SS
 */
export function formatGtfsTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return [hours, minutes, secs]
    .map(n => n.toString().padStart(2, '0'))
    .join(':');
}

/**
 * Formate une date au format GTFS (YYYYMMDD)
 * 
 * @param {Date} date
 * @returns {string}
 */
export function formatGtfsDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Parse une date GTFS
 * 
 * @param {string} dateStr - Date au format YYYYMMDD
 * @returns {Date}
 */
export function parseGtfsDate(dateStr) {
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1;
  const day = parseInt(dateStr.substring(6, 8), 10);
  return new Date(year, month, day);
}

export default {
  loadGtfsData,
  parseGtfsTime,
  formatGtfsTime,
  formatGtfsDate,
  parseGtfsDate,
};
