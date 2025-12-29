export const PatchEngine = {
    getDmp() {
        if (typeof diff_match_patch === 'undefined') {
            throw new Error("diff_match_patch library not loaded. Please check index.html");
        }
        const dmp = new diff_match_patch();
        dmp.Match_Threshold = 0.2;
        dmp.Match_Distance = 10000; 
        return dmp;
    },

    parseInput(inputText) {
        const lines = inputText.split(/\r?\n/);
        const patches = [];
        
        let state = 'IDLE'; 
        let currentFile = '';
        let searchBuffer = [];
        let replaceBuffer = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (state === 'IDLE') {
                if (trimmed.startsWith('FILE:')) {
                    currentFile = trimmed.replace(/^FILE:\s*/, '').trim();
                } else if (trimmed.startsWith('<<<<<<< SEARCH')) {
                    state = 'SEARCH';
                    searchBuffer = [];
                }
            } else if (state === 'SEARCH') {
                if (trimmed.startsWith('=======')) {
                    state = 'REPLACE';
                    replaceBuffer = [];
                } else {
                    searchBuffer.push(line);
                }
            } else if (state === 'REPLACE') {
                if (trimmed.startsWith('>>>>>>> REPLACE')) {
                    const searchBlock = searchBuffer.join('\n').replace(/^\n+|\n+$/g, '');
                    const replaceBlock = replaceBuffer.join('\n').replace(/^\n+|\n+$/g, '');

                    if (currentFile) {
                        patches.push({
                            targetFile: currentFile,
                            search: searchBlock,
                            replace: replaceBlock
                        });
                    }
                    state = 'IDLE';
                } else {
                    replaceBuffer.push(line);
                }
            }
        }
        return patches;
    },

    findMatches(fullContext, patches) {
        const results = [];
        let dmp;
        try { dmp = this.getDmp(); } catch(e) { console.error(e); return []; }

        patches.forEach((patch, index) => {
            const fileHeaderPattern = `=== File: ${patch.targetFile} ===`;
            const fileStartIndex = fullContext.indexOf(fileHeaderPattern);
            
            if (fileStartIndex === -1) {
                results.push({
                    id: `patch-${index}-err`,
                    isValid: false,
                    file: patch.targetFile,
                    original: patch.search,
                    error: `File '${patch.targetFile}' not found in current context.`
                });
                return;
            }

            const contentStartOffset = fileStartIndex + fileHeaderPattern.length;
            const nextFileIndex = fullContext.indexOf('=== File: ', contentStartOffset);
            const fileEndIndex = nextFileIndex !== -1 ? nextFileIndex : fullContext.length;
            const rawFileContentSlice = fullContext.substring(contentStartOffset, fileEndIndex);
            
            // Normalize for search
            const fileContentSlice = rawFileContentSlice.replace(/\r\n/g, '\n');
            let loc = -1;

            // 1. Fuzzy Match (DMP)
            try {
                if (patch.search.length > 2000) {
                    throw new Error("Search block too large for fuzzy match");
                }
                loc = dmp.match_main(fileContentSlice, patch.search, 0);
            } catch (e) {
                console.warn(`Fuzzy match skipped for patch ${index} (fallback to exact match):`, e.message);
                loc = -1;
            }

            // 2. Exact Match (Fallback)
            if (loc === -1) {
                loc = fileContentSlice.indexOf(patch.search);
            }

            if (loc !== -1) {
                let absoluteStart = contentStartOffset + loc; 
                
                results.push({
                    id: `patch-${index}`,
                    file: patch.targetFile,
                    start: absoluteStart,
                    end: absoluteStart + patch.search.length, 
                    original: patch.search,
                    replacement: patch.replace,
                    isValid: true,
                    localStart: loc
                });
            } else {
                results.push({
                    id: `patch-${index}-err`,
                    isValid: false,
                    file: patch.targetFile,
                    original: patch.search,
                    error: "Match Failed. The 'Search' block could not be found via fuzzy or exact match."
                });
            }
        });
        return results;
    },

    applyPatches(fullContext, selectedMatches) {
        let dmp;
        try { dmp = this.getDmp(); } catch(e) { return fullContext; }

        const patchesByFile = {};
        selectedMatches.forEach(m => {
            if (!patchesByFile[m.file]) patchesByFile[m.file] = [];
            patchesByFile[m.file].push(m);
        });

        let newFullContext = fullContext;

        Object.keys(patchesByFile).forEach(fileName => {
            const matches = patchesByFile[fileName];
            
            const fileHeader = `=== File: ${fileName} ===`;
            const startIdx = newFullContext.indexOf(fileHeader);
            if (startIdx === -1) return; 

            const contentStart = startIdx + fileHeader.length;
            const nextFileIdx = newFullContext.indexOf('=== File: ', contentStart);
            const endIdx = nextFileIdx !== -1 ? nextFileIdx : newFullContext.length;
            
            const originalFileBlock = newFullContext.substring(contentStart, endIdx);
            const normalizedBlock = originalFileBlock.replace(/\r\n/g, '\n');

            const dmpPatches = matches.map(m => {
                const p = new diff_match_patch.patch_obj();
                p.diffs = [];
                // Ensure patch considers normalized newlines
                p.diffs.push([-1, m.original.replace(/\r\n/g, '\n')]); 
                p.diffs.push([1, m.replacement]);
                p.start1 = m.localStart || 0; 
                p.start2 = m.localStart || 0;
                p.length1 = m.original.length;
                p.length2 = m.replacement.length;
                return p;
            });

            const [patchedFileBlock, applyResults] = dmp.patch_apply(dmpPatches, normalizedBlock);
            
            applyResults.forEach((success, i) => {
                if (!success) console.warn(`Patch ${i} for ${fileName} might have failed or applied imperfectly.`);
            });

            // Replace in the big string
            newFullContext = newFullContext.substring(0, contentStart) + patchedFileBlock + newFullContext.substring(endIdx);
        });

        return newFullContext;
    }
};