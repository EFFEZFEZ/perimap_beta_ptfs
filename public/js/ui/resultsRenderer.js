/**
 * resultsRenderer.js
 * Rendu des itinéraires + pagination arrivée.
 */
import { ICONS } from '../constants.js';

export function createResultsRenderer(deps) {
  const { resultsListContainer, resultsModeTabs, getAllItineraries, getArrivalState, setArrivalRenderedCount } = deps;

  function getItineraryType(itinerary) {
    if (!itinerary) return 'BUS';
    if (itinerary.type) return itinerary.type;
    if (itinerary.summarySegments && itinerary.summarySegments.length > 0) return 'BUS';
    if (itinerary._isBike) return 'BIKE';
    if (itinerary._isWalk) return 'WALK';
    return 'BUS';
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
        summaryHtml = `<div class='route-summary-bus-icon' style='color:var(--primary);border-color:var(--primary);'>${ICONS.BUS}</div>`;
        itinerary.summarySegments.forEach((seg, i) => {
          const label = seg.name || 'Route';
          summaryHtml += `<div class='route-line-badge' style='background-color:${seg.color};color:${seg.textColor};'>${label}</div>`;
          if (i < itinerary.summarySegments.length - 1) summaryHtml += `<span class='route-summary-dot'>•</span>`;
        });
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
  }

  return { render };
}
