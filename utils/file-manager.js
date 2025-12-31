import { initTreeSitter, generateRepoMap } from './lib/repo-map.js';
import { fetchIgnoreRules, parseIgnoreFile, isIgnored } from './lib/ignore-manager.js';

export class FileManager {
    constructor() {
        this.rootDirHandle = null;
        this.globalIgnoreRules = [];
    }

    async init() {
        await initTreeSitter();
        this.globalIgnoreRules = await fetchIgnoreRules();
    }

    // === Core File System Operations ===

    async openDirectoryHandle() {
        try {
            this.rootDirHandle = await window.showDirectoryPicker();
            return this.rootDirHandle;
        } catch (err) {
            if (err.name !== 'AbortError') console.error(err);
            return null;
        }
    }

    hasRoot() {
        return !!this.rootDirHandle;
    }

    getRootHandle() {
        return this.rootDirHandle;
    }

    getIgnoreRules() {
        return this.globalIgnoreRules;
    }

    /**
     * 获取指定目录下的过滤后文件列表 (View Layer Helper)
     * Encapsulates: Reading entries -> Parsing .gitignore -> Filtering -> Sorting
     */
    async getDirectoryEntries(dirHandle, currentPath, parentScopeStack) {
        const entries = [];
        for await (const entry of dirHandle.values()) entries.push(entry);

        // 1. Check for .gitignore in this level
        let currentStack = parentScopeStack;
        const gitIgnoreEntry = entries.find(e => e.name === '.gitignore');
        if (gitIgnoreEntry) {
            try {
                const file = await gitIgnoreEntry.getFile();
                const text = await file.text();
                const newRules = parseIgnoreFile(text);
                // Create new scope inheriting from parent
                currentStack = [...parentScopeStack, { basePath: currentPath, rules: newRules }];
            } catch (e) { console.warn('Ignore error', e); }
        }

        // 2. Filter
        const visibleEntries = entries.filter(entry => {
            if (entry.name === '.git') return false;
            const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
            return !isIgnored(entryPath, currentStack);
        });

        // 3. Sort (Folders first)
        visibleEntries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));

        return { entries: visibleEntries, scopeStack: currentStack };
    }

    async getRepoMap() {
        if (!this.rootDirHandle) throw new Error("No folder opened");
        return await generateRepoMap(this.rootDirHandle, this.globalIgnoreRules);
    }

    async readFile(filePath) {
        if (!this.rootDirHandle) throw new Error("No folder opened");
        const parts = filePath.split('/');
        const fileName = parts.pop();
        let currentDir = this.rootDirHandle;
        
        for (const part of parts) {
            currentDir = await currentDir.getDirectoryHandle(part);
        }
        const fileHandle = await currentDir.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        return await file.text();
    }

    async writeFile(filePath, content) {
        if (!this.rootDirHandle) throw new Error("No folder opened");
        const parts = filePath.split('/');
        const fileName = parts.pop();
        let currentDir = this.rootDirHandle;

        // Traverse directories and create if missing
        for (const part of parts) {
            currentDir = await currentDir.getDirectoryHandle(part, { create: true });
        }

        // Write file
        const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    }
}