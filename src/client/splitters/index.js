import Grid from './Grid';
import JsonHash from './JsonHash';
import JsonArray from './JsonArray';
//import XML from './XML';
import UIKit from './UIKit';
import Spine from './Spine';
import Sparrow from './Sparrow';
import BetterTA from './BetterTA';

const list = [
    Sparrow,
    Grid,
    JsonHash,
    JsonArray,
    //XML,
    UIKit,
    Spine,
    BetterTA
];

function getSplitterByType(type) {
    for(let item of list) {
        if(item.type === type) {
            return item;
        }
    }
    return null;
}

function getSplitterByData(data, cb) {
    for(let item of list) {
        // Stop probing once a splitter has matched - later checks (e.g.
        // UIKit's plist parser) would otherwise still run against data they
        // were never meant to handle, which can log noisy false-positive
        // parse errors (xmldom logs straight to console before the
        // exception is caught) for a format that's already been resolved.
        if(cb === null) break;

        if(item.type !== Grid.type) {
            item.check(data, (checked) => {
                if(checked) {
                    if(cb) {
                        cb(item);
                        cb = null;
                    }
                }
            });
        }
    }

    return getDefaultSplitter();
}

function getDefaultSplitter() {
    return Sparrow;
}

export { getSplitterByType, getSplitterByData, getDefaultSplitter };
export default list;