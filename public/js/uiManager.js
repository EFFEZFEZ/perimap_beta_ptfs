export class UIManager {
    constructor({ icons, geolocationManager }) {
        this.icons = icons;
        this.geolocationManager = geolocationManager;
        this.timeDropdowns = new Set();
        this.handleTimeDropdownDocumentClick = this.handleTimeDropdownDocumentClick.bind(this);
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
                option.textContent = `${String(h).padStart(2, '0')} h`;
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

            this.enhanceTimeSelect(hourEl, (option) => option?.textContent || '--');
            this.enhanceTimeSelect(minEl, (option) => option?.textContent || '--');
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
                this.closeAllTimeDropdowns();
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
                        this.syncEnhancedTimeSelect(hourSelect);
                        this.syncEnhancedTimeSelect(minuteSelect);
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
                this.closeAllTimeDropdowns();
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

    enhanceTimeSelect(selectEl, formatFn = (option) => option?.textContent || '') {
        if (!selectEl) return;
        if (!selectEl._enhancedDropdown) {
            this.createTimeDropdown(selectEl);
        }
        selectEl._enhancedDropdown.formatOption = formatFn;
        this.buildTimeDropdownOptions(selectEl);
        this.updateTimeDropdownDisplay(selectEl);
    }

    createTimeDropdown(selectEl) {
        const wrapper = document.createElement('div');
        wrapper.className = 'time-select-wrapper';
        const parent = selectEl.parentNode;
        parent.insertBefore(wrapper, selectEl);
        wrapper.appendChild(selectEl);
        selectEl.classList.add('time-select-native');
        selectEl.setAttribute('tabindex', '-1');
        selectEl.setAttribute('aria-hidden', 'true');

        const displayBtn = document.createElement('button');
        displayBtn.type = 'button';
        displayBtn.className = 'time-select-display';
        displayBtn.setAttribute('aria-haspopup', 'listbox');
        displayBtn.setAttribute('aria-expanded', 'false');
        wrapper.appendChild(displayBtn);

        const menu = document.createElement('div');
        menu.className = 'time-select-menu';
        menu.setAttribute('role', 'listbox');
        wrapper.appendChild(menu);

        displayBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const isOpen = wrapper.classList.contains('is-open');
            this.toggleTimeDropdown(selectEl, !isOpen);
        });

        selectEl.addEventListener('change', () => {
            this.updateTimeDropdownDisplay(selectEl);
        });

        selectEl._enhancedDropdown = {
            wrapper,
            displayBtn,
            menu,
            formatOption: (option) => option?.textContent || ''
        };

        this.timeDropdowns.add(selectEl);
        if (!this.timeDropdownListenerAttached) {
            document.addEventListener('click', this.handleTimeDropdownDocumentClick);
            this.timeDropdownListenerAttached = true;
        }
    }

    buildTimeDropdownOptions(selectEl) {
        const meta = selectEl?._enhancedDropdown;
        if (!meta) return;
        const { menu, formatOption } = meta;
        menu.innerHTML = '';
        Array.from(selectEl.options || []).forEach((option) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'time-select-option';
            btn.textContent = formatOption(option);
            btn.dataset.value = option.value;
            btn.setAttribute('role', 'option');
            if (option.disabled) btn.disabled = true;
            if (option.value === selectEl.value) btn.classList.add('is-active');
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                selectEl.value = option.value;
                this.updateTimeDropdownDisplay(selectEl);
                this.toggleTimeDropdown(selectEl, false);
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            });
            menu.appendChild(btn);
        });
    }

    updateTimeDropdownDisplay(selectEl) {
        const meta = selectEl?._enhancedDropdown;
        if (!meta) return;
        const { displayBtn, menu, formatOption } = meta;
        const selectedOption = selectEl.options[selectEl.selectedIndex];
        displayBtn.textContent = formatOption(selectedOption) || '--';
        menu.querySelectorAll('.time-select-option').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.value === selectEl.value);
        });
    }

    toggleTimeDropdown(selectEl, shouldOpen) {
        const meta = selectEl?._enhancedDropdown;
        if (!meta) return;
        if (shouldOpen) {
            this.timeDropdowns.forEach((dropdown) => {
                if (dropdown !== selectEl) {
                    this.toggleTimeDropdown(dropdown, false);
                }
            });
        }
        const { wrapper, displayBtn } = meta;
        wrapper.classList.toggle('is-open', shouldOpen);
        displayBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }

    handleTimeDropdownDocumentClick(event) {
        if (event.target.closest('.time-select-wrapper')) return;
        this.closeAllTimeDropdowns();
    }

    closeAllTimeDropdowns() {
        this.timeDropdowns.forEach((dropdown) => this.toggleTimeDropdown(dropdown, false));
    }

    syncEnhancedTimeSelect(selectEl) {
        if (!selectEl?._enhancedDropdown) return;
        this.updateTimeDropdownDisplay(selectEl);
    }
}
