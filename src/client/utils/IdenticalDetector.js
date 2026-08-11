/**
 * IdenticalDetector - finds sprites that are pixel-identical (or share the
 * same source image) so PackProcessor can collapse them to one copy in the
 * atlas and clone the placement back out afterward.
 *
 * Split out of PackProcessor as a dependency-free module (no DOM, no other
 * app imports) so it can be exercised directly under plain node - PackProcessor
 * itself pulls in Trimmer, which touches `document` at module scope, and
 * packers/MaxRectsPacker, which requires the `maxrects-packer` npm package.
 */

/**
 * FNV-1a over a byte buffer. Only used to bucket detectIdentical's candidates
 * into small groups before the exact comparison runs - a collision costs a
 * little extra comparison work inside the bucket, never a wrong merge.
 */
export function hashBytes(bytes) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

export function compareImages(rect1, rect2, didTrim) {
    if (!didTrim) {
        if (rect1.image._base64 === rect2.image._base64) {
            return true;
        }
        return rect1.image.src === rect2.image.src;
    }

    let i1 = rect1.trimmedImage;
    let i2 = rect2.trimmedImage;

    if (i1.length !== i2.length) return false;

    let length = i1.length;

    while (length--) {
        if (i1[length] !== i2[length]) return false;
    }
    return true;
}

export function detectIdentical(rects, didTrim) {
    let identical = [];
    let identicalSet = new Set();

    if (!didTrim) {
        // No pixel data to compare here - the two string keys compareImages
        // checks (image._base64, image.src) can be grouped directly with a
        // union-find instead of an O(n^2) pairwise scan.
        //
        // This also fixes a latent bug in the old pairwise version: when a
        // chain formed through DIFFERENT matching keys (rect A and B sharing
        // _base64, B and C sharing only .src, with no direct A-C match), C's
        // `.identical` pointed at B - but B was itself a duplicate and got
        // spliced out of `rects` right below, so applyIdentical's later
        // `rects.indexOf(item.identical)` came back -1 and C's sprite was
        // silently dropped from the packed atlas, no error, nothing rendered.
        // Every current loader (LocalImagesLoader, ZipLoader,
        // Base64ImagesLoader, SheetSplitter) sets _base64 and src from the
        // same source per image, so the two keys can never actually disagree
        // and this was never reachable - but union-find always resolves every
        // duplicate directly to one flat representative, so the failure mode
        // can't be reintroduced by a future loader either.
        let parent = new Array(rects.length);
        for (let i = 0; i < rects.length; i++) parent[i] = i;

        let find = x => {
            while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
            return x;
        };
        let union = (a, b) => {
            let ra = find(a), rb = find(b);
            if (ra === rb) return;
            // Keep the smaller index as root, so the representative is always
            // the earliest original rect - matches the old algorithm's tie-break.
            if (ra < rb) parent[rb] = ra; else parent[ra] = rb;
        };

        let byBase64 = new Map(), bySrc = new Map();
        for (let i = 0; i < rects.length; i++) {
            let img = rects[i].image;
            if (img._base64 !== undefined) {
                let prev = byBase64.get(img._base64);
                if (prev !== undefined) union(i, prev); else byBase64.set(img._base64, i);
            }
            if (img.src !== undefined) {
                let prev = bySrc.get(img.src);
                if (prev !== undefined) union(i, prev); else bySrc.set(img.src, i);
            }
        }

        for (let i = 0; i < rects.length; i++) {
            let root = find(i);
            if (root !== i) {
                rects[i].identical = rects[root];
                identical.push(rects[i]);
                identicalSet.add(rects[i]);
            }
        }
    }
    else {
        // Bucket by (length, content hash) so the expensive exact byte
        // comparison only runs against rects that plausibly match, instead of
        // against every other rect in the set. On 3000 near-duplicate
        // animation frames (mostly-identical content, a handful of bytes
        // different near the start - the case that defeats compareImages'
        // early-exit scan) this cut detectIdentical from ~2.6s to ~0.14s.
        // Within a bucket the original nested-loop shape is kept (same
        // tie-break: earliest array order becomes the reference), just scoped
        // to a handful of real candidates instead of the whole array.
        let buckets = new Map();
        for (let rect of rects) {
            let bytes = rect.trimmedImage;
            let key = bytes.length + ':' + hashBytes(bytes);
            let bucket = buckets.get(key);
            if (!bucket) { bucket = []; buckets.set(key, bucket); }
            bucket.push(rect);
        }

        for (let bucket of buckets.values()) {
            if (bucket.length < 2) continue;
            for (let i = 0; i < bucket.length; i++) {
                let rect1 = bucket[i];
                if (identicalSet.has(rect1)) continue;
                for (let n = i + 1; n < bucket.length; n++) {
                    let rect2 = bucket[n];
                    if (identicalSet.has(rect2)) continue;
                    if (compareImages(rect1, rect2, didTrim)) {
                        rect2.identical = rect1;
                        identical.push(rect2);
                        identicalSet.add(rect2);
                    }
                }
            }
        }
    }

    // Single O(n) filter instead of the original's n * (indexOf + splice).
    let kept = rects.filter(r => !identicalSet.has(r));

    return {
        rects: kept,
        identical: identical
    };
}

export default { detectIdentical, compareImages, hashBytes };
