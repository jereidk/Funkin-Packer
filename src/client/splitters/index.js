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
    // Skip XML-based Sparrow check when data is clearly JSON
    const isJson = typeof data === 'string' && (data.trimStart()[0] === '{' || data.trimStart()[0] === '[');

    for(let item of list) {
        if(item.type !== Grid.type) {
            if(isJson && item.type === Sparrow.type) continue;
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