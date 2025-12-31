export class AppStore extends EventTarget {
    constructor() {
        super();
        this.state = {
            config: {
                apiKey: localStorage.getItem('caret_api_key') || '',
                baseUrl: localStorage.getItem('caret_base_url') || '',
                model: localStorage.getItem('caret_model') || ''
            },
            activeContextFiles: [], // 当前被 AI 选中的上下文文件路径
            repoMap: null           // 缓存的 Repo Map
        };
    }

    // === Config Actions ===
    updateConfig(newConfig) {
        this.state.config = { ...this.state.config, ...newConfig };
        
        // Persist
        if (newConfig.apiKey !== undefined) localStorage.setItem('caret_api_key', newConfig.apiKey);
        if (newConfig.baseUrl !== undefined) localStorage.setItem('caret_base_url', newConfig.baseUrl);
        if (newConfig.model !== undefined) localStorage.setItem('caret_model', newConfig.model);

        this._emit('config-updated', this.state.config);
    }

    getConfig() {
        return { ...this.state.config };
    }

    // === Context Actions ===
    setActiveContextFiles(files) {
        this.state.activeContextFiles = files;
        this._emit('context-updated', this.state.activeContextFiles);
    }

    getActiveContextFiles() {
        return [...this.state.activeContextFiles];
    }

    // === Helper ===
    _emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }
}