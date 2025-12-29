import { ProjectCore } from './core.js';
import { Store } from './store.js';
import { TreeManager } from './ui-tree.js';
import { PatchManager } from './ui-patch.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- 1. 初始化子模块 ---
    TreeManager.init();

    // --- 2. 获取全局 DOM ---
    const dom = {
        inputWrapper: document.getElementById('input-wrapper'),
        outputArea: document.getElementById('output-area'),
        mainInput: document.getElementById('main-input'),
        tagContainer: document.getElementById('tag-container'),
        filePreviewArea: document.getElementById('input-files-area'),
        btnSend: document.getElementById('send-btn'),
        btnMergeContext: document.getElementById('btn-merge'),
        btnRebuild: document.getElementById('btn-rebuild'),
        btnReset: document.getElementById('btn-reset'),
        btnSettingsTop: document.getElementById('btn-settings-top'),
        btnModelSelector: document.getElementById('model-selector'), // Added
        settingsModal: document.getElementById('settings-modal'),
        btnThemeToggle: document.getElementById('btn-theme-toggle'),
        chipBtns: document.querySelectorAll('.chip'),
        btnInputUpload: document.getElementById('btn-input-upload')
    };

    // --- 3. 全局 Store 响应 (主题) ---
    Store.subscribe((key, value) => {
        if (key === 'theme') {
            document.documentElement.setAttribute('data-theme', value);
            localStorage.setItem('theme', value);
            
            const themeIcon = document.getElementById('theme-icon');
            const themeText = document.getElementById('theme-text');
            if (themeIcon && themeText) {
                const isLight = value === 'light';
                themeIcon.textContent = isLight ? 'light_mode' : 'dark_mode';
                themeText.textContent = isLight ? 'Light Mode' : 'Dark Mode';
            }
        }
    });
    // 初始化触发一次
    document.documentElement.setAttribute('data-theme', Store.state.theme);


    // --- 4. 工具栏功能 (Merge, Rebuild, Reset) ---
    
    // Rebuild Project
    if (dom.btnRebuild) {
        dom.btnRebuild.addEventListener('click', async () => {
            if (!Store.state.contextContent) {
                alert("Please upload a Context TXT file first.");
                return;
            }

            const originalHtml = dom.btnRebuild.innerHTML;
            dom.btnRebuild.innerHTML = `<span class="material-symbols-outlined spin">sync</span> <span class="nav-text">BUILDING...</span>`;

            try {
                const { blob, fileName } = await ProjectCore.rebuildProject(Store.state.contextContent);
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = fileName;
                link.click();
                URL.revokeObjectURL(link.href);
                dom.btnRebuild.innerHTML = `<span class="material-symbols-outlined">check</span> <span class="nav-text">DONE</span>`;
            } catch (error) {
                alert("Rebuild failed: " + error.message);
                dom.btnRebuild.innerHTML = `<span class="material-symbols-outlined">error</span> <span class="nav-text">ERROR</span>`;
            }
            setTimeout(() => { dom.btnRebuild.innerHTML = originalHtml; }, 2000);
        });
    }

    // Merge Context
    if (dom.btnMergeContext) {
        dom.btnMergeContext.addEventListener('click', async () => {
            const tree = Store.state.tree;
            const selectedFiles = tree.filter(node => node.type === 'file' && node.selected);
            
            if (selectedFiles.length === 0) {
                alert("Please upload and select source files first.");
                return;
            }

            const originalBtnContent = dom.btnMergeContext.innerHTML;
            dom.btnMergeContext.innerHTML = `<span class="material-symbols-outlined spin">sync</span> <span class="nav-text">PACKING...</span>`;
            
            try {
                const projectName = Store.state.projectName;
                const finalPrompt = await ProjectCore.generateFullContext(selectedFiles, tree, projectName);
                Store.state.contextContent = finalPrompt;

                // Download & Copy
                await navigator.clipboard.writeText(finalPrompt);
                const now = new Date();
                const dateStr = now.toISOString().slice(0,10).replace(/-/g, '');
                const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
                
                const blob = new Blob([finalPrompt], { type: "text/plain;charset=utf-8" });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `${projectName}_${dateStr}_${timeStr}.txt`;
                link.click();
                URL.revokeObjectURL(link.href);

                // UI Update
                const liveIndicator = document.getElementById('live-indicator');
                if(liveIndicator) liveIndicator.classList.add('hidden'); 

                // 调用 TreeManager 更新历史列表
                TreeManager.addContextHistory(Store.state.projectName);

                dom.btnMergeContext.innerHTML = `<span class="material-symbols-outlined">check</span> <span class="nav-text">COPIED & DL</span>`;
            } catch (err) {
                console.error(err);
                dom.btnMergeContext.innerHTML = `<span class="material-symbols-outlined">error</span> <span class="nav-text">ERROR</span>`;
            }
            setTimeout(() => { dom.btnMergeContext.innerHTML = originalBtnContent; }, 2000);
        });
    }

    if (dom.btnReset) {
        dom.btnReset.addEventListener('click', () => {
            if (confirm('Are you sure you want to reset the workspace?')) {
                localStorage.setItem('should_expand_sidebar', 'true');
                window.location.reload();
            }
        });
    }

    // --- 5. Settings & Theme ---
    if (dom.btnThemeToggle) {
        dom.btnThemeToggle.addEventListener('click', (e) => {
            e.stopPropagation(); 
            Store.state.theme = Store.state.theme === 'light' ? 'dark' : 'light';
        });
    }

    // Model Selector Logic (Simple Toggle for demo)
    if (dom.btnModelSelector) {
        dom.btnModelSelector.addEventListener('click', () => {
            const textSpan = dom.btnModelSelector.querySelector('#model-text');
            if (textSpan) {
                const current = textSpan.textContent;
                textSpan.textContent = current === 'Gemini 1.5 Pro' ? 'Gemini Ultra 1.0' : 'Gemini 1.5 Pro';
            }
        });
    }

    if (dom.btnSettingsTop && dom.settingsModal) {
        dom.btnSettingsTop.addEventListener('click', (e) => {
            e.stopPropagation();
            dom.settingsModal.classList.toggle('hidden');
        });
        document.addEventListener('click', (e) => {
            if (!dom.settingsModal.classList.contains('hidden') && 
                !dom.settingsModal.contains(e.target) && 
                e.target !== dom.btnSettingsTop) {
                dom.settingsModal.classList.add('hidden');
            }
        });
    }

    // --- 6. 聊天与输入逻辑 ---

    // File Cards & State
    let currentInputFiles = [];

    function addFileCard(file) {
        currentInputFiles.push(file); // Store file object

        dom.filePreviewArea.classList.remove('hidden');
        const fileName = file.name;
        const ext = fileName.includes('.') ? fileName.split('.').pop() : 'FILE';
        
        const card = document.createElement('div');
        card.className = 'file-card';
        card.innerHTML = `<div class="file-name">${fileName}</div><div class="file-type">${ext}</div>`;
        
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            // Remove from state
            currentInputFiles = currentInputFiles.filter(f => f !== file);
            // Remove from UI
            card.remove();
            if (dom.filePreviewArea.children.length === 0) dom.filePreviewArea.classList.add('hidden');
        });
        dom.filePreviewArea.appendChild(card);
    }

    if (dom.btnInputUpload) {
        const dummyInput = document.createElement('input');
        dummyInput.type = 'file'; 
        dummyInput.multiple = true;
        dummyInput.onchange = (e) => {
            Array.from(e.target.files).forEach(file => addFileCard(file));
            dummyInput.value = ''; 
            dom.mainInput.focus();
        };
        dom.btnInputUpload.addEventListener('click', () => dummyInput.click());
    }

    // Tag Logic
    dom.chipBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-type');
            dom.tagContainer.innerHTML = ''; // Single tag mode
            const tag = document.createElement('div');
            tag.className = 'input-tag';
            tag.innerHTML = `<span>${type}</span><span class="material-symbols-outlined remove-tag">close</span>`;
            tag.addEventListener('click', () => tag.remove());
            dom.tagContainer.appendChild(tag);
            dom.mainInput.focus();
        });
    });

    // Send Logic
    async function handleSend() {
        let text = dom.mainInput.value.trim(); 
        
        // 1. Read Content from Uploaded Files
        if (currentInputFiles.length > 0) {
            const fileContents = await Promise.all(currentInputFiles.map(async (file) => {
                try {
                    // Simple text check or assume text for patch files
                    return await file.text();
                } catch (e) {
                    console.warn(`Could not read file ${file.name}`, e);
                    return `[Error reading ${file.name}]`;
                }
            }));
            
            // Append file content to text input
            const combinedContent = fileContents.join('\n\n');
            text = text ? `${text}\n\n${combinedContent}` : combinedContent;
        }

        if (!text) return;

        // 2. Determine Mode (Patch vs Prompt)
        let isPatchMode = Array.from(dom.tagContainer.children).some(tag => tag.textContent.includes('Patch'));
        
        // Auto-detect Patch mode if content looks like a patch or file was named patch.txt
        if (!isPatchMode) {
            const hasPatchMarker = text.includes('<<<<<<< SEARCH');
            const hasPatchFile = currentInputFiles.some(f => f.name.toLowerCase().includes('patch'));
            if (hasPatchMarker || (hasPatchFile && text.includes('FILE:'))) {
                isPatchMode = true;
            }
        }

        // Move input to bottom if needed
        if (dom.inputWrapper.classList.contains('centered')) {
            dom.inputWrapper.classList.remove('centered');
            dom.inputWrapper.classList.add('bottom');
            setTimeout(() => { dom.outputArea.classList.remove('hidden'); }, 300);
        }

        // 3. Reset Input UI & State
        dom.mainInput.value = '';
        dom.mainInput.style.height = '24px';
        dom.filePreviewArea.innerHTML = '';
        dom.filePreviewArea.classList.add('hidden');
        // dom.tagContainer.innerHTML = ''; // Keep tags active
        currentInputFiles = []; // Clear file state

        // 4. Dispatch
        // 注意：PatchManager.handleInput 内部会调用 renderUserMessage 来渲染用户的原始输入
        if (isPatchMode) {
            await PatchManager.handleInput(text, dom.outputArea, renderUserMessage);
        } else {
            renderUserMessage(text);
            // 这里未来可以接入 LLM 的流式返回，目前仅显示用户输入
        }
    }

    function renderUserMessage(text) {
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-row user';
        
        // Escape HTML to prevent injection when rendering raw text
        const safeText = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        wrapper.innerHTML = `
            <div class="chat-bubble user" style="white-space: pre-wrap;">${safeText}</div>
        `;
        
        dom.outputArea.appendChild(wrapper);
        dom.outputArea.scrollTop = dom.outputArea.scrollHeight;
    }

    dom.btnSend.addEventListener('click', handleSend);
    
    // Auto-resize Input
    dom.mainInput.addEventListener('input', function() {
        this.style.height = 'auto'; 
        const newHeight = Math.min(this.scrollHeight, 250); 
        this.style.height = newHeight + 'px';
        this.style.overflowY = this.scrollHeight > 250 ? 'auto' : 'hidden';
    });

    dom.mainInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); 
            handleSend();
        }
    });
});