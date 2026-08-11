import JSZip from 'jszip';

import {Observer, GLOBAL_EVENT} from '../Observer';
import I18 from './I18';

// Longest we will wait for the browser to finish decoding the images it was given
const MAX_DECODE_WAIT = 60000;

class ZipLoader {

    constructor() {
        this.onProgress = null;
        this.onEnd = null;
        this.zip = null;
        this.filesList = [];
        this.loaded = {};
        this.loadedCnt = 0;
        this.failed = 0;
        this.waited = 0;

        this.waitImages = this.waitImages.bind(this);
    }

    load(file, onProgress=null, onEnd=null) {

        this.onProgress = onProgress;
        this.onEnd = onEnd;

        console.log(`[ZipLoader] Opening ${file && file.name ? file.name : 'zip'}` +
                    (file && file.size ? ` (${(file.size / 1024 / 1024).toFixed(1)} MB)` : ''));

        this.zip = new JSZip();
        this.zip.loadAsync(file).then(
            () => {
                this.parseZip();
            },
            err => {
                console.error('[ZipLoader] Could not open zip:', (err && err.message) || err);
                Observer.emit(GLOBAL_EVENT.SHOW_MESSAGE, I18.f("INVALID_ZIP_ERROR"));
                if (this.onEnd) this.onEnd({});
            }
        );
    }

    parseZip() {

        let extensions = ["png", "jpg", "jpeg", "gif"];
        this.filesList = [];

        let files = Object.keys(this.zip.files);

        for(let name of files) {
            let file = this.zip.files[name];

            if(!file.dir) {
                let ext = name.split(".").pop().toLowerCase();
                if(extensions.indexOf(ext) >= 0 && name.toUpperCase().indexOf("__MACOSX") < 0) {
                    this.filesList.push(name);
                }
            }
        }

        this.loadedCnt = 0;
        this.failed = 0;
        this.waited = 0;

        console.log(`[ZipLoader] ${files.length} entries, ${this.filesList.length} image(s) to load`);

        this.loadNext();
    }

    loadNext() {
        if(!this.filesList.length) {
            this.waitImages();
            return;
        }

        let name = this.filesList.shift();
        let entry = this.zip.file(name);

        if(!entry) {
            console.warn('[ZipLoader] Entry disappeared, skipping:', name);
            this.loadNext();
            return;
        }

        // Every failure path must still call loadNext(). Previously a rejected
        // decompression broke the chain silently: onEnd never fired, so the
        // processing shader stayed up forever with no way back.
        entry.async("base64").then(
            d => {
                try {
                    let ext = name.split(".").pop().toLowerCase();
                    let content = "data:image/"+ext+";base64," + d;

                    let img = new Image();

                    img.onerror = () => {
                        console.error('[ZipLoader] Could not decode image:', name);
                        this.failed++;
                        delete this.loaded[name];
                    };

                    img.src = content;
                    img._base64 = content;

                    this.loaded[name] = img;
                    this.loadedCnt++;
                }
                catch(e) {
                    // A very large entry can blow the engine's max string length here
                    console.error('[ZipLoader] Failed to build image for', name + ':',
                        (e && e.message) || e);
                    this.failed++;
                }

                if(this.onProgress) {
                    this.onProgress(this.loadedCnt / (this.loadedCnt + this.filesList.length));
                }

                this.loadNext();
            },
            err => {
                console.error('[ZipLoader] Failed to read', name + ':', (err && err.message) || err);
                this.failed++;
                this.loadNext();
            }
        );
    }

    waitImages() {
        let ready = true;

        for(let key of Object.keys(this.loaded)) {
            if(!this.loaded[key].complete) {
                ready = false;
                break;
            }
        }

        if(ready) {
            this.finish();
            return;
        }

        // Bounded wait. An image that never reports complete used to spin this
        // timer forever, leaving the app stuck behind the shader.
        this.waited += 50;

        if(this.waited >= MAX_DECODE_WAIT) {
            let pending = Object.keys(this.loaded).filter(k => !this.loaded[k].complete);
            console.warn(`[ZipLoader] Gave up waiting for ${pending.length} image(s) after ` +
                         `${MAX_DECODE_WAIT / 1000}s:`, pending.slice(0, 10));
            for(let key of pending) delete this.loaded[key];
            this.finish();
            return;
        }

        setTimeout(this.waitImages, 50);
    }

    finish() {
        let count = Object.keys(this.loaded).length;
        console.log(`[ZipLoader] Loaded ${count} image(s)` +
                    (this.failed ? `, ${this.failed} failed` : ''));

        if(this.failed && count === 0) {
            Observer.emit(GLOBAL_EVENT.SHOW_MESSAGE, I18.f("INVALID_ZIP_ERROR"));
        }

        if(this.onEnd) this.onEnd(this.loaded);
    }
}

export default ZipLoader;