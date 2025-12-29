import { Store } from '../store.js';

export const SettingsManager = {
    dom: {},

    init() {
        this.cacheDOM();
        this.bindTheme();
        this.bindApiModal();
        this.bindModelSelector();
        this.bindSettingsMenu();
        
        Store.subscribe((key, value) => {
            if (key === 'theme') {
                this.applyTheme(value);
            }
        });
        this.applyTheme(Store.state.theme);
    },

    cacheDOM() {
        this.dom = {
            btnThemeToggle: document.getElementById('btn-theme-toggle'),
            themeIcon: document.getElementById('theme-icon'),
            themeText: document.getElementById('theme-text'),
            
            btnApiSettings: document.getElementById('btn-api-settings'),
            apiModal: document.getElementById('api-modal'),
            btnCloseApi: document.getElementById('btn-close-api'),
            btnSaveApi: document.getElementById('btn-save-api'),
            inputBaseUrl: document.getElementById('api-base-url'),
            inputApiKey: document.getElementById('api-key'),
            inputModel: document.getElementById('api-model'),
             
            btnModelSelector: document.getElementById('model-selector'),
            modelMenu: document.getElementById('model-menu'),
            
            btnSettingsTop: document.getElementById('btn-settings-top'),
            settingsModal: document.getElementById('settings-modal')
        };
    },

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        if (this.dom.themeIcon && this.dom.themeText) {
            const isLight = theme === 'light';
            this.dom.themeIcon.textContent = isLight ? 'light_mode' : 'dark_mode';
            this.dom.themeText.textContent = isLight ? 'Light Mode' : 'Dark Mode';
        }
    },

    bindTheme() {
        if (this.dom.btnThemeToggle) {
            this.dom.btnThemeToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                Store.state.theme = Store.state.theme === 'light' ? 'dark' : 'light';
            });
        }
    },

    bindApiModal() {
        if (!this.dom.btnApiSettings) return;

        this.dom.btnApiSettings.addEventListener('click', () => {
            const { baseUrl, apiKey, modelName } = Store.state.apiConfig;
            this.dom.inputBaseUrl.value = baseUrl || '';
            this.dom.inputApiKey.value = apiKey || '';
            this.dom.inputModel.value = modelName || '';
            
            if (this.dom.settingsModal) this.dom.settingsModal.classList.add('hidden');
            this.dom.apiModal.classList.remove('hidden');
        });

        if (this.dom.btnCloseApi) {
            this.dom.btnCloseApi.addEventListener('click', () => this.dom.apiModal.classList.add('hidden'));
        }

        if (this.dom.btnSaveApi) {
            this.dom.btnSaveApi.addEventListener('click', () => {
                const newConfig = {
                    baseUrl: this.dom.inputBaseUrl.value.trim(),
                    apiKey: this.dom.inputApiKey.value.trim(),
                    modelName: this.dom.inputModel.value.trim()
                };
                Store.state.apiConfig = newConfig;
                localStorage.setItem('api_config', JSON.stringify(newConfig));
                this.dom.apiModal.classList.add('hidden');
            });
        }
    },

    bindModelSelector() {
        const { btnModelSelector, modelMenu, settingsModal } = this.dom;
        if (!btnModelSelector || !modelMenu) return;

        btnModelSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            modelMenu.classList.toggle('hidden');
            if (settingsModal) settingsModal.classList.add('hidden');
        });

        modelMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const option = e.target.closest('.model-option');
            if (option) {
                const selectedValue = option.getAttribute('data-value');
                const textSpan = btnModelSelector.querySelector('#model-text');
                if (textSpan) textSpan.textContent = selectedValue;
                modelMenu.classList.add('hidden');
            }
        });

        document.addEventListener('click', (e) => {
            if (!modelMenu.classList.contains('hidden') && 
                !modelMenu.contains(e.target) && 
                !btnModelSelector.contains(e.target)) {
                modelMenu.classList.add('hidden');
            }
        });
    },

    bindSettingsMenu() {
        const { btnSettingsTop, settingsModal } = this.dom;
        if (!btnSettingsTop || !settingsModal) return;
        
        btnSettingsTop.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsModal.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!settingsModal.classList.contains('hidden') && 
                !settingsModal.contains(e.target) && 
                e.target !== btnSettingsTop) {
                settingsModal.classList.add('hidden');
            }
        });
    }
};