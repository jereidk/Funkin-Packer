import JSZip from 'jszip';
import FileSaver from 'file-saver';

// Helper: decode base64 to Uint8Array
function base64ToUint8Array(base64) {
    try {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    } catch (e) {
        console.error('[Downloader] base64 decode error:', e);
        return null;
    }
}

class Downloader {

    static run(files, fileName) {

        console.log('[Downloader] Creating new JSZip instance');
        let zip = new JSZip();

        // Fix timezone issue
        const currDate = new Date();
        const dateWithOffset = new Date(currDate.getTime() - currDate.getTimezoneOffset() * 60000);
        JSZip.defaults.date = dateWithOffset;

        console.log('[Downloader] Processing', files.length, 'files');
        
        for(let i = 0; i < files.length; i++) {
            let file = files[i];
            
            // Get content
            let content = file.content;
            if (content === null || content === undefined) {
                console.warn('[Downloader] File has null/undefined content:', file.name);
                content = '';
            } else {
                content = String(content);
            }
            
            // Handle data URLs - extract base64 part if present
            if (content.indexOf('data:') === 0 && content.indexOf(',') > 0) {
                content = content.split(',')[1];
            }
            
            // Ensure name is a valid string
            let name = file.name;
            if (!name) {
                name = 'file_' + i;
            }
            // Force name to be string
            name = String(name);
            
            // Determine if binary file
            let isBinary = file.base64 || name.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)$/i);
            
            console.log('[Downloader] Adding file:', name, 'binary:', isBinary, 'length:', content.length);
            
            try {
                if (isBinary) {
                    // Decode base64 to Uint8Array and add as binary
                    let binaryData = base64ToUint8Array(content);
                    if (binaryData) {
                        zip.file(name, binaryData, {binary: true});
                        console.log('[Downloader] Added', name, 'as binary, size:', binaryData.length);
                    } else {
                        console.warn('[Downloader] Failed to decode binary:', name);
                    }
                } else {
                    // Add as text (UTF-8) - explicitly ensure it's a string
                    let textContent = String(content);
                    zip.file(name, textContent);
                }
            } catch (err) {
                console.error('[Downloader] Error adding file:', name, err);
            }
        }

        let ext = fileName.split(".").pop();
        if(ext !== "zip") fileName = fileName + ".zip";

        console.log('[Downloader] Generating zip with', Object.keys(zip.files).length, 'files');
        
        // Debug: verify all file names are valid strings
        Object.keys(zip.files).forEach((filePath, idx) => {
            const file = zip.files[filePath];
            console.log(`[Downloader] File ${idx}: name="${file.name}" typeof name=${typeof file.name}`);
            try {
                file.name.charCodeAt(0);
            } catch (e) {
                console.error(`[Downloader] CRITICAL: charCodeAt failed for file "${file.name}"`, e);
            }
        });
        
        return zip.generateAsync({type:"blob"}, (metadata) => {
            // Only log every 25%
            if (Math.floor(metadata.percent) % 25 === 0) {
                console.log('[Downloader] Compression progress:', metadata.percent.toFixed(0) + '%');
            }
        }).then((content) => {
            console.log('[Downloader] Zip generated, size:', content.size, 'bytes');
            FileSaver.saveAs(content, fileName);
        }).catch(err => {
            console.error('[Downloader] Error generating zip:', err);
            throw err;
        });
    }
}

export default Downloader;