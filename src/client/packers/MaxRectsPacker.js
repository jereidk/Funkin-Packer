let MaxRectsPackerEngine = require("maxrects-packer").MaxRectsPacker;
let PACKING_LOGIC = require("maxrects-packer").PACKING_LOGIC;

import Packer from "./Packer";

const METHOD = {
    Smart: "Smart",
    SmartArea: "SmartArea",
    Square: "Square",
    SquareArea: "SquareArea",
    // SmartSquare: "SmartSquare",
    // SmartSquareArea: "SmartSquareArea"
};

// A new MaxRectsPacker instance is created per sheet (see PackProcessor's
// while loop), so an instance-level flag can't dedupe this warning across
// sheets. When the configured size doesn't comfortably fit the sprite set,
// EVERY sheet for EVERY MaxRectsPacker combo "Optimal" mode tries hits this
// same condition - reported directly: a real repack logged it 90+ times in
// one export. The underlying multi-bin-truncation behavior this warns about
// is still worth surfacing once, just not once per sheet.
let hasWarnedThisRun = false;

function resetMultiBinWarning() {
    hasWarnedThisRun = false;
}

class MaxRectsPacker extends Packer {
    constructor(width, height, allowRotate = false, padding = 0) {
        super();

        this.binWidth = width;
        this.binHeight = height;
        this.allowRotate = allowRotate;
        this.padding = padding;
    }

    pack(data, method) {
        let options = {
            smart: (method === METHOD.Smart || method === METHOD.SmartArea || method === METHOD.SmartSquare || method === METHOD.SmartSquareArea),
            pot: false,
            square: (method === METHOD.Square || method === METHOD.SquareArea || method === METHOD.SmartSquare || method === METHOD.SmartSquareArea),
            allowRotation: this.allowRotate,
            logic: (method === METHOD.Smart || method === METHOD.Square || method === METHOD.SmartSquare) ? PACKING_LOGIC.MAX_EDGE : PACKING_LOGIC.MAX_AREA
        };

        let packer = new MaxRectsPackerEngine(this.binWidth, this.binHeight, this.padding, options);

        let input = [];

        for (let item of data) {
            input.push({ width: item.frame.w, height: item.frame.h, data: item });
        }

        packer.addArray(input);

        // maxrects-packer is itself a multi-bin packer: when the given items don't
        // all fit in one binWidth x binHeight container, it opens additional bins
        // internally rather than failing. Only bin[0] is read here because
        // PackProcessor.pack()'s while loop already owns the multi-sheet decision
        // one call = one sheet, with coordinates relative to that sheet's own
        // (0,0). Concatenating bins[1+] here would mix in coordinates from a
        // SEPARATE (0,0)-origin bin as if they belonged to this same sheet,
        // overlapping whatever is already placed at those coordinates.
        //
        // This is not silent data loss: any item that landed in bins[1+] is
        // simply absent from the result below, so PackProcessor's
        // `for (item of result) removeRect(...)` never removes it from the
        // pending queue, and the outer while loop retries it on the next sheet.
        // It does mean the fresh single-bin repack of that leftover batch can
        // land differently than the library's own multi-bin solution already
        // had - wasting that already-computed placement and potentially costing
        // an extra sheet. Only reachable for MaxRectsPacker's own combos (one of
        // several methods tried by "Optimal" mode) with sprite counts small
        // enough that the ensemble still tries it (see PackProcessor's
        // LARGE_ENSEMBLE_THRESHOLD) but whose combined size still doesn't fit
        // one sheet at the size being tried - narrow, but real.
        if (packer.bins.length > 1 && !hasWarnedThisRun) {
            hasWarnedThisRun = true;
            console.warn(`[MaxRectsPacker] maxrects-packer split into ${packer.bins.length} bins; ` +
                `only the first is used here, the rest are retried on the next sheet ` +
                `(this can repeat per sheet - logged once per export attempt)`);
        }

        let bin = packer.bins[0];
        let rects = bin.rects;

        let res = [];

        for (let item of rects) {
            item.data.frame.x = item.x;
            item.data.frame.y = item.y;
            if (item.rot) {
                item.data.rotated = true;
            }
            res.push(item.data);
        }

        return res;
    }

    static get type() {
        return "MaxRectsPacker";
    }

    static get methods() {
        return METHOD;
    }

    static getMethodProps(id = '') {
        switch (id) {
            case METHOD.Smart:
                return { name: "Smart edge logic", description: "" };
            case METHOD.SmartArea:
                return { name: "Smart area logic", description: "" };
            case METHOD.Square:
                return { name: "Square edge logic", description: "" };
            case METHOD.SquareArea:
                return { name: "Square area logic", description: "" };
            case METHOD.SmartSquare:
                return { name: "Smart square edge logic", description: "" };
            case METHOD.SmartSquareArea:
                return { name: "Smart square area logic", description: "" };
            default:
                throw Error("Unknown method " + id);
        }
    }
}

MaxRectsPacker.resetMultiBinWarning = resetMultiBinWarning;

export default MaxRectsPacker;