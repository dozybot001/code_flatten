export class EditorManager {
    constructor(editorContainer, tabsContainer) {
        this.container = editorContainer;
        this.tabsContainer = tabsContainer; // [NEW] Manage Tabs UI
        this.editorInstance = null;
        this.diffEditorInstance = null;
        this.stdWrapper = null;
        this.diffWrapper = null;
        
        // State
        this.tabs = []; 
        this.currentTabId = null;
        
        // Events
        this.onSaveRequest = null; // (fileHandle, content) => Promise<void>

        // Monaco Loader Config
        const MONACO_CDN_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min';
        require.config({ paths: { 'vs': `${MONACO_CDN_BASE}/vs` } });
    }

    async init() {
        return new Promise((resolve) => {
            require(['vs/editor/editor.main'], () => {
                this._defineTheme();
                this._createEditors();
                this._bindTabEvents(); // [NEW]
                resolve();
            });
        });
    }

    _defineTheme() {
        monaco.editor.defineTheme('gemini-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [{ token: '', background: '131314' }],
            colors: {
                'editor.background': '#131314',
                'editor.foreground': '#e3e3e3',
                'editor.lineHighlightBackground': '#1e1f20',
                'editorIndentGuide.background': '#303030',
                'editorLineNumber.foreground': '#5c5c5c',
                'diffEditor.insertedTextBackground': '#2ea04333',
                'diffEditor.removedTextBackground': '#da363333'
            }
        });
    }

    _createEditors() {
        // 1. Standard Editor Wrapper
        this.stdWrapper = document.createElement('div');
        this.stdWrapper.id = 'std-editor-wrapper';
        this.stdWrapper.className = 'editor-instance-wrapper';
        this.container.appendChild(this.stdWrapper);

        this.editorInstance = monaco.editor.create(this.stdWrapper, {
            value: '// Ready to code.',
            language: 'javascript',
            theme: 'gemini-dark',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 14,
            automaticLayout: true,
            wordWrap: 'on',
            minimap: { enabled: false },
        });

        // 2. Diff Editor Wrapper (Hidden by default)
        this.diffWrapper = document.createElement('div');
        this.diffWrapper.id = 'diff-editor-wrapper';
        this.diffWrapper.className = 'editor-instance-wrapper';
        this.diffWrapper.style.display = 'none';
        this.container.appendChild(this.diffWrapper);

        this.diffEditorInstance = monaco.editor.createDiffEditor(this.diffWrapper, {
            theme: 'gemini-dark',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 14,
            automaticLayout: true,
            originalEditable: false,
            readOnly: true,
            renderSideBySide: true
        });

        // Bind Save Command
        this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            this.saveCurrentTab();
        });
    }

    _bindTabEvents() {
        // Horizontal scroll for tabs
        this.tabsContainer.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                this.tabsContainer.scrollLeft += e.deltaY;
            }
        });
    }

    // === Tab Management ===

    async openFile(fileHandle, fullPath) {
        const fileName = fileHandle.name;
        const tabId = fullPath || fileName;

        // 1. Check if exists
        const existingTab = this.tabs.find(t => t.id === tabId);
        if (existingTab) {
            this.switchTab(tabId);
            return;
        }

        // 2. Read content
        const file = await fileHandle.getFile();
        const text = await file.text();
        const language = EditorManager.getLanguage(fileName);
        const model = monaco.editor.createModel(text, language);

        // 3. Listen for changes
        model.onDidChangeContent(() => {
            const tab = this.tabs.find(t => t.id === tabId);
            if (tab && !tab.isDirty) {
                tab.isDirty = true;
                this._renderTabs();
            }
        });

        // 4. Create Tab State
        const newTab = {
            id: tabId,
            name: fileName,
            handle: fileHandle,
            model: model,
            viewState: null,
            isDirty: false,
            isDiff: false
        };
        this.tabs.push(newTab);

        this.switchTab(tabId);
    }

    openDiffTab(originalContent, modifiedContent, fileName) {
        const lang = EditorManager.getLanguage(fileName);
        const originalModel = monaco.editor.createModel(originalContent, lang);
        const modifiedModel = monaco.editor.createModel(modifiedContent, lang);

        const diffTabId = `diff-${Date.now()}`;
        const diffTab = {
            id: diffTabId,
            name: `Diff: ${fileName}`,
            isDiff: true,
            originalModel: originalModel,
            modifiedModel: modifiedModel,
            isDirty: false
        };

        this.tabs.push(diffTab);
        this.switchTab(diffTabId);
    }

    switchTab(tabId) {
        // Save old view state
        if (this.currentTabId) {
            const currentTab = this.tabs.find(t => t.id === this.currentTabId);
            if (currentTab && !currentTab.isDiff) {
                currentTab.viewState = this.editorInstance.saveViewState();
            }
        }

        const targetTab = this.tabs.find(t => t.id === tabId);
        if (!targetTab) return;

        // Switch Mode
        if (targetTab.isDiff) {
            this.showDiffMode(targetTab.originalModel, targetTab.modifiedModel);
        } else {
            this.showStandardMode(targetTab.model, targetTab.viewState);
        }

        this.currentTabId = tabId;
        this._renderTabs();
    }

    closeTab(tabId) {
        const index = this.tabs.findIndex(t => t.id === tabId);
        if (index === -1) return;
        
        const tabToClose = this.tabs[index];
        
        if (tabToClose.isDirty) {
            if (!confirm(`${tabToClose.name} has unsaved changes. Close anyway?`)) return;
        }

        // Cleanup models
        if (tabToClose.isDiff) {
            tabToClose.originalModel.dispose();
            tabToClose.modifiedModel.dispose();
        } else {
            tabToClose.model.dispose();
        }

        this.tabs.splice(index, 1);

        if (this.currentTabId === tabId) {
            if (this.tabs.length > 0) {
                const newIndex = Math.max(0, index - 1);
                this.switchTab(this.tabs[newIndex].id);
            } else {
                this.currentTabId = null;
                this.editorInstance.setModel(null);
                this._renderTabs();
            }
        } else {
            this._renderTabs();
        }
    }

    async saveCurrentTab() {
        if (!this.currentTabId) return;
        
        const tab = this.tabs.find(t => t.id === this.currentTabId);
        if (!tab || tab.isDiff) return; 

        try {
            const content = tab.model.getValue();
            
            // Delegate I/O to Controller via Callback
            if (this.onSaveRequest) {
                await this.onSaveRequest(tab.handle, content);
            }

            // Update UI State after successful save
            tab.isDirty = false;
            this._renderTabs();

            // Visual Feedback
            const tabEl = document.querySelector(`.tab[data-id="${tab.id}"]`);
            if (tabEl) {
                tabEl.style.borderTopColor = '#4caf50';
                setTimeout(() => tabEl.style.borderTopColor = '', 500);
            }
        } catch (err) {
            console.error("Save failed or cancelled", err);
            // Optional: alert user if controller threw error
        }
    }

    _renderTabs() {
        this.tabsContainer.innerHTML = '';
        
        this.tabs.forEach(tab => {
            const tabEl = document.createElement('div');
            tabEl.className = `tab ${tab.id === this.currentTabId ? 'active' : ''} ${tab.isDirty ? 'is-dirty' : ''}`;
            tabEl.setAttribute('data-id', tab.id);
            
            tabEl.innerHTML = `
                <div class="tab-name">${tab.name}</div>
                <div class="tab-actions">
                    <div class="dirty-dot"></div>
                    <i class="ph ph-x close-icon"></i>
                </div>
            `;
            
            tabEl.addEventListener('click', () => this.switchTab(tab.id));
            
            const closeBtn = tabEl.querySelector('.close-icon');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeTab(tab.id);
            });

            this.tabsContainer.appendChild(tabEl);
        });
    }

    // === Internal / Layout ===

    layout() {
        if (this.editorInstance) this.editorInstance.layout();
        if (this.diffEditorInstance) this.diffEditorInstance.layout();
    }

    showStandardMode(model, viewState = null) {
        this.diffWrapper.style.display = 'none';
        this.stdWrapper.style.display = 'block';

        this.editorInstance.setModel(model);
        if (viewState) {
            this.editorInstance.restoreViewState(viewState);
        }
        this.editorInstance.focus();
    }

    showDiffMode(originalModel, modifiedModel) {
        this.stdWrapper.style.display = 'none';
        this.diffWrapper.style.display = 'block';

        this.diffEditorInstance.setModel({
            original: originalModel,
            modified: modifiedModel
        });
    }

    reset() {
        // Close all tabs and clear editor
        [...this.tabs].forEach(t => this.closeTab(t.id));
    }

    closeDiffTabs() {
        const diffTabs = this.tabs.filter(t => t.isDiff);
        diffTabs.forEach(t => this.closeTab(t.id));
    }
    
    static getLanguage(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        const map = { 
            'js': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript', 'jsx': 'javascript',
            'ts': 'typescript', 'mts': 'typescript', 'cts': 'typescript', 'tsx': 'typescript',
            'html': 'html', 'htm': 'html',
            'css': 'css', 'scss': 'scss', 'less': 'less',
            'json': 'json', 'md': 'markdown', 'py': 'python',
            'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'cpp',
            'cs': 'csharp', 'go': 'go', 'rs': 'rust', 'php': 'php',
            'rb': 'ruby', 'sh': 'shell', 'bash': 'shell', 'zsh': 'shell',
            'yaml': 'yaml', 'yml': 'yaml', 'xml': 'xml', 'sql': 'sql', 'dockerfile': 'dockerfile'
        };
        return map[ext] || 'plaintext';
    }
}