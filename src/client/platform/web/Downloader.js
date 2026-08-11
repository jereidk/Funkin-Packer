import JSZip from 'jszip';
import FileSaver from 'file-saver';

// Formats that carry their own compression. Running DEFLATE over them burns CPU
// for ~0% gain, so they are STOREd while everything else is deflated.
const ALREADY_COMPRESSED = [
    'png', 'jpg', 'jpeg', 'gif', 'webp',
    'astc', 'ktx', 'ktx2', 'basis', 'zip'
];

class Downloader {

    static run(files, fileName) {

        let zip = new JSZip();

        // Fix timezone issue
        const currDate = new Date();
        const dateWithOffset = new Date(currDate.getTime() - currDate.getTimezoneOffset() * 60000);

        const seen = new Set();

        for(let file of files) {
            let name = file.name;
            let content = file.content;

            if(typeof name !== 'string' || !name.length) {
                throw new Error(`Invalid entry name: ${JSON.stringify(name)}`);
            }

            let base64 = !!file.base64;

            // Handle data URLs - extract the payload and trust the URL's own encoding flag
            if(typeof content === 'string' && content.indexOf('data:') === 0) {
                let comma = content.indexOf(',');
                if(comma > 0) {
                    base64 = content.lastIndexOf(';base64', comma) > 0;
                    content = content.slice(comma + 1);
                }
            }

            // JSZip fails deep inside its stream ("e.charCodeAt is not a function" in
            // utf8encode) when content is neither a string nor a supported binary type.
            // That error is emitted on an internal EventEmitter and never reaches the
            // generateAsync() promise, so the caller hangs forever. Reject up front.
            let binary = content instanceof Uint8Array ||
                         content instanceof ArrayBuffer ||
                         (typeof Blob !== 'undefined' && content instanceof Blob);

            if(typeof content !== 'string' && !binary) {
                throw new Error(`"${name}" has unsupported content of type ` +
                                `${content === null ? 'null' : typeof content}`);
            }

            // A binary payload is never base64 text
            if(binary) base64 = false;

            if(seen.has(name)) {
                console.warn(`[Downloader] Duplicate entry "${name}" - the earlier one is overwritten`);
            }
            seen.add(name);

            let ext = name.split('.').pop().toLowerCase();
            let store = ALREADY_COMPRESSED.indexOf(ext) >= 0;

            zip.file(name, content, {
                base64: base64,
                date: dateWithOffset,
                compression: store ? 'STORE' : 'DEFLATE',
                compressionOptions: store ? undefined : {level: 9}
            });
        }

        let ext = fileName.split(".").pop();
        if(ext !== "zip") fileName = fileName + ".zip";

        // Without an explicit compression JSZip defaults to STORE and the archive
        // ends up as large as the sum of its entries.
        return zip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: {level: 9}
        }).then((content) => {
            FileSaver.saveAs(content, fileName);
        }).catch(err => {
            console.error('[Downloader] Error generating zip:', (err && err.message) || err);
            throw err;
        });
    }

}

export default Downloader;
