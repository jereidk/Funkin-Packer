import JSZip from 'jszip';
import FileSaver from 'file-saver';

class Downloader {

    static run(files, fileName) {

        let zip = new JSZip();

        // Fix timezone issue
        const currDate = new Date();
        const dateWithOffset = new Date(currDate.getTime() - currDate.getTimezoneOffset() * 60000);
        // replace the default date with dateWithOffset
        JSZip.defaults.date = dateWithOffset;

        for(let file of files) {
            // Ensure content is a string (convert objects to JSON if needed)
            let content = file.content;
            if (content === null || content === undefined) {
                console.warn('[Downloader] File has null/undefined content:', file.name);
                content = '';
            } else if (typeof content !== 'string') {
                console.warn('[Downloader] File content is not a string, converting:', file.name, typeof content);
                content = String(content);
            }
            
            // Ensure name is a valid string
            let name = file.name;
            if (!name || typeof name !== 'string') {
                console.warn('[Downloader] Invalid file name, using default:', file.name);
                name = 'file';
            }
            
            console.log('[Downloader] Adding file:', name, 'base64:', !!file.base64, 'content length:', content.length);
            zip.file(name, content, {base64: !!file.base64, binary: !!file.binary});
        }

        let ext = fileName.split(".").pop();
        if(ext !== "zip") fileName = fileName + ".zip";

        console.log('[Downloader] Generating zip with', Object.keys(zip.files).length, 'files');
        
        return zip.generateAsync({type:"blob"}, (metadata) => {
            console.log('[Downloader] Compression progress:', metadata.percent.toFixed(1) + '%');
        }).then((content) => {
            console.log('[Downloader] Zip generated successfully, size:', content.size);
            FileSaver.saveAs(content, fileName);
        }).catch(err => {
            console.error('[Downloader] Error generating zip:', err);
            throw err;
        });
    }

}

export default Downloader;