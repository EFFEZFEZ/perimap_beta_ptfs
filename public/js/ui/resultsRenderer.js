/**
 * resultsRenderer.js
 * V214: Rendu simplifié - chaque itinéraire affiché séparément, pas de groupement
 */
import { ICONS } from '../config/icons.js';

export function createResultsRenderer(deps) {
  const { resultsListContainer, resultsModeTabs, getAllItineraries, getArrivalState, setArrivalRenderedCount, onLoadMoreDepartures, onLoadMoreArrivals, getDataManager, getSearchTime } = deps;

  function getItineraryType(itinerary) {
    if (!itinerary) return 'BUS';
    if (itinerary.type) return itinerary.type;
    if (itinerary.summarySegments && itinerary.summarySegments.length > 0) return 'BUS';
    if (itinerary._isBike) return 'BIKE';
    if (itinerary._isWalk) return 'WALK';
    return 'BUS';
  }

  /**
   * Parse l'heure "HH:MM" en minutes depuis minuit
   */
  function parseTimeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return Infinity;
    const match = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (!match) return Infinity;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }

  /**
   * V60: Vérifie si l'itinéraire a de la marche significative
   */
  function hasSignificantWalk(itinerary) {
    if (!itinerary?.steps) return false;
    
    for (const step of itinerary.steps) {
      if (step.type === 'WALK' || step._isWalk) {
        const durationMatch = (step.duration || '').match(/(\d+)/);
        const durationMin = durationMatch ? parseInt(durationMatch[1], 10) : 0;
        if (durationMin > 2) return true;
        
        const distanceMatch = (step.distance || '').match(/(\d+)/);
        const distanceM = distanceMatch ? parseInt(distanceMatch[1], 10) : 0;
        if (distanceM > 100) return true;
      }
    }
    return false;
  }

  function render(mode) {
    if (!resultsListContainer) return;
    const allFetched = getAllItineraries();
    const { lastSearchMode, arrivalRankedAll, arrivalRenderedCount, pageSize } = getArrivalState();
    const isArrival = lastSearchMode === 'arriver';

    resultsListContainer.innerHTML = '';
    
    // V214: Liste simple, pas de groupement
    let list;
    if (isArrival) {
      list = (mode === 'ALL') ? [...arrivalRankedAll] : arrivalRankedAll.filter(i => i.type === mode);
    } else {
      list = (mode === 'ALL') ? [...allFetched] : allFetched.filter(i => i.type === mode);
    }

    if (!list.length) {
      resultsListContainer.innerHTML = `<p class="results-message">Aucun itinéraire n'a été trouvé.</p>`;
      return;
    }

    // V214: Ordre BUS → BIKE → WALK, chaque itinéraire affiché individuellement
    const busItins = list.filter(i => getItineraryType(i) === 'BUS');
    const bikeItins = list.filter(i => getItineraryType(i) === 'BIKE');
    const walkItins = list.filter(i => getItineraryType(i) === 'WALK');
    
    // Trier les bus par heure
    if (isArrival) {
      busItins.sort((a, b) => parseTimeToMinutes(b.arrivalTime) - parseTimeToMinutes(a.arrivalTime));
    } else {
      busItins.sort((a, b) => parseTimeToMinutes(a.departureTime) - parseTimeToMinutes(b.departureTime));
    }

    let hasBusTitle = false, hasBikeTitle = false, hasWalkTitle = false;
    let globalIndex = 0;

    // V214: Fonction pour rendre UN itinéraire (plus de groupes)
    const renderItinerary = (itinerary, forceTitle = '') => {
      const type = getItineraryType(itinerary);
      
      const wrapper = document.createElement('div');
      wrapper.className = 'route-option-wrapper';

      let title = forceTitle;
      if (mode === 'ALL' && !isArrival) {
        if (globalIndex === 0 && !forceTitle) {
          title = 'Suggéré';
          if (type === 'BUS') hasBusTitle = true;
          if (type === 'BIKE') hasBikeTitle = true;
          if (type === 'WALK') hasWalkTitle = true;
        }
        if (!forceTitle) {
          if (type === 'BUS' && !hasBusTitle) { title = 'Itinéraires Bus'; hasBusTitle = true; }
          else if (type === 'BIKE' && !hasBikeTitle) { title = 'Itinéraires Vélo'; hasBikeTitle = true; }
          else if (type === 'WALK' && !hasWalkTitle) { title = 'Itinéraires Piéton'; hasWalkTitle = true; }
        }
      }
      if (title) wrapper.innerHTML += `<p class='route-option-title'>${title}</p>`;

      const card = document.createElement('div');
      card.className = 'route-option';

      let summaryHtml = '';
      if (type === 'BIKE') {
        summaryHtml = `<div class='route-summary-bus-icon route-summary-bike-icon'>${ICONS.BICYCLE}</div><span class='route-type-label'>Trajet à vélo</span><span class='route-type-distance'>${itinerary.steps[0]?.distance || ''}</span>`;
      } else if (type === 'WALK') {
        summaryHtml = `<div class='route-summary-bus-icon route-summary-walk-only-icon'>${ICONS.WALK}</div><span class='route-type-label'>Trajet à pied</span><span class='route-type-distance'>${itinerary.steps[0]?.distance || ''}</span>`;
      } else {
        // Style IDFM - Points entre les étapes
        const segments = itinerary.summarySegments || [];
        const hasWalkAtEnd = hasSignificantWalk(itinerary);
        
        segments.forEach((seg, i) => {
          const label = seg.name || 'Route';
          summaryHtml += `<div class='route-line-badge' style='background-color:${seg.color};color:${seg.textColor};'>${label}</div>`;
          if (i < segments.length - 1) {
            summaryHtml += `<span class='route-summary-dot'>•</span>`;
          }
        });
        
        if (hasWalkAtEnd) {
          summaryHtml += `<span class='route-summary-dot'>•</span>`;
          summaryHtml += `<div class='route-summary-walk-icon'>${ICONS.WALK}</div>`;
        }
      }

      const ecoHtml = (globalIndex === 0 && mode === 'ALL' && type === 'BUS')
        ? `<span class='route-duration-eco'>${ICONS.LEAF_ICON} ${itinerary.duration}</span>`
        : `<span>${itinerary.duration}</span>`;

      const timeHtml = (itinerary.departureTime === '~')
        ? `<span class='route-time' style='color:var(--text-secondary);font-weight:500;'>(Trajet)</span>`
        : `<span class='route-time'>${itinerary.departureTime} &gt; ${itinerary.arrivalTime}</span>`;

      // V214: Plus de "AUSSI À" - chaque trajet est affiché séparément
      card.innerHTML = `
        <div class='route-summary-line'>${summaryHtml}</div>
        <div class='route-footer'>${timeHtml}<span class='route-duration'>${ecoHtml}</span></div>
      `;

      card.addEventListener('click', () => deps.onSelectItinerary(itinerary, card));

      wrapper.appendChild(card);
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'route-details hidden';
      wrapper.appendChild(detailsDiv);
      resultsListContainer.appendChild(wrapper);
      
      globalIndex++;
    };

    // V214: Afficher chaque itinéraire individuellement
    busItins.forEach(it => renderItinerary(it));
    bikeItins.forEach(it => renderItinerary(it));
    walkItins.forEach(it => renderItinerary(it));
    
    // V149: Bouton "Générer + de trajets" pour charger plus de bus
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'btn btn-secondary btn-load-more';
    loadMoreBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
      Générer + de trajets
    `;
    loadMoreBtn.addEventListener('click', () => {
      loadMoreBtn.disabled = true;
      loadMoreBtn.innerHTML = `<span class="spinner-small"></span> Recherche...`;
      
      if (isArrival && typeof deps.onLoadMoreArrivals === 'function') {
        deps.onLoadMoreArrivals().finally(() => {
          loadMoreBtn.disabled = false;
          loadMoreBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
            Générer + de trajets
          `;
        });
      } else if (typeof deps.onLoadMoreDepartures === 'function') {
        deps.onLoadMoreDepartures().finally(() => {
          loadMoreBtn.disabled = false;
          loadMoreBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
            Générer + de trajets
          `;
        });
      }
    });
    resultsListContainer.appendChild(loadMoreBtn);
  }

  return { render };
}
