function smartSortImages(f1, f2) {
    let t1 = f1.split('/');
    let t2 = f2.split('/');

    let n1 = t1.pop();
    let n2 = t2.pop();

    let p1 = t1.join('/');
    let p2 = t2.join('/');

    if(p1 === p2) {
        t1 = n1.split('.');
        t2 = n2.split('.');

        if(t1.length > 1) t1.pop();
        if(t2.length > 1) t2.pop();

        n1 = parseInt(t1.join('.'), 10);
        n2 = parseInt(t2.join('.'), 10);

        if(!isNaN(n1) && !isNaN(n2)) {
            if(n1 === n2) return 0;
            return n1 > n2 ? 1 : -1;
        }
    }

    if(f1 === f2) return 0;
    return f1 > f2 ? 1 : -1;
}

function cleanPrefix(str) {
    // Remove file extension if present
    let parts = str.split(".");
    if(parts.length > 1) parts.pop();
    str = parts.join(".");

    // Strip ALL trailing digits - this groups all frames of an animation together
    // Examples:
    //   "walk0" .. "walk9" -> all become "walk"
    //   "walk00" .. "walk99" -> all become "walk"
    //   "idle_0" .. "idle_99" -> all become "idle_"
    return str.replace(/[0-9]+$/, '');
}

function removeFromArray(arr, item) {
    let idx = arr.indexOf(item);

    if (idx !== -1) {
        arr.splice(idx, 1);
    }
}

// Migrated to sparrowStore.clearAll() - kept for backward compatibility
function clearGlobals() {
    const sparrowStore = require('../store/sparrowStore');
    sparrowStore.clearAll();
}

module.exports = {
    smartSortImages: smartSortImages,
    cleanPrefix: cleanPrefix,
    clearGlobals: clearGlobals,
    removeFromArray: removeFromArray
};