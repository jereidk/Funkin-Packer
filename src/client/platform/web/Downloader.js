import JSZip from 'jszip';
import FileSaver from 'file-saver';

class Downloader {

    static run(files, fileName) {

        let zip = new JSZip();

        // Fix timezone issue
        const currDate = new Date();
        const dateWithOffset = new Date(currDate.getTime() - currDate.getTimezoneOffset() * 60000);
        JSZip.defaults.date = dateWithOffset;

        for(let file of files) {
            // Handle data URLs - extract base64 part if present
            let content = file.content;
            if (typeof content === 'string' && content.indexOf('data:') === 0 && content.indexOf(',') > 0) {
                content = content.split(',')[1];
            }
            zip.file(file.name, content, {base64: !!file.base64});
        }

        let ext = fileName.split(".").pop();
        if(ext !== "zip") fileName = fileName + ".zip";

        return zip.generateAsync({type:"blob"}).then((content) => {
            FileSaver.saveAs(content, fileName);
        }).catch(err => {
            console.error('[Downloader] Error generating zip:', err);
            throw err;
        });
    }

}

export default Downloader;