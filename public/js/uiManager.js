export class UIManager {
    constructor({ icons, geolocationManager }) {
        this.icons = icons;
        this.geolocationManager = geolocationManager;
    }

    applyThemeState(useDarkParam, renderers = []) {
        const useDark = !!useDarkParam;
        document.body.classList.toggle('dark-theme', useDark);
        const btn = document.getElementById('theme-toggle-btn');
        if (btn) {
            btn.setAttribute('aria-pressed', useDark ? 'true' : 'false');
            btn.title = useDark ? 'Thème clair' : 'Thème sombre';
        }
        const icon = document.getElementById('theme-toggle-icon');
        if (icon) {
            icon.textContent = useDark ? '☀️' : '🌙';
        }

        try {
            ['map', 'detail-map', 'results-map'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.toggle('dark-theme', useDark);
            });
        } catch (e) {
            // ignore theme toggle errors
        }

        const themedRenderers = (renderers || []).filter(Boolean);
        themedRenderers.forEach(renderer => {
            if (typeof renderer?.applyTheme === 'function') {
                renderer.applyTheme(useDark);
                if (renderer.map) {
                    renderer.map.invalidateSize();
                }
            }
        });
    }

    initTheme(renderers = []) {
        try {
            const saved = localStorage.getItem('ui-theme');
            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            const useDark = saved ? (saved === 'dark') : prefersDark;
            this.applyThemeState(useDark, renderers);
        } catch (e) {
            console.warn('initTheme error', e);
        }
    }

    populateTimeSelects(config = {}) {
        const { hall, results } = config;
        const populate = (targets) => {
            if (!targets) return;
            const { dateEl, hourEl, minEl } = targets;
            if (!dateEl || !hourEl || !minEl) return;
            const now = new Date();
            const selectedHour = now.getHours();
            const selectedMinute = Math.round(now.getMinutes() / 5) * 5;

            dateEl.innerHTML = '';
            for (let offset = 0; offset < 7; offset++) {
                const dateObj = new Date();
                dateObj.setDate(now.getDate() + offset);
                const isoValue = dateObj.toISOString().split('T')[0];
                const option = document.createElement('option');
                option.value = isoValue;
                option.textContent = this.formatDateLabel(dateObj, offset);
                if (offset === 0) option.selected = true;
                dateEl.appendChild(option);
            }

            hourEl.innerHTML = '';
            for (let h = 0; h < 24; h++) {
                const option = document.createElement('option');
                option.value = h;
                option.textContent = `${h} h`;
                if (h === selectedHour) option.selected = true;
                hourEl.appendChild(option);
            }

            minEl.innerHTML = '';
            for (let m = 0; m < 60; m += 5) {
                const option = document.createElement('option');
                option.value = m;
                option.textContent = String(m).padStart(2, '0');
                if (m === selectedMinute) option.selected = true;
                minEl.appendChild(option);
            }
        };

        populate(hall);
        populate(results);
    }

    formatDateLabel(dateObj, offset) {
        if (offset === 0) return "Aujourd'hui";
        if (offset === 1) return 'Demain';
        const formatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
        return formatter.format(dateObj);
    }

    setupPlannerListeners(source, elements, deps) {
        const {
            submitBtn,
            fromInput,
            toInput,
            fromSuggestions,
            toSuggestions,
            swapBtn,
            whenBtn,
            popover,
            dateSelect,
            hourSelect,
            minuteSelect,
            popoverSubmitBtn,
            geolocateBtn
        } = elements;

        const {
            onExecuteSearch,
            handleAutocomplete,
            getFromPlaceId,
            setFromPlaceId,
            getToPlaceId,
            setToPlaceId
        } = deps;

        let userAdjustedTime = false;

        try {
            if (dateSelect) dateSelect.addEventListener('change', () => { userAdjustedTime = true; });
            if (hourSelect) hourSelect.addEventListener('change', () => { userAdjustedTime = true; });
            if (minuteSelect) minuteSelect.addEventListener('change', () => { userAdjustedTime = true; });
        } catch (e) {
            // ignore missing selects
        }

        submitBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (popover && !popover.classList.contains('hidden')) {
                popover.classList.add('hidden');
                whenBtn.classList.remove('popover-active');
            }
            await onExecuteSearch(source, elements);
        });

        fromInput.addEventListener('input', (e) => {
            handleAutocomplete(e.target.value, fromSuggestions, (placeId) => {
                setFromPlaceId(placeId);
            });
        });

        toInput.addEventListener('input', (e) => {
            handleAutocomplete(e.target.value, toSuggestions, (placeId) => {
                setToPlaceId(placeId);
            });
        });

        if (whenBtn && popover) {
            whenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                popover.classList.toggle('hidden');
                whenBtn.classList.toggle('popover-active');
                userAdjustedTime = false;
            });
            popover.querySelectorAll('.popover-tab').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    popover.querySelectorAll('.popover-tab').forEach(t => t.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    const tabType = e.currentTarget.dataset.tab;
                    popoverSubmitBtn.textContent = (tabType === 'arriver') ? "Valider l'arrivée" : 'Partir maintenant';
                });
            });
            popoverSubmitBtn.addEventListener('click', () => {
                const dateText = dateSelect.options[dateSelect.selectedIndex]?.text || '';
                const tab = popover.querySelector('.popover-tab.active')?.dataset?.tab || 'partir';

                if (tab === 'partir' && !userAdjustedTime) {
                    const now = new Date();
                    const todayValue = now.toISOString().split('T')[0];
                    let currentHour = now.getHours();
                    let currentMinute = Math.round(now.getMinutes() / 5) * 5;
                    if (currentMinute === 60) {
                        currentMinute = 0;
                        currentHour = (currentHour + 1) % 24;
                    }
                    try {
                        dateSelect.value = todayValue;
                        hourSelect.value = currentHour;
                        minuteSelect.value = currentMinute;
                    } catch (e) {}
                }

                const hourText = String(hourSelect.value).padStart(2, '0');
                const minuteText = String(minuteSelect.value).padStart(2, '0');
                const mainBtnSpan = whenBtn.querySelector('span');
                let prefix = (tab === 'arriver') ? 'Arrivée' : 'Départ';
                if (dateText === "Aujourd'hui") {
                    mainBtnSpan.textContent = `${prefix} à ${hourText}h${minuteText}`;
                } else {
                    mainBtnSpan.textContent = `${prefix} ${dateText.toLowerCase()} à ${hourText}h${minuteText}`;
                }
                popover.classList.add('hidden');
                whenBtn.classList.remove('popover-active');
            });
            popover.addEventListener('click', (e) => e.stopPropagation());
        }

        if (swapBtn) {
            swapBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const fromVal = fromInput.value;
                fromInput.value = toInput.value;
                toInput.value = fromVal;
                const tempId = getFromPlaceId();
                setFromPlaceId(getToPlaceId());
                setToPlaceId(tempId);
            });
        }

        if (geolocateBtn) {
            geolocateBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (!this.geolocationManager) {
                    console.warn('Geolocation manager non initialisé');
                    return;
                }
                this.geolocationManager.useCurrentLocationAsDeparture({
                    fromInput,
                    toInput,
                    geolocateBtn,
                    onPlaceResolved: (placeId) => {
                        setFromPlaceId(placeId);
                    }
                });
            });
        }
    }
}
