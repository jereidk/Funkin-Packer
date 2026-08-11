// Longest we will wait for the browser to finish decoding the images it was
// given. img.complete becomes true even for a failed/broken image per spec, so
// this is defense-in-depth against a browser inconsistency rather than a path
// this codebase is known to hit - matches the bound already used in
// ZipLoader.js for the same "poll .complete forever" pattern.
const MAX_DECODE_WAIT = 60000;

class LocalImagesLoader {

    constructor() {
        this.data = null;
        this.loaded = {};
        this.loadedCnt = 0;
        this.waited = 0;

        this.onProgress = null;
        this.onEnd = null;
        this.onError = null;

        this.waitImages = this.waitImages.bind(this);
        this.loadNext = this.loadNext.bind(this);
    }

    load(data, onProgress = null, onEnd = null, onError = null) {
        this.data = [];

        for (let i = 0; i < data.length; i++) {
            this.data.push(data[i]);
        }

        this.onProgress = onProgress;
        this.onEnd = onEnd;
        this.onError = onError;
        this.waited = 0;

        this.loadNext();
    }

    loadNext() {
        if (!this.data.length) {
            this.waitImages();
            return;
        }

        let types = ["image/png", "image/jpg", "image/jpeg", "image/gif"];
        let item = this.data.shift();

        if (types.indexOf(item.type) >= 0) {
            let img = new Image();

            let path = "";
            let name = "";

            if (item.path) {
                path = item.path.split("\\").join("/");
                name = path.split("/").pop();
            }
            else {
                path = item.name;
                name = item.name;
            }

            img.fsPath = {
                name: name,
                path: path,
                folder: ""
            };

            // Handle image load error
            img.onerror = (e) => {
                console.error('[LocalImagesLoader] Failed to load image:', name, e);
                if (this.onError) {
                    this.onError(name, e);
                }
                // Continue loading other images
                this.loadNext();
            };

            let reader = new FileReader();
            reader.onload = e => {
                img.src = e.target.result;
                img._base64 = e.target.result;

                // Add to loaded map immediately after reader finishes
                this.loaded[item.name] = img;
                this.loadedCnt++;

                if (this.onProgress) {
                    this.onProgress(this.loadedCnt / (this.loadedCnt + this.data.length));
                }

                this.loadNext();
            };

            reader.onerror = (e) => {
                console.error('[LocalImagesLoader] FileReader error for:', name, e);
                if (this.onError) {
                    this.onError(name, e);
                }
                this.loadNext();
            };

            reader.readAsDataURL(item);
        }
        else {
            console.warn('[LocalImagesLoader] Skipping non-image file:', item.name, 'type:', item.type);
            this.loadNext();
        }
    }

    waitImages() {
        let ready = true;
        let notReadyKeys = [];

        for (let key of Object.keys(this.loaded)) {
            if (!this.loaded[key].complete) {
                ready = false;
                notReadyKeys.push(key);
            }
        }

        if (ready) {
            console.log('[LocalImagesLoader] All images loaded, total:', Object.keys(this.loaded).length);
            if (this.onEnd) this.onEnd(this.loaded);
            return;
        }

        this.waited += 50;

        if (this.waited >= MAX_DECODE_WAIT) {
            console.error(`[LocalImagesLoader] Gave up waiting for ${notReadyKeys.length} image(s) after ` +
                          `${MAX_DECODE_WAIT / 1000}s, dropping them:`, notReadyKeys);
            for (let key of notReadyKeys) delete this.loaded[key];
            if (this.onEnd) this.onEnd(this.loaded);
            return;
        }

        console.warn('[LocalImagesLoader] Waiting for images to complete:', notReadyKeys);
        setTimeout(this.waitImages, 50);
    }
}

export default LocalImagesLoader;