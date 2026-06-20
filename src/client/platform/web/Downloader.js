import JSZip from 'jszip';
import FileSaver from 'file-saver';

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
            
            // Ensure content is a valid string
            let content = file.content;
            
            if (content === null || content === undefined) {
                console.warn('[Downloader] File has null/undefined content:', file.name);
                content = '';
            } else {
                content = String(content);
            }
            
            // Handle data URLs - extract base64 part if present
            if (content.indexOf('data:') === 0 && content.indexOf(',') > 0) {
                console.log('[Downloader] Detected data URL, extracting base64 for:', file.name);
                content = content.split(',')[1];
            }
            
            // Ensure name is a valid string
            let name = file.name;
            if (!name) {
                name = 'file_' + i;
            }
            
            console.log('[Downloader] Adding file:', name, 'type:', typeof content, 'length:', content.length);
            
            // Use base64 encoding for binary files, utf8 for text files
            let isBinary = file.base64 || name.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)$/i);
            
            try {
                if (isBinary) {
                    zip.file(name, content, {base64: true});
                } else {
                    // For text files, use raw string
                    zip.file(name, content);
                }
            } catch (err) {
                console.error('[Downloader] Error adding file:', name, err);
            }
        }

        let ext = fileName.split(".").pop();
        if(ext !== "zip") fileName = fileName + ".zip";

        console.log('[Downloader] Generating zip with', Object.keys(zip.files).length, 'files');
        
        return zip.generateAsync({type:"blob", compression:"DEFLATE", compressionOptions:{level:6}}, (metadata) => {
            // Only log every 25%
            if (Math.floor(metadata.percent) % 25 === 0) {
                console.log('[Downloader] Compression progress:', metadata.percent.toFixed(0) + '%');
            }
        }).then((content) => {
            console.log('[Downloader] Zip generated, size:', content.size, 'bytes');
            FileSaver.saveAs(content, fileName);
        }).catch(err => {
            console.error('[Downloader] Error generating zip:', err);
            // Try fallback approach
            console.log('[Downloader] Trying fallback approach...');
            return this.runFallback(files, fileName);
        });
    }
    
    static runFallback(files, fileName) {
        // Fallback: try each file individually
        console.log('[Downloader] Fallback approach - adding files with explicit encoding');
        
        let zip = new JSZip();
        JSZip.defaults.date = new Date();
        
        return new Promise((resolve, reject) => {
            let processNext = (index) => {
                if (index >= files.length) {
                    console.log('[Downloader] Fallback: generating zip with', Object.keys(zip.files).length, 'files');
                    zip.generateAsync({type:"blob"})
                        .then(content => {
                            FileSaver.saveAs(content, fileName);
                            resolve();
                        })
                        .catch(reject);
                    return;
                }
                
                let file = files[index];
                let content = file.content || '';
                content = String(content);
                
                if (content.indexOf('data:') === 0 && content.indexOf(',') > 0) {
                    content = content.split(',')[1];
                }
                
                let name = file.name || 'file_' + index;
                
                try {
                    // Check if it's binary
                    let isBinary = file.base64 || name.match(/\.(png|jpg|jpeg|gif|webp|ico|bmp)$/i);
                    
                    if (isBinary) {
                        zip.file(name, content, {base64: true});
                    } else {
                        // Try to encode as UTF8 explicitly
                        let uint8 = new TextEncoder().encode(content);
                        zip.file(name, uint8);
                    }
                } catch (err) {
                    console.error('[Downloader] Fallback error for file:', name, err);
                }
                
                // Process next file
                setTimeout(() => processNext(index + 1), 10);
            };
            
            processNext(0);
        });
    }

}

export default Downloader;