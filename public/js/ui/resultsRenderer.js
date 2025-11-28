/**
 * resultsRenderer.js
 * Rendu des itinéraires + pagination arrivée.
 */
import { ICONS } from '../config/icons.js';

export function createResultsRenderer(deps) {
  const { resultsListContainer, resultsModeTabs, getAllItineraries, getArrivalState, setArrivalRenderedCount, onLoadMoreDepartures } = deps;

  function getItineraryType(itinerary) {
    if (!itinerary) return 'BUS';
    if (itinerary.type) return itinerary.type;
    if (itinerary.summarySegments && itinerary.summarySegments.length > 0) return 'BUS';
    if (itinerary._isBike) return 'BIKE';
    if (itinerary._isWalk) return 'WALK';
    return 'BUS';
  }

  /**
   * V60: Vérifie si l'itinéraire a de la marche significative
   * (pas juste entre arrêts du même nom ou très courte)
   */
  function hasSignificantWalk(itinerary) {
    if (!itinerary?.steps) return false;
    
    for (const step of itinerary.steps) {
      if (step.type === 'WALK' || step._isWalk) {
        // Extraire la durée en minutes
        const durationMatch = (step.duration || '').match(/(\d+)/);
        const durationMin = durationMatch ? parseInt(durationMatch[1], 10) : 0;
        
        // Considérer comme significatif si > 2 minutes
        if (durationMin > 2) {
          return true;
        }
        
        // Ou si la distance est > 100m
        const distanceMatch = (step.distance || '').match(/(\d+)/);
        const distanceM = distanceMatch ? parseInt(distanceMatch[1], 10) : 0;
        if (distanceM > 100) {
          return true;
        }
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
    let list;
    if (isArrival) {
      const base = arrivalRankedAll.slice(0, arrivalRenderedCount || pageSize);
      list = (mode === 'ALL') ? base : base.filter(i => i.type === mode);
    } else {
      list = (mode === 'ALL') ? allFetched : allFetched.filter(i => i.type === mode);
    }

    if (!list.length) {
      resultsListContainer.innerHTML = `<p class="results-message">Aucun itinéraire n'a été trouvé.</p>`;
      return;
    }

    // Regroupement seulement pour mode départ
    // On garde l'ordre de tri pour les BUS (par heure de départ)
    if (!isArrival && mode === 'ALL' && list.length > 1) {
      const suggested = list[0];
      const rest = list.slice(1);
      const buckets = { BUS: [], BIKE: [], WALK: [], OTHER: [] };
      rest.forEach(it => {
        const t = getItineraryType(it);
        if (t === 'BUS') buckets.BUS.push(it);
        else if (t === 'BIKE') buckets.BIKE.push(it);
        else if (t === 'WALK') buckets.WALK.push(it);
        else buckets.OTHER.push(it);
      });
      // Note: les BUS sont déjà triés par heure de départ, on les garde dans l'ordre
      list = [suggested, ...buckets.BUS, ...buckets.BIKE, ...buckets.WALK, ...buckets.OTHER];
    }

    let hasBusTitle = false, hasBikeTitle = false, hasWalkTitle = false;

    list.forEach((itinerary, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'route-option-wrapper';

      let title = '';
      const type = getItineraryType(itinerary);
      if (mode === 'ALL') {
        if (!isArrival && index === 0) {
          title = 'Suggéré';
          if (type === 'BUS') hasBusTitle = true;
          if (type === 'BIKE') hasBikeTitle = true;
          if (type === 'WALK') hasWalkTitle = true;
        }
        if (!isArrival) {
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
        summaryHtml = `<div class='route-summary-bus-icon' style='color:#059669;border-color:#059669;'>${ICONS.BICYCLE}</div><span style='font-weight:600;font-size:0.9rem;'>Trajet à vélo (${itinerary.steps[0].distance})</span>`;
      } else if (type === 'WALK') {
        summaryHtml = `<div class='route-summary-bus-icon' style='color:var(--secondary);border-color:var(--secondary);'>${ICONS.WALK}</div><span style='font-weight:600;font-size:0.9rem;'>Trajet à pied (${itinerary.steps[0].distance})</span>`;
      } else {
        // V60: Ajouter icône marche si marche significative
        const hasWalk = hasSignificantWalk(itinerary);
        if (hasWalk) {
          summaryHtml = `<div class='route-summary-walk-icon'>${ICONS.WALK}</div>`;
        }
        summaryHtml += `<div class='route-summary-bus-icon' style='color:var(--primary);border-color:var(--primary);'>${ICONS.BUS}</div>`;
        itinerary.summarySegments.forEach((seg, i) => {
          const label = seg.name || 'Route';
          summaryHtml += `<div class='route-line-badge' style='background-color:${seg.color};color:${seg.textColor};'>${label}</div>`;
          if (i < itinerary.summarySegments.length - 1) summaryHtml += `<span class='route-summary-dot'>•</span>`;
        });
        // V60: Ajouter icône marche à la fin aussi si marche significative
        if (hasWalk) {
          summaryHtml += `<div class='route-summary-walk-icon'>${ICONS.WALK}</div>`;
        }
      }

      const ecoHtml = (index === 0 && mode === 'ALL' && type === 'BUS')
        ? `<span class='route-duration-eco'>${ICONS.LEAF_ICON} ${itinerary.duration}</span>`
        : `<span>${itinerary.duration}</span>`;

      const timeHtml = (itinerary.departureTime === '~')
        ? `<span class='route-time' style='color:var(--text-secondary);font-weight:500;'>(Trajet)</span>`
        : `<span class='route-time'>${itinerary.departureTime} &gt; ${itinerary.arrivalTime}</span>`;

      card.innerHTML = `<div class='route-summary-line'>${summaryHtml}</div><div class='route-footer'>${timeHtml}<span class='route-duration'>${ecoHtml}</span></div>`;

      card.addEventListener('click', () => deps.onSelectItinerary(itinerary, card));

      wrapper.appendChild(card);
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'route-details hidden';
      wrapper.appendChild(detailsDiv);
      resultsListContainer.appendChild(wrapper);
    });

    if (isArrival && mode === 'ALL' && arrivalRenderedCount < arrivalRankedAll.length) {
      const moreWrapper = document.createElement('div');
      moreWrapper.className = 'load-more-wrapper';
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.textContent = 'Charger plus';
      btn.addEventListener('click', () => {
        setArrivalRenderedCount(Math.min(arrivalRenderedCount + pageSize, arrivalRankedAll.length));
        render('ALL');
      });
      moreWrapper.appendChild(btn);
      resultsListContainer.appendChild(moreWrapper);
    }

    // V60: Bouton "Charger + de départs" pour le mode partir (BUS uniquement)
    if (!isArrival && mode === 'ALL' && onLoadMoreDepartures) {
      const busItineraries = list.filter(it => getItineraryType(it) === 'BUS');
      if (busItineraries.length > 0) {
        const moreWrapper = document.createElement('div');
        moreWrapper.className = 'load-more-wrapper load-more-departures';
        const btn = document.createElement('button');
        btn.className = 'btn btn-outline-primary';
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          Charger + de départs
        `;
        btn.addEventListener('click', () => {
          btn.disabled = true;
          btn.innerHTML = `<span class="spinner-small"></span> Chargement...`;
          onLoadMoreDepartures();
        });
        moreWrapper.appendChild(btn);
        resultsListContainer.appendChild(moreWrapper);
      }
    }
  }

  return { render };
}
