export const Archiver = {
    async rebuildProject(fullText) {
        if (typeof JSZip === 'undefined') {
            throw new Error("JSZip library not loaded.");
        }
        const zip = new JSZip();
        let count = 0;
        let projectName = 'RestoredProject';
        
        const treeMatch = fullText.match(/^Project Tree:\n(.*?)\//m);
        if (treeMatch && treeMatch[1]) {
            projectName = treeMatch[1].trim();
        }

        let currentIndex = 0;
        const fileHeaderMarker = '=== File: ';
        
        while (true) {
            const headerStart = fullText.indexOf(fileHeaderMarker, currentIndex);
            if (headerStart === -1) break;

            const headerLineEnd = fullText.indexOf('\n', headerStart);
            if (headerLineEnd === -1) break;

            const headerLine = fullText.substring(headerStart, headerLineEnd);
            const filePath = headerLine.replace(fileHeaderMarker, '').replace(' ===', '').trim();
            
            const codeBlockStart = fullText.indexOf('```', headerLineEnd);
            if (codeBlockStart === -1) {
                currentIndex = headerLineEnd;
                continue;
            }
            
            const contentStart = fullText.indexOf('\n', codeBlockStart) + 1;
            let nextHeaderIndex = fullText.indexOf(fileHeaderMarker, contentStart);
            if (nextHeaderIndex === -1) {
                nextHeaderIndex = fullText.length;
            }
            
            const contentEnd = fullText.lastIndexOf('```', nextHeaderIndex);

            if (contentEnd > contentStart) {
                let fileContent = fullText.substring(contentStart, contentEnd);
                if (fileContent.endsWith('\n')) {
                    fileContent = fileContent.slice(0, -1);
                }
                
                let relativePath = filePath;
                const prefix = `${projectName}/`;
                if (relativePath.startsWith(prefix)) {
                    relativePath = relativePath.substring(prefix.length);
                }
                
                if (!relativePath) relativePath = `root_file_${count}.txt`;
                
                zip.file(relativePath, fileContent);
                count++;
            }
            currentIndex = nextHeaderIndex;
        }

        if (count === 0) {
            throw new Error("No file patterns found in the context text.");
        }
        console.log(`Rebuilt ${count} files.`);
        
        return {
            blob: await zip.generateAsync({ type: "blob" }),
            fileName: `${projectName}_Rebuilt.zip`
        };
    }
};